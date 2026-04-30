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
import { listenPollFeed, votePoll } from '@/lib/services/poll';
import { listenActiveRateMe, voteRateMe } from '@/lib/services/rateme';
import { deleteStory, listenActiveStories } from '@/lib/services/stories';
import { listenReels, deleteReel } from '@/lib/services/reels';
import { FeedItem, Poll, RateMeSession, ReelItem, StoryItem, WhaPost } from '@/lib/types';
import { haversineMeters, timeAgo, timeLeft } from '@/lib/utils';
import { toast } from '@/components/Toaster';
import { MessageCircle, ThumbsUp, ThumbsDown, Smile, Heart, PartyPopper, Frown, Angry, Plus, Eye, SlidersHorizontal, Send, Play } from '@/components/icons';
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

  const myStory = stories.find((story) => story.uid === user?.uid) ?? null;
  const orderedStories = useMemo(() => {
    const others = stories.filter((story) => story.uid !== user?.uid);
    return myStory ? [myStory, ...others] : others;
  }, [stories, myStory, user?.uid]);
  const items: FeedItem[] = useMemo(() => {
    const a: FeedItem[] = [
      ...wha.map((d) => ({ kind: 'wha' as const, data: d })),
      ...polls.map((d) => ({ kind: 'poll' as const, data: d })),
      ...rms.map((d) => ({ kind: 'rateme' as const, data: d })),
      ...reels.map((d) => ({ kind: 'reel' as const, data: d })),
    ];
    a.sort((x, y) => tsOf(y) - tsOf(x));
    return a.filter((it) => filter === 'all' || it.kind === filter)
      .filter((it) => withinRadius(it, coords, radius));
  }, [wha, polls, rms, reels, filter, coords, radius]);

  const openOwnStory = () => {
    if (myStory) {
      const index = orderedStories.findIndex((story) => story.uid === myStory.uid);
      setViewerIndex(index >= 0 ? index : 0);
      return;
    }
    router.push('/story/create');
  };

  return (
    <SkeletonTheme baseColor="#FBE7EB" highlightColor="#FFF4F6">
    <div className="min-h-screen pb-24 md:pb-10">

      <section className="canact-stories-strip flex items-center gap-2 py-2">
        <div className="canact-stories-fade min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <div className="flex min-w-max items-center gap-3 pr-2">
            {/* Own story \u2014 soft pink ring without the breathing animation
                so the user's own avatar doesn't pull attention away from
                friends' fresh stories. */}
            <button type="button" onClick={openOwnStory} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
              <div className="rounded-[18px] bg-gradient-to-br from-[#FFD8DD] to-[#FFB3B8] p-[2px]">
                <div className="rounded-[16px] bg-white p-[2px]">
                  <div className="relative h-16 w-14 overflow-hidden rounded-[14px] bg-brand-light/40">
                    {profile?.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={profile.photoURL} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-bold text-brand">{(profile?.fullName?.[0] ?? '?').toUpperCase()}</div>
                    )}
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white shadow-sm">
                      {myStory ? <Eye size={10} /> : <Plus size={12} />}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-[10px] font-semibold text-ink/70 truncate w-full text-center">Your Story</span>
            </button>

            {!loaded.stories && stories.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`s_skel_${i}`} className="flex w-[68px] shrink-0 flex-col items-center gap-1">
                  <Skeleton width={56} height={64} borderRadius={16} />
                  <Skeleton width={40} height={8} />
                </div>
              ))
            ) : orderedStories.filter((story) => story.uid !== user?.uid).map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={() => setViewerIndex(orderedStories.findIndex((item) => item.id === story.id))}
                className="flex w-[68px] shrink-0 flex-col items-center gap-1"
              >
                <div className="canact-glow-border rounded-[18px] p-[2px]">
                  <div className="rounded-[16px] bg-white p-[2px]">
                    <div className="h-16 w-14 overflow-hidden rounded-[14px] bg-brand-light/40">
                      {story.authorPhoto ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={story.authorPhoto} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-bold text-brand">{(story.authorName?.[0] ?? '?').toUpperCase()}</div>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-semibold text-ink/70 truncate w-full text-center">{story.authorName?.split(' ')[0] ?? ''}</span>
              </button>
            ))}
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
            posts always span both columns (they don't compress well into
            half tiles). Among media-bearing posts, every third (starting
            at the first) takes the full row; the rest pair up. */}
        <div className="grid grid-cols-2 gap-3">
          {(() => {
            let mediaIdx = 0;
            return items.map((it) => {
              const hasMedia =
                (it.kind === 'wha' && (it.data.mediaUrls?.length ?? 0) > 0) ||
                it.kind === 'reel';
              if (!hasMedia) {
                if (it.kind === 'poll') {
                  return <div key={`poll_${it.data.id}`} className="col-span-2"><PollCard poll={it.data} myUid={user!.uid} /></div>;
                }
                if (it.kind === 'rateme') {
                  return <div key={`rm_${it.data.id}`} className="col-span-2"><RateMeCard sess={it.data} myUid={user!.uid} /></div>;
                }
                // wha without media \u2014 text-only tile, full-width
                return <div key={`wha_${it.data.id}`} className="col-span-2"><WhaTextCard post={it.data} myUid={user!.uid} onShare={setShareAttachment} /></div>;
              }
              const isFull = mediaIdx % 3 === 0;
              mediaIdx += 1;
              const span = isFull ? 'col-span-2' : 'col-span-1';
              const height = isFull ? 'h-72' : 'h-56';
              if (it.kind === 'reel') {
                return (
                  <div key={`reel_${it.data.id}`} className={span}>
                    <ReelTile reel={it.data} myUid={user!.uid} onShare={setShareAttachment} heightClass={height} />
                  </div>
                );
              }
              return (
                <div key={`wha_${it.data.id}`} className={span}>
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
          onDelete={async (uid) => {
            await deleteStory(uid);
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

/** A square-ish image-overlay tile shared by media Wha posts and Reels.
 *  The first image is the hero; user pill sits top-left, action stack
 *  on the right, caption bottom-left over a soft black gradient.
 *  Tapping the tile opens the post detail; the action buttons stop
 *  propagation so they don't double-fire. */
function MediaOverlayTile({
  href,
  heightClass,
  topRight,
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
  topRight?: React.ReactNode;
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
  return (
    <Link href={href} prefetch className={`relative block w-full ${heightClass} overflow-hidden rounded-[24px] bg-[#0E0E10] active:scale-[0.99] transition`}>
      {/* Media layer */}
      <div className="absolute inset-0">{children}</div>
      {/* Bottom shadow gradient \u2014 keeps caption legible without
          darkening the whole image. */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 50%)' }} />
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
        <div onClick={(e) => e.stopPropagation()} className="pointer-events-auto flex items-center gap-1.5">
          {topRight}
          {isOwner && onDelete ? (
            <span className="inline-flex items-center justify-center rounded-full bg-white/90 backdrop-blur h-7 w-7 shadow-sm">
              <PostMenu isOwner onDelete={async () => { await onDelete(); }} />
            </span>
          ) : null}
        </div>
      </div>
      {/* Bottom-left caption */}
      {caption ? (
        <div className="absolute left-2 right-12 bottom-2 text-white text-[12px] font-medium leading-tight line-clamp-2 drop-shadow">
          {caption}
        </div>
      ) : null}
      {/* Right action stack */}
      <div onClick={(e) => e.stopPropagation()} className="pointer-events-auto absolute right-2 bottom-2 flex flex-col items-center gap-1.5">
        <button onClick={(e) => { e.preventDefault(); onLike(); }} aria-label="Like" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm">
          <Heart size={16} className={liked ? 'text-[#FF6B7A]' : 'text-ink/70'} fill={liked ? '#FF6B7A' : 'none'} />
        </button>
        {likeCount > 0 && <span className="text-[10px] font-bold text-white drop-shadow">{likeCount}</span>}
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm">
          <MessageCircle size={16} className="text-ink/70" />
        </span>
        {commentCount > 0 && <span className="text-[10px] font-bold text-white drop-shadow">{commentCount}</span>}
        <button onClick={(e) => { e.preventDefault(); onShare(); }} aria-label="Share" className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 shadow-sm">
          <Send size={16} className="text-ink/70" />
        </button>
      </div>
    </Link>
  );
}

function WhaTile({ post, myUid, onShare, heightClass }: { post: WhaPost; myUid: string; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const myReact = post.reactionVoters?.[myUid];
  const liked = myReact === 'love';
  const totalReactions = post.reactions
    ? Object.values(post.reactions).reduce((a, b) => a + (b ?? 0), 0)
    : 0;
  const cover = post.mediaUrls?.[0];
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
    >
      {cover && isVideo ? (
        <VideoPreview src={cover} className="h-full w-full" fit="cover" autoPlay={false} initialMuted />
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : null}
    </MediaOverlayTile>
  );
}

function PollCard({ poll, myUid }: { poll: Poll; myUid: string }) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const total = options.reduce((s, o) => s + (o.votes ?? 0), 0);
  const mine = poll.voters?.[myUid];
  const ended = poll.endsAt < Date.now();
  return (
    <article className="rounded-[24px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_18px_36px_-28px_rgba(10,10,10,0.18)]">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${poll.uid}`}><Avatar name={poll.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${poll.uid}`} className="font-bold truncate block">{poll.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(poll.createdAt)} \u2022 Poll \u2022 {ended ? 'Ended' : timeLeft(poll.endsAt)}</span>
        </div>
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
      topRight={(
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FF6B7A] text-white px-2 h-7 text-[10px] font-bold shadow-sm">
          <Play size={10} fill="currentColor" /> Reel
        </span>
      )}
    >
      <VideoPreview src={reel.videoUrl} className="h-full w-full" fit="cover" autoPlay={false} initialMuted />
    </MediaOverlayTile>
  );
}
