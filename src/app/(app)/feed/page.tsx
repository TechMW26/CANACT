'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { useDistance } from '@/lib/distance';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { StoryViewer } from '@/components/StoryViewer';
import { listenWhaFeed, reactWha, deletePost } from '@/lib/services/wha';
import { listenPollFeed, votePoll, deletePoll } from '@/lib/services/poll';
import { listenActiveRateMe, voteRateMe } from '@/lib/services/rateme';
import { deleteStory, listenActiveStories } from '@/lib/services/stories';
import { listenReels, deleteReel } from '@/lib/services/reels';
import { FeedItem, Poll, RateMeSession, ReelItem, StoryItem, WhaPost } from '@/lib/types';
import { haversineMeters, timeAgo, timeLeft } from '@/lib/utils';
import { toast } from '@/components/Toaster';
import { MessageCircle, ThumbsUp, ThumbsDown, Smile, Heart, PartyPopper, Frown, Angry, Plus, SlidersHorizontal, Send, Play } from '@/components/icons';
import { isVideoUrl } from '@/components/CameraCapture';
import { VideoPreview } from '@/components/VideoPreview';
import { Sheet } from '@/components/Sheet';
import { ShareToChatSheet } from '@/components/ShareToChatSheet';
import { PostMenu } from '@/components/PostMenu';
import type { ChatAttachment } from '@/lib/types';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';
import type { LucideIcon } from 'lucide-react';

const REACTIONS: { id: 'cool' | 'love' | 'wow' | 'sad' | 'angry'; Icon: LucideIcon; label: string }[] = [
  { id: 'cool',  Icon: Smile,       label: 'Cool' },
  { id: 'love',  Icon: Heart,       label: 'Love' },
  { id: 'wow',   Icon: PartyPopper, label: 'Wow' },
  { id: 'sad',   Icon: Frown,       label: 'Sad' },
  { id: 'angry', Icon: Angry,       label: 'Angry' },
];

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'wha', label: "What's Happening" },
  { id: 'poll', label: 'Polls' },
  { id: 'rateme', label: 'Rate Me' },
  { id: 'reel', label: 'Reels' },
];

export default function FeedPage() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const { radius } = useDistance();
  const router = useRouter();
  const [wha, setWha] = useState<WhaPost[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [rms, setRms] = useState<RateMeSession[]>([]);
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'wha' | 'poll' | 'rateme' | 'reel'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [loaded, setLoaded] = useState({ wha: false, polls: false, rms: false, reels: false, stories: false });
  const [shareAttachment, setShareAttachment] = useState<ChatAttachment | null>(null);
  useEffect(() => listenWhaFeed((v) => { setWha(v); setLoaded((s) => ({ ...s, wha: true })); }), []);
  useEffect(() => listenActiveStories((v) => { setStories(v); setLoaded((s) => ({ ...s, stories: true })); }), []);
  // Defer the heavier listeners until the browser is idle so the
  // first paint isn't blocked by 3 extra RTDB round-trips. On most
  // devices this fires within ~50ms of mount, so the user never sees
  // a hole \u2014 they just get the most-important content first.
  useEffect(() => {
    let cancelled = false;
    const subs: Array<() => void> = [];
    const idle = (window as any).requestIdleCallback || ((cb: () => void) => setTimeout(cb, 60));
    const cancelIdle = (window as any).cancelIdleCallback || clearTimeout;
    const handle = idle(() => {
      if (cancelled) return;
      subs.push(listenPollFeed((v) => { setPolls(v); setLoaded((s) => ({ ...s, polls: true })); }));
      subs.push(listenActiveRateMe((v) => { setRms(v); setLoaded((s) => ({ ...s, rms: true })); }));
      subs.push(listenReels((v) => { setReels(v); setLoaded((s) => ({ ...s, reels: true })); }));
    });
    return () => { cancelled = true; cancelIdle(handle); subs.forEach((u) => { try { u(); } catch {} }); };
  }, []);
  const isLoading = !loaded.wha || !loaded.polls || !loaded.rms || !loaded.reels;

  // Group all active stories by author for the strip. The first story
  // chronologically per user determines the slot's position; ordering
  // follows the service (newest poster first) but the user's own group
  // is always pinned to the front.
  const storyGroups = useMemo(() => {
    const map = new Map<string, { uid: string; authorName: string; authorPhoto?: string; items: StoryItem[] }>();
    for (const s of stories) {
      const g = map.get(s.uid) ?? { uid: s.uid, authorName: s.authorName, authorPhoto: s.authorPhoto, items: [] };
      g.items.push(s);
      map.set(s.uid, g);
    }
    const all = Array.from(map.values());
    all.forEach((g) => g.items.sort((a, b) => a.createdAt - b.createdAt));
    const me = user?.uid ? all.find((g) => g.uid === user.uid) ?? null : null;
    const others = all.filter((g) => g.uid !== user?.uid);
    return me ? [me, ...others] : others;
  }, [stories, user?.uid]);
  const myStoryGroup = storyGroups.find((g) => g.uid === user?.uid) ?? null;
  const orderedStories = useMemo(() => storyGroups.flatMap((g) => g.items), [storyGroups]);
  const items: FeedItem[] = useMemo(() => {
    const a: FeedItem[] = [
      ...wha.map((d) => ({ kind: 'wha' as const, data: d })),
      ...polls.map((d) => ({ kind: 'poll' as const, data: d })),
      ...rms.map((d) => ({ kind: 'rateme' as const, data: d })),
      ...reels.map((d) => ({ kind: 'reel' as const, data: d })),
    ];
    // Effective timestamp: polls sort by createdAt while open, but get
    // demoted to their endsAt once they're past it so finished polls
    // naturally drift down the wall as fresh content comes in.
    const now = Date.now();
    const effTs = (it: FeedItem): number => {
      if (it.kind === 'poll') {
        const p = it.data;
        if (p.endsAt && p.endsAt < now) return p.endsAt; // ended -> use end time, not createdAt
        return p.createdAt;
      }
      return tsOf(it);
    };
    a.sort((x, y) => effTs(y) - effTs(x));
    return a.filter((it) => filter === 'all' || it.kind === filter)
      .filter((it) => withinRadius(it, coords, radius));
  }, [wha, polls, rms, reels, filter, coords, radius]);

  const openOwnStory = () => {
    if (myStoryGroup && myStoryGroup.items[0]) {
      const firstId = myStoryGroup.items[0].id;
      const index = orderedStories.findIndex((s) => s.id === firstId);
      setViewerIndex(index >= 0 ? index : 0);
      return;
    }
    router.push('/story/create');
  };

  return (
    <SkeletonTheme baseColor="#FBE7EB" highlightColor="#FFF4F6">
    <div className="min-h-screen pb-24 md:pb-10">

      <section className="canact-stories-strip flex items-center gap-2 pt-1 pb-2">
        <div className="canact-stories-fade min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <div className="flex min-w-max items-center gap-3 pr-2">
            {/* Own story tile. The avatar fills the rounded square; a
                centered plus badge sits at the bottom-middle when the
                user has no active story (tap to create), otherwise the
                tile shows the same accent / grey ring rules as friends'
                stories so the user can tell at a glance whether anything
                fresh is sitting in their archive. */}
            <button type="button" onClick={openOwnStory} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
              <StoryRing
                state={myStoryGroup ? 'unwatched' : 'none'}
                src={profile?.photoURL ?? null}
                fallback={(profile?.fullName?.[0] ?? '?').toUpperCase()}
                showPlus={!myStoryGroup}
              />
              <span className="text-[10px] font-semibold text-ink/70 truncate w-full text-center">Your Story</span>
            </button>

            {!loaded.stories && stories.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`s_skel_${i}`} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
                  <Skeleton width={56} height={64} borderRadius={16} />
                  <Skeleton width={40} height={8} />
                </div>
              ))
            ) : storyGroups.filter((g) => g.uid !== user?.uid).map((group) => {
              const allWatched = group.items.every((s) => !!s.viewers?.[user!.uid]);
              return (
                <button
                  key={group.uid}
                  type="button"
                  onClick={() => setViewerIndex(orderedStories.findIndex((item) => item.id === group.items[0].id))}
                  className="flex w-[68px] shrink-0 flex-col items-center gap-1"
                >
                  <StoryRing
                    state={allWatched ? 'watched' : 'unwatched'}
                    src={group.authorPhoto ?? null}
                    fallback={(group.authorName?.[0] ?? '?').toUpperCase()}
                  />
                  <span className="text-[10px] font-semibold text-ink/70 truncate w-full text-center">{group.authorName?.split(' ')[0] ?? ''}</span>
                </button>
              );
            })}
          </div>
        </div>
        {/* Filter trigger \u2014 same visual size as a story ring, inline so it always sits in line */}
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          aria-label="Filter feed"
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-brand border border-line"
        >
          <SlidersHorizontal size={18} />
          {filter !== 'all' && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-white" />
          )}
        </button>
      </section>

      <div className="canact-filters-wrap" />

      {/* Today's reels banner \u2014 compact, gradient, taps into the vertical
          reels scroller. Hidden when filter excludes reels or none exist. */}
      {reels.length > 0 && (filter === 'all' || filter === 'reel') && (
        <Link
          href="/reels"
          prefetch
          className="mt-1 mb-3 flex items-center gap-3 rounded-2xl border border-[#FFE4E6] bg-gradient-to-r from-[#FFF1F2] to-white px-3 py-2.5 active:scale-[0.99] transition"
        >
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#FF6B7A] text-white">
            <Play size={20} fill="currentColor" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold leading-tight">Today's reels</div>
            <div className="text-[11px] text-muted">
              {reels.length} new {reels.length === 1 ? 'reel' : 'reels'} from your circle
            </div>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-brand ring-1 ring-brand/20">
            Watch
          </span>
        </Link>
      )}

      <section className="pt-1">
        {isLoading && items.length === 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Skeleton height={288} borderRadius={24} /></div>
            <Skeleton height={224} borderRadius={24} />
            <Skeleton height={224} borderRadius={24} />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[30px] border border-dashed border-[#E8C8CE] bg-white/70 px-6 py-12 text-center text-muted shadow-[0_18px_36px_-26px_rgba(10,10,10,0.16)]">
            Nothing here yet. Be the first to post around you.
          </div>
        ) : null}

        {/* Two-column Instagram-style grid. Polls / Rate-Me / text-only
            posts always span both columns. Among media-bearing tiles we
            keep an Insta-like rhythm: every third media post (starting
            with the first) is full-width, the rest pair up. */}
        <div className="grid grid-cols-2 gap-3">
          {(() => {
            let mediaIdx = 0;
            return items.map((it) => {
              const hasMedia =
                (it.kind === 'wha' && (it.data.mediaUrls?.length ?? 0) > 0) ||
                it.kind === 'reel';
              if (!hasMedia) {
                if (it.kind === 'poll') {
                  return <div key={`poll_${it.data.id}`} className="col-span-2 [content-visibility:auto] [contain-intrinsic-size:auto_320px]"><PollCard poll={it.data} myUid={user!.uid} /></div>;
                }
                if (it.kind === 'rateme') {
                  return <div key={`rm_${it.data.id}`} className="col-span-2 [content-visibility:auto] [contain-intrinsic-size:auto_360px]"><RateMeCard sess={it.data} myUid={user!.uid} /></div>;
                }
                return <div key={`wha_${it.data.id}`} className="col-span-2 [content-visibility:auto] [contain-intrinsic-size:auto_220px]"><WhaTextCard post={it.data} myUid={user!.uid} onShare={setShareAttachment} /></div>;
              }
              const isFull = mediaIdx % 3 === 0;
              mediaIdx += 1;
              const span = isFull ? 'col-span-2' : 'col-span-1';
              const height = isFull ? 'h-72' : 'h-56';
              const cv = '[content-visibility:auto] [contain-intrinsic-size:auto_360px]';
              if (it.kind === 'reel') {
                return (
                  <div key={`reel_${it.data.id}`} className={`${span} ${cv}`}>
                    <ReelTile reel={it.data} myUid={user!.uid} onShare={setShareAttachment} heightClass={height} />
                  </div>
                );
              }
              return (
                <div key={`wha_${it.data.id}`} className={`${span} ${cv}`}>
                  <WhaTile post={it.data} myUid={user!.uid} onShare={setShareAttachment} heightClass={height} />
                </div>
              );
            });
          })()}
        </div>
      </section>

      {viewerIndex !== null && orderedStories[viewerIndex] && user && profile ? (
        <StoryViewer
          stories={orderedStories}
          startIndex={viewerIndex}
          meUid={user.uid}
          meName={profile.fullName}
          mePhoto={profile.photoURL}
          onClose={() => setViewerIndex(null)}
          onDelete={async (uid, storyId) => {
            await deleteStory(uid, storyId);
            toast('Story removed', 'success');
          }}
        />
      ) : null}

      {filterOpen && (
        <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="Filter feed">
          <div className="grid grid-cols-2 gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setFilter(f.id as any); setFilterOpen(false); }}
                className={`rounded-2xl px-4 py-3 text-sm font-semibold border ${filter === f.id ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      <ShareToChatSheet
        open={!!shareAttachment}
        onClose={() => setShareAttachment(null)}
        attachment={shareAttachment}
      />
    </div>
    </SkeletonTheme>
  );
}

function tsOf(it: FeedItem) { return 'createdAt' in it.data ? it.data.createdAt : (it.data as any).startedAt; }
function withinRadius(it: FeedItem, c: { lat: number; lng: number } | null, r: number) {
  if (r === Infinity) return true;
  const d: any = it.data;
  if (d.lat == null || d.lng == null || !c) return true;
  return haversineMeters(c, { lat: d.lat, lng: d.lng }) <= r;
}

function WhaTextCard({ post, myUid, onShare }: { post: WhaPost; myUid: string; onShare: (a: ChatAttachment) => void }) {
  const myReact = post.reactionVoters?.[myUid];
  return (
    <article className="rounded-[24px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_18px_36px_-28px_rgba(10,10,10,0.18)]">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${post.uid}`}><Avatar src={post.authorPhoto} name={post.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${post.uid}`} className="font-bold truncate block">{post.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(post.createdAt)} \u2022 What's Happening</span>
        </div>
        <PostMenu isOwner={post.uid === myUid} onDelete={async () => { await deletePost(post.id, myUid); }} />
      </div>
      <Link href={`/post/${post.id}`} prefetch>
        {post.text && <p className="mt-2 whitespace-pre-wrap">{post.text}</p>}
      </Link>
      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
        {REACTIONS.map(({ id, Icon, label }) => (
          <button key={id} onClick={() => reactWha(post.id, myUid, id)} aria-label={label}
            className={`inline-flex items-center gap-1 rounded-full px-3 h-8 text-xs font-semibold border ${myReact === id ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}>
            <Icon size={14} /> {post.reactions?.[id] ?? 0}
          </button>
        ))}
        <Link href={`/post/${post.id}`} prefetch className="ml-auto rounded-full px-3 h-8 text-xs font-semibold border border-line bg-white inline-flex items-center gap-1">
          <MessageCircle size={14} /> {post.commentCount ?? 0}
        </Link>
        <button onClick={() => onShare({ kind: 'post', postId: post.id })} aria-label="Share"
          className="rounded-full px-3 h-8 text-xs font-semibold border border-line bg-white inline-flex items-center gap-1">
          <Send size={14} />
        </button>
      </div>
    </article>
  );
}

/** A media tile composed of two stacked sections inside a single white
 *  card: the media on top (image / autoplaying muted video) with a small
 *  pill badge floating bottom-left, and a white caption strip below
 *  showing 2-3 lines of caption + a "Read more" link, plus the like /
 *  comment / share row on the right so action buttons NEVER overlap the
 *  media. The whole tile is tappable; the action buttons stop
 *  propagation so they don't double-fire. */
function MediaOverlayTile({
  href,
  heightClass,
  badge,
  authorPhoto,
  authorName,
  authorUid,
  caption,
  liked,
  likeCount,
  commentCount,
  onLike,
  onShare,
  onDelete,
  isOwner,
  children,
}: {
  href: string;
  heightClass: string;
  badge?: React.ReactNode;
  authorPhoto?: string | null;
  authorName: string;
  authorUid: string;
  caption?: string | null;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onLike: () => void;
  onShare: () => void;
  onDelete?: () => Promise<void> | void;
  isOwner: boolean;
  children: React.ReactNode;
}) {
  const trimmed = (caption ?? '').trim();
  // ~70 chars per line × 2 → showLong threshold; CSS line-clamp also
  // limits wrap height so the "Read more" toggle always lines up.
  const isLong = trimmed.length > 90;
  const router = useRouter();
  return (
    <div className={`flex w-full flex-col overflow-hidden rounded-[24px] bg-white border border-[#F1D7DC] shadow-[0_18px_36px_-28px_rgba(10,10,10,0.18)]`}>
      {/* Media block \u2014 fixed height, the only place where overlays sit. */}
      <Link
        href={href}
        prefetch
        className={`relative block w-full ${heightClass} overflow-hidden bg-[#0E0E10] active:opacity-95 transition`}
      >
        <div className="absolute inset-0">{children}</div>
        {/* Top-left author pill */}
        <div className="absolute left-2 top-2 right-2 flex items-start justify-between gap-2">
          <div onClick={(e) => e.stopPropagation()} className="pointer-events-auto">
            <Link href={`/profile/${authorUid}`} className="inline-flex items-center gap-1.5 rounded-full bg-white/90 backdrop-blur px-1.5 py-1 pr-2.5 max-w-[60vw] shadow-sm">
              <span className="inline-block h-6 w-6 rounded-full overflow-hidden ring-1 ring-brand/40">
                <Avatar src={authorPhoto} name={authorName} size={24} />
              </span>
              <span className="text-[11px] font-bold text-ink truncate">{authorName}</span>
            </Link>
          </div>
          {isOwner && onDelete ? (
            <div onClick={(e) => e.stopPropagation()} className="pointer-events-auto">
              <PostMenu isOwner onDelete={async () => { await onDelete(); }} />
            </div>
          ) : null}
        </div>
        {/* Bottom-left type badge (Reel / Photo / etc.) */}
        {badge ? (
          <div className="absolute left-2 bottom-2">
            {badge}
          </div>
        ) : null}
        {/* Bottom-right vertical action stack — like / comment / share
            sit inside the media area itself so the layout stays Insta-like.
            Each button has a translucent dark pill background so it stays
            legible against any photo. */}
        <div onClick={(e) => e.stopPropagation()} className="absolute right-2 bottom-2 flex flex-col items-center gap-1.5 pointer-events-auto">
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLike(); }} aria-label="Like" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm text-white">
            <Heart size={16} className={liked ? 'text-[#FF6B7A]' : 'text-white'} fill={liked ? '#FF6B7A' : 'none'} />
          </button>
          {likeCount > 0 && <span className="text-[10px] font-bold text-white drop-shadow">{likeCount}</span>}
          <Link href={href} prefetch onClick={(e) => e.stopPropagation()} aria-label="Comments" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm text-white">
            <MessageCircle size={16} />
          </Link>
          {commentCount > 0 && <span className="text-[10px] font-bold text-white drop-shadow">{commentCount}</span>}
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare(); }} aria-label="Share" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm text-white">
            <Send size={16} />
          </button>
        </div>
      </Link>

      {/* Caption-only strip on a white background. Action buttons live
          inside the media block (Insta-style) so they remain anchored to
          the visual itself. */}
      {trimmed ? (
        <div className="px-3 py-2 text-[12px] leading-snug text-ink">
          <span className="line-clamp-2 whitespace-pre-wrap">{trimmed}</span>
          {isLong ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); router.push(href); }}
              className="mt-0.5 text-[11px] font-bold text-brand"
            >
              Read more
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WhaTile({ post, myUid, onShare, heightClass }: { post: WhaPost; myUid: string; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const myReact = post.reactionVoters?.[myUid];
  const liked = myReact === 'love';
  const totalReactions = post.reactions
    ? Object.values(post.reactions).reduce((a, b) => a + (b ?? 0), 0)
    : 0;
  const cover = post.mediaUrls?.[0];
  const coverPoster = post.mediaPosters?.[0] || undefined;
  const isVideo = cover ? isVideoUrl(cover) : false;
  return (
    <MediaOverlayTile
      href={`/post/${post.id}`}
      heightClass={heightClass}
      authorPhoto={post.authorPhoto}
      authorName={post.authorName}
      authorUid={post.uid}
      caption={post.text}
      liked={liked}
      likeCount={totalReactions}
      commentCount={post.commentCount ?? 0}
      onLike={() => reactWha(post.id, myUid, 'love')}
      onShare={() => onShare({ kind: 'post', postId: post.id })}
      isOwner={post.uid === myUid}
      onDelete={async () => { await deletePost(post.id, myUid); }}
      badge={isVideo ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-black/60 backdrop-blur text-white px-2 h-6 text-[10px] font-bold shadow-sm">
          <Play size={10} fill="currentColor" /> Video
        </span>
      ) : undefined}
    >
      {cover && isVideo ? (
        <VideoPreview src={cover} poster={coverPoster} className="h-full w-full" fit="cover" autoPlay loop initialMuted />
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverPoster || cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : null}
    </MediaOverlayTile>
  );
}

function PollCard({ poll, myUid }: { poll: Poll; myUid: string }) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const total = options.reduce((s, o) => s + (o.votes ?? 0), 0);
  const mine = poll.voters?.[myUid];
  const ended = poll.endsAt < Date.now();
  const isOwner = poll.uid === myUid;
  return (
    <article className="relative rounded-[24px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_18px_36px_-28px_rgba(10,10,10,0.18)]">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${poll.uid}`}><Avatar name={poll.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${poll.uid}`} className="font-bold truncate block">{poll.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(poll.createdAt)} \u2022 Poll \u2022 {ended ? 'Ended' : timeLeft(poll.endsAt)}</span>
        </div>
        {isOwner ? (
          <PostMenu
            isOwner
            onDelete={async () => {
              try { await deletePoll(poll.id, myUid); toast('Poll deleted', 'success'); }
              catch (e: any) { toast(e?.message ?? 'Could not delete poll', 'error'); }
            }}
          />
        ) : null}
      </div>
      <p className="mt-2 font-semibold">{poll.question}</p>
      <div className="mt-2 space-y-2">
        {options.map((o) => {
          const pct = total ? Math.round((o.votes / total) * 100) : 0;
          const selected = mine === o.id;
          return (
            <button key={o.id} disabled={ended} onClick={() => votePoll(poll.id, myUid, o.id)}
              className={`w-full text-left relative overflow-hidden rounded-xl border ${selected ? 'border-brand' : 'border-line'} bg-white px-3 py-2.5`}>
              <div className="absolute inset-y-0 left-0 bg-brand-light/70" style={{ width: `${pct}%` }} />
              <div className="relative flex justify-between items-center">
                <span className="font-medium">{o.text}</span>
                <span className="text-xs text-muted">{pct}% \u2022 {o.votes}</span>
              </div>
            </button>
          );
        })}
        {poll.openEnded && options.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-white px-3 py-2 text-xs text-muted">
            Open-ended poll. Reply in comments to participate.
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex gap-2 text-xs text-muted">
        <Link href={`/poll/${poll.id}`} className="rounded-full px-3 h-8 inline-flex items-center font-semibold border border-line bg-white">Open</Link>
        <span className="ml-auto self-center">{total} votes</span>
      </div>
    </article>
  );
}

function RateMeCard({ sess, myUid }: { sess: RateMeSession; myUid: string }) {
  const isOwner = sess.uid === myUid;
  const my = sess.votes?.[myUid];
  return (
    <article className="rounded-[24px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_18px_36px_-28px_rgba(10,10,10,0.18)]">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${sess.uid}`}><Avatar src={sess.photoURL} name={sess.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${sess.uid}`} className="font-bold truncate block">{sess.authorName}</Link>
          <span className="text-xs text-muted">Rate Me \u2022 {timeLeft(sess.endsAt)}</span>
        </div>
      </div>
      {sess.photoURL && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sess.photoURL} alt="" loading="lazy" decoding="async" className="mt-3 w-full max-h-96 object-cover rounded-[20px]" />
      )}
      <div className="mt-3 flex gap-2">
        <Button variant={my === 'like' ? 'primary' : 'outline'} disabled={isOwner} onClick={async () => { try { await voteRateMe(sess.id, myUid, 'like'); } catch (e: any) { toast(e.message, 'error'); } }}>
          <ThumbsUp size={16} className="mr-1" /> {sess.likes ?? 0}
        </Button>
        <Button variant={my === 'dislike' ? 'primary' : 'outline'} disabled={isOwner} onClick={async () => { try { await voteRateMe(sess.id, myUid, 'dislike'); } catch (e: any) { toast(e.message, 'error'); } }}>
          <ThumbsDown size={16} className="mr-1" /> {sess.dislikes ?? 0}
        </Button>
      </div>
    </article>
  );
}

function ReelTile({ reel, myUid, onShare, heightClass }: { reel: ReelItem; myUid: string; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const liked = !!(reel.likes && reel.likes[myUid]);
  const likeCount = reel.likes ? Object.keys(reel.likes).length : 0;
  return (
    <MediaOverlayTile
      href={`/reel/${reel.id}`}
      heightClass={heightClass}
      authorPhoto={reel.authorPhoto}
      authorName={reel.authorName}
      authorUid={reel.uid}
      caption={reel.caption}
      liked={liked}
      likeCount={likeCount}
      commentCount={0}
      onLike={() => { /* like-toggle requires reels service \u2014 fall back to detail */ }}
      onShare={() => onShare({ kind: 'reel', reelId: reel.id })}
      isOwner={reel.uid === myUid}
      onDelete={async () => { await deleteReel(reel.id, myUid); }}
      badge={(
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FF6B7A] text-white px-2 h-6 text-[10px] font-bold shadow-sm">
          <Play size={10} fill="currentColor" /> Reel
        </span>
      )}
    >
      <VideoPreview src={reel.videoUrl} poster={reel.posterUrl} className="h-full w-full" fit="cover" autoPlay loop initialMuted />
    </MediaOverlayTile>
  );
}

/** Story-strip avatar tile. The visual ring around the avatar communicates
 *  story state: solid brand-coloured for unwatched (animated breathing
 *  highlight), flat grey for watched, and no ring at all when the user
 *  has nothing to show. The optional plus badge hangs centred below the
 *  avatar so users can post their first story without taking screen
 *  estate from the actual visual ring state. */
function StoryRing({
  state,
  src,
  fallback,
  showPlus,
}: {
  state: 'unwatched' | 'watched' | 'none';
  src?: string | null;
  fallback: string;
  showPlus?: boolean;
}) {
  const ringClass =
    state === 'unwatched'
      ? 'canact-glow-border p-[2px]'
      : state === 'watched'
        ? 'bg-[#E5E0E1] p-[2px]'
        : 'p-0';
  return (
    <div className="relative">
      <div className={`rounded-[18px] ${ringClass}`}>
        <div className={state === 'none' ? 'rounded-[18px] bg-white p-[2px]' : 'rounded-[16px] bg-white p-[2px]'}>
          <div className={`h-16 w-14 overflow-hidden ${state === 'none' ? 'rounded-[16px]' : 'rounded-[14px]'} bg-brand-light/40`}>
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs font-bold text-brand">{fallback}</div>
            )}
          </div>
        </div>
      </div>
      {showPlus ? (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white shadow-sm">
          <Plus size={12} />
        </span>
      ) : null}
    </div>
  );
}
