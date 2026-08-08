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
import { listenPollFeed, votePoll, deletePoll, reactPoll } from '@/lib/services/poll';
import { deleteRateMeSession, listenActiveRateMe, voteRateMe } from '@/lib/services/rateme';
import { deleteStory, listenActiveStories } from '@/lib/services/stories';
import { listenReels, deleteReel, toggleReelReaction } from '@/lib/services/reels';
import { FeedItem, Poll, RateMeSession, ReelItem, StoryItem, WhaPost } from '@/lib/types';
import { haversineMeters, timeAgo, timeLeft } from '@/lib/utils';
import { toast } from '@/components/Toaster';
import { MessageCircle, ThumbsUp, ThumbsDown, Plus, SlidersHorizontal, Play, Share2 } from '@/components/icons';
import { isVideoUrl } from '@/components/CameraCapture';
import { VideoPreview } from '@/components/VideoPreview';
import { Sheet } from '@/components/Sheet';
import { ShareToChatSheet } from '@/components/ShareToChatSheet';
import { PostDetailSheet } from '@/components/PostDetailSheet';
import { PostMenu } from '@/components/PostMenu';
import { CANACT_REFRESH_EVENT } from '@/components/PullToRefresh';
import { readFeedCache, writeFeedCachePart } from '@/lib/feedCache';
import type { ChatAttachment } from '@/lib/types';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

type FeedDetailItem = Extract<FeedItem, { kind: 'wha' | 'poll' | 'rateme' }>;

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
  // Seed every list from the in-memory feed cache so a back-nav into
  // /feed paints with the EXACT data the user saw last time — no
  // skeleton flash, no scroll jump. The live listeners below then
  // patch in the freshest values without ever clearing the visible UI.
  const initial = readFeedCache(user?.uid);
  const [wha, setWha] = useState<WhaPost[]>(initial.wha);
  const [polls, setPolls] = useState<Poll[]>(initial.polls);
  const [rms, setRms] = useState<RateMeSession[]>(initial.rms);
  const [reels, setReels] = useState<ReelItem[]>(initial.reels);
  const [stories, setStories] = useState<StoryItem[]>(initial.stories);
  const [filter, setFilter] = useState<'all' | 'wha' | 'poll' | 'rateme' | 'reel'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // If we already have cached content, treat each list as 'loaded' so
  // the page doesn't show a skeleton while the listeners catch up.
  const seeded = initial.uid === user?.uid && initial.ts > 0;
  const [loaded, setLoaded] = useState({
    wha: seeded, polls: seeded, rms: seeded, reels: seeded, stories: seeded,
  });
  const [shareAttachment, setShareAttachment] = useState<ChatAttachment | null>(null);
  const [detailItem, setDetailItem] = useState<FeedDetailItem | null>(null);
  // Bumping this re-runs the listener effects below, which is how the
  // pull-to-refresh gesture forces fresh subscriptions.
  const [refreshTick, setRefreshTick] = useState(0);
  // Listen for the global pull-to-refresh event dispatched by AppShell's
  // <PullToRefresh /> so this page re-arms its RTDB listeners whenever
  // the user swipes down from anywhere in the app while on /feed.
  useEffect(() => {
    const onRefresh = () => setRefreshTick((n) => n + 1);
    window.addEventListener(CANACT_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(CANACT_REFRESH_EVENT, onRefresh);
  }, []);
  useEffect(() => listenWhaFeed((v) => {
    setWha(v); writeFeedCachePart(user?.uid, 'wha', v);
    setLoaded((s) => ({ ...s, wha: true }));
  }), [refreshTick, user?.uid]);
  useEffect(() => listenActiveStories((v) => {
    setStories(v); writeFeedCachePart(user?.uid, 'stories', v);
    setLoaded((s) => ({ ...s, stories: true }));
  }), [refreshTick, user?.uid]);
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
      subs.push(listenPollFeed((v) => {
        setPolls(v); writeFeedCachePart(user?.uid, 'polls', v);
        setLoaded((s) => ({ ...s, polls: true }));
      }));
      subs.push(listenActiveRateMe((v) => {
        setRms(v); writeFeedCachePart(user?.uid, 'rms', v);
        setLoaded((s) => ({ ...s, rms: true }));
      }));
      subs.push(listenReels((v) => {
        setReels(v); writeFeedCachePart(user?.uid, 'reels', v);
        setLoaded((s) => ({ ...s, reels: true }));
      }));
    });
    return () => { cancelled = true; cancelIdle(handle); subs.forEach((u) => { try { u(); } catch {} }); };
  }, [refreshTick, user?.uid]);
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
    <SkeletonTheme baseColor="#E6EEE9" highlightColor="#F3F1EB">
    <div className="canact-figma-feed pt-3 pb-4 md:pb-6" data-onboarding="feed">

      <section className="canact-stories-strip flex items-center gap-2 pb-2" data-onboarding="feed-stories">
        <div className="canact-stories-fade min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <div className="flex min-w-max items-center gap-3 pr-2">
            {/* Own story tile. The avatar fills the rounded square; a
                centered plus badge sits at the bottom-middle when the
                user has no active story (tap to create), otherwise the
                tile shows the same accent / grey ring rules as friends'
                stories so the user can tell at a glance whether anything
                fresh is sitting in their archive. */}
            <button type="button" onClick={openOwnStory} className="flex w-[82px] shrink-0 flex-col items-center gap-2">
              <StoryRing
                state={myStoryGroup ? 'unwatched' : 'none'}
                src={profile?.photoURL ?? null}
                fallback={(profile?.fullName?.[0] ?? '?').toUpperCase()}
                showPlus={!myStoryGroup}
              />
              <span className="text-xs font-semibold text-ink/65 truncate w-full text-center">Add Yours</span>
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
                  className="flex w-[82px] shrink-0 flex-col items-center gap-2"
                >
                  <StoryRing
                    state={allWatched ? 'watched' : 'unwatched'}
                    src={group.authorPhoto ?? null}
                    fallback={(group.authorName?.[0] ?? '?').toUpperCase()}
                  />
                  <span className="text-xs font-semibold text-ink truncate w-full text-center">{group.authorName?.split(' ')[0] ?? ''}</span>
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
          className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-brand border border-line"
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
          className="mt-1 mb-3 flex items-center gap-3 rounded-2xl border border-[#E4E7E2] bg-gradient-to-r from-[#F0F5F1] to-white px-3 py-2.5 active:scale-[0.99] transition"
        >
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2E8068] text-white">
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
          <div className="rounded-[30px] border border-dashed border-[#CADBD3] bg-white/70 px-6 py-12 text-center text-muted">
            Nothing here yet. Be the first to post around you.
          </div>
        ) : null}

        {/* Reference-grid rhythm: first card full width, then paired half cards. */}
        <div className="grid grid-cols-1 gap-7">
          {items.map((it, index) => {
              const span = 'col-span-1';
              const height = 'h-[286px]';
              const cv = 'canact-feed-card-wrap';
              if (it.kind === 'poll') {
                return (
                  <div key={`poll_${it.data.id}`} className={`${span} ${cv}`}>
                    <PollCard
                      poll={it.data}
                      myUid={user!.uid}
                      onOpen={() => setDetailItem({ kind: 'poll', data: it.data })}
                      onShare={setShareAttachment}
                      heightClass={height}
                    />
                  </div>
                );
              }
              if (it.kind === 'rateme') {
                return (
                  <div key={`rm_${it.data.id}`} className={`${span} ${cv}`}>
                    <RateMeCard
                      sess={it.data}
                      myUid={user!.uid}
                      onOpen={() => setDetailItem({ kind: 'rateme', data: it.data })}
                      onShare={setShareAttachment}
                      heightClass={height}
                    />
                  </div>
                );
              }
              if (it.kind === 'reel') {
                return (
                  <div key={`reel_${it.data.id}`} className={`${span} ${cv}`}>
                    <ReelTile reel={it.data} myUid={user!.uid} onShare={setShareAttachment} heightClass={height} />
                  </div>
                );
              }
              return (
                <div key={`wha_${it.data.id}`} className={`${span} ${cv}`}>
                  <WhaTile
                    post={it.data}
                    myUid={user!.uid}
                    onOpen={() => setDetailItem({ kind: 'wha', data: it.data })}
                    onShare={setShareAttachment}
                    heightClass={height}
                  />
                </div>
              );
            })}
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
                data-liquid-glass={filter === f.id ? 'switcher' : 'surface'}
                data-liquid-radius="16"
                data-liquid-blur="0"
                data-liquid-tint={filter === f.id ? '31,107,85' : '250,248,242'}
                data-liquid-tint-opacity={filter === f.id ? '0.22' : '0.08'}
                className={`rounded-2xl bg-transparent px-4 py-3 text-sm font-semibold ${filter === f.id ? 'text-brand' : 'text-ink'}`}
              >
                <span>{f.label}</span>
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
      <PostDetailSheet
        item={detailItem}
        myUid={user!.uid}
        myName={profile?.fullName ?? 'You'}
        onClose={() => setDetailItem(null)}
        onShare={setShareAttachment}
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

/** Shared reference-style feed tile used by every feed item type. */
function MediaOverlayTile({
  href,
  heightClass,
  badge,
  bottomContent,
  statText,
  authorPhoto,
  authorName,
  authorUid,
  caption,
  liked,
  disliked,
  likeCount,
  dislikeCount,
  commentCount,
  onOpen,
  onLike,
  onDislike,
  onShare,
  onDelete,
  isOwner,
  reactionsDisabled = false,
  children,
}: {
  href: string;
  heightClass: string;
  badge?: React.ReactNode;
  bottomContent?: React.ReactNode;
  statText?: string;
  authorPhoto?: string | null;
  authorName: string;
  authorUid: string;
  caption?: string | null;
  liked: boolean;
  disliked: boolean;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  onOpen?: () => void;
  onLike: () => void;
  onDislike: () => void;
  onShare: () => void;
  onDelete?: () => Promise<void> | void;
  isOwner: boolean;
  reactionsDisabled?: boolean;
  children: React.ReactNode;
}) {
  const trimmed = (caption ?? '').trim();
  const router = useRouter();
  const open = () => { if (onOpen) onOpen(); else router.push(href); };
  const defaultStatText = statText ?? [
    `${likeCount.toLocaleString()} ${likeCount === 1 ? 'like' : 'likes'}`,
    `${dislikeCount.toLocaleString()} ${dislikeCount === 1 ? 'dislike' : 'dislikes'}`,
    ...(commentCount ? [`${commentCount.toLocaleString()} ${commentCount === 1 ? 'comment' : 'comments'}`] : []),
  ].join(' · ');
  return (
    <article
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      }}
      className="canact-feed-card relative overflow-hidden rounded-3xl border border-[#E4E7E2] bg-white active:scale-[0.99] transition cursor-pointer"
    >
      <div className={`relative w-full ${heightClass} overflow-hidden bg-[#0E0E10]`}>
        <div className="absolute inset-0">{children}</div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />

        <div className="absolute left-3 top-3 right-3 flex items-start justify-between gap-2">
          <div onClick={(e) => e.stopPropagation()} className="pointer-events-auto">
            <Link href={`/profile/${authorUid}`} className="inline-flex items-center gap-2 rounded-full bg-white pl-1 pr-3 py-1 max-w-[60vw]">
              <span className="inline-block h-6 w-6 rounded-full overflow-hidden ring-2 ring-[#2E8068]">
                <Avatar src={authorPhoto} name={authorName} size={24} />
              </span>
              <span className="text-[11px] font-medium text-neutral-800 truncate">{authorName}</span>
            </Link>
          </div>
          {isOwner && onDelete ? (
            <div onClick={(e) => e.stopPropagation()} className="pointer-events-auto">
              <PostMenu isOwner onDelete={async () => { await onDelete(); }} />
            </div>
          ) : badge ? (
            <div>{badge}</div>
          ) : null}
        </div>

        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
          <div className="min-w-0 max-w-[70%] text-white">
            {bottomContent ?? (
              <>
                {trimmed ? (
                  <div className="line-clamp-2 whitespace-pre-wrap text-[12px] font-medium leading-tight">
                    {trimmed}
                  </div>
                ) : null}
                <div className="mt-0.5 text-[10px] text-white/80">
                  {defaultStatText}
                </div>
                {trimmed.length > 90 ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); open(); }}
                    className="mt-0.5 text-[10px] font-bold text-white/90"
                  >
                    Read more
                  </button>
                ) : null}
              </>
            )}
          </div>

          <div onClick={(e) => e.stopPropagation()} className="flex shrink-0 flex-col gap-1.5 pointer-events-auto">
            <button
              type="button"
              disabled={reactionsDisabled}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onLike(); }}
              aria-label="Like"
              aria-pressed={liked}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full active:scale-95 transition disabled:opacity-45 ${liked ? 'bg-[#2E8068] text-white' : 'bg-white text-[#2E8068]'}`}
            >
              <ThumbsUp size={15} fill={liked ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              disabled={reactionsDisabled}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDislike(); }}
              aria-label="Dislike"
              aria-pressed={disliked}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-full active:scale-95 transition disabled:opacity-45 ${disliked ? 'bg-[#B6534D] text-white' : 'bg-white text-[#9A4944]'}`}
            >
              <ThumbsDown size={15} fill={disliked ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); open(); }}
              aria-label="Comments"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-700 active:scale-95 transition"
            >
              <MessageCircle size={15} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare(); }}
              aria-label="Share"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-700 active:scale-95 transition"
            >
              <Share2 size={15} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function WhaTile({ post, myUid, onOpen, onShare, heightClass }: { post: WhaPost; myUid: string; onOpen: () => void; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const myReact = post.reactionVoters?.[myUid];
  const liked = myReact === 'cool' || myReact === 'love' || myReact === 'wow';
  const disliked = myReact === 'sad' || myReact === 'angry';
  const likeCount = Number(post.reactions?.cool || 0) + Number(post.reactions?.love || 0) + Number(post.reactions?.wow || 0);
  const dislikeCount = Number(post.reactions?.sad || 0) + Number(post.reactions?.angry || 0);
  const cover = post.mediaUrls?.[0];
  const coverPoster = post.mediaPosters?.[0] || undefined;
  const coverLqip = post.mediaLqips?.[0] || undefined;
  const isVideo = cover ? isVideoUrl(cover) : false;
  return (
    <MediaOverlayTile
      href={`/post/${post.id}`}
      heightClass={heightClass}
      authorPhoto={post.authorPhoto}
      authorName={post.authorName}
      authorUid={post.uid}
      caption={post.text || "What's Happening"}
      liked={liked}
      disliked={disliked}
      likeCount={likeCount}
      dislikeCount={dislikeCount}
      commentCount={post.commentCount ?? 0}
      onOpen={onOpen}
      onLike={() => reactWha(post.id, myUid, 'love')}
      onDislike={() => reactWha(post.id, myUid, 'angry')}
      onShare={() => onShare({ kind: 'post', postId: post.id })}
      isOwner={post.uid === myUid}
      onDelete={post.uid === myUid ? async () => { await deletePost(post.id, myUid); } : undefined}
      badge={<span className="inline-flex h-6 items-center rounded-full bg-[#2E8068] px-2 text-[10px] font-bold text-white">Post</span>}
    >
      {cover && isVideo ? (
        <VideoPreview src={cover} poster={coverPoster} className="h-full w-full" fit="cover" autoPlay loop initialMuted />
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coverPoster || cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover lqip-img" style={coverLqip ? { backgroundImage: `url(${coverLqip})`, backgroundSize: 'cover' } : undefined} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#dcece5] via-[#f0eee5] to-white p-8 text-center">
          <span className="line-clamp-5 text-2xl font-black leading-tight text-brand/80">{post.text || "What's Happening"}</span>
        </div>
      )}
    </MediaOverlayTile>
  );
}

function PollCard({ poll, myUid, onOpen, onShare, heightClass }: { poll: Poll; myUid: string; onOpen: () => void; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const total = options.reduce((s, o) => s + (o.votes ?? 0), 0);
  const mine = poll.voters?.[myUid];
  const myReaction = poll.reactionVoters?.[myUid];
  const ended = poll.endsAt < Date.now();
  const locked = ended || !!mine;
  const isOwner = poll.uid === myUid;
  return (
    <MediaOverlayTile
      href={`/poll/${poll.id}`}
      heightClass={heightClass}
      authorName={poll.authorName}
      authorUid={poll.uid}
      caption={poll.question}
      liked={myReaction === 'like'}
      disliked={myReaction === 'dislike'}
      likeCount={poll.likes ?? 0}
      dislikeCount={poll.dislikes ?? 0}
      commentCount={poll.commentCount ?? 0}
      onOpen={onOpen}
      onLike={() => reactPoll(poll.id, myUid, 'like')}
      onDislike={() => reactPoll(poll.id, myUid, 'dislike')}
      onShare={() => onShare({ kind: 'poll', pollId: poll.id, authorName: poll.authorName, question: poll.question, thumbUrl: poll.photoURL })}
      isOwner={isOwner}
      onDelete={isOwner ? async () => {
        try { await deletePoll(poll.id, myUid); toast('Poll deleted', 'success'); }
        catch (error: any) { toast(error?.message ?? 'Could not delete poll', 'error'); }
      } : undefined}
      badge={<span className="inline-flex h-6 items-center rounded-full bg-[#2E8068] px-2 text-[10px] font-bold text-white">Poll</span>}
      statText={`${total} votes · ${ended ? 'Ended' : timeLeft(poll.endsAt)}`}
      bottomContent={(
        <div>
          <div className="line-clamp-2 text-[12px] font-bold leading-tight text-white">{poll.question}</div>
          <div className="mt-1.5 space-y-1">
            {options.slice(0, 2).map((option) => {
              const pct = total ? Math.round((option.votes / total) * 100) : 0;
              const selected = mine === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={locked}
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (!locked) votePoll(poll.id, myUid, option.id); }}
                  className={`block max-w-full truncate rounded-full px-2 py-1 text-left text-[10px] font-bold disabled:opacity-75 ${selected ? 'bg-[#2E8068] text-white' : 'bg-white text-neutral-800'}`}
                >
                  {option.text} · {pct}%
                </button>
              );
            })}
          </div>
          <div className="mt-1 text-[10px] text-white/80">
            {total} {total === 1 ? 'vote' : 'votes'} · {poll.likes ?? 0} likes · {poll.dislikes ?? 0} dislikes · {ended ? 'Ended' : timeLeft(poll.endsAt)}
          </div>
        </div>
      )}
    >
      {poll.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poll.photoURL} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover lqip-img" style={poll.lqip ? { backgroundImage: `url(${poll.lqip})`, backgroundSize: 'cover' } : undefined} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F0F5F1] via-[#E4E7E2] to-white p-5 text-center">
          <span className="line-clamp-5 text-lg font-black leading-tight text-[#2E8068]/80">{poll.question}</span>
        </div>
      )}
    </MediaOverlayTile>
  );
}

function RateMeCard({ sess, myUid, onOpen, onShare, heightClass }: { sess: RateMeSession; myUid: string; onOpen: () => void; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const isOwner = sess.uid === myUid;
  const ended = sess.endsAt <= Date.now();
  const [optimistic, setOptimistic] = useState<{ kind: 'like' | 'dislike'; prev: 'like' | 'dislike' | undefined } | null>(null);
  const serverMy = sess.votes?.[myUid];
  useEffect(() => {
    if (optimistic && serverMy === optimistic.kind) setOptimistic(null);
  }, [serverMy, optimistic]);
  const my = optimistic ? optimistic.kind : serverMy;
  const locked = ended || isOwner || !!my;
  let likes = sess.likes ?? 0;
  let dislikes = sess.dislikes ?? 0;
  if (optimistic) {
    if (optimistic.prev === 'like') likes = Math.max(0, likes - 1);
    if (optimistic.prev === 'dislike') dislikes = Math.max(0, dislikes - 1);
    if (optimistic.kind === 'like') likes += 1;
    else dislikes += 1;
  }
  const total = likes + dislikes;
  const upPct = total ? Math.round((likes / total) * 100) : 0;
  const downPct = total ? 100 - upPct : 0;
  const cast = (kind: 'like' | 'dislike') => {
    if (locked) return;
    setOptimistic({ kind, prev: serverMy });
    voteRateMe(sess.id, myUid, kind).catch((error: any) => {
      setOptimistic(null);
      toast(error?.message ?? 'Could not vote', 'error');
    });
  };
  return (
    <MediaOverlayTile
      href={`/profile/${sess.uid}`}
      heightClass={heightClass}
      authorPhoto={sess.photoURL}
      authorName={sess.authorName}
      authorUid={sess.uid}
      caption="Rate Me"
      liked={my === 'like'}
      disliked={my === 'dislike'}
      likeCount={likes}
      dislikeCount={dislikes}
      commentCount={sess.commentCount ?? 0}
      onOpen={onOpen}
      onLike={() => cast('like')}
      onDislike={() => cast('dislike')}
      onShare={() => onShare({ kind: 'rateme', sessionId: sess.id })}
      isOwner={isOwner}
      reactionsDisabled={locked}
      onDelete={isOwner ? async () => { await deleteRateMeSession(sess.id, sess.uid); } : undefined}
      statText={`${likes} up · ${dislikes} down`}
      bottomContent={(
        <div>
          <div className="text-[12px] font-bold leading-tight text-white">Rate Me</div>
          <div className="mt-0.5 text-[10px] text-white/80">{likes} up · {dislikes} down · {ended ? 'Voting closed' : timeLeft(sess.endsAt)}</div>
          <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-white/25">
            <div style={{ width: `${downPct}%` }} className="bg-rose-300" />
            <div style={{ width: `${upPct}%` }} className="bg-emerald-300" />
          </div>
        </div>
      )}
    >
      {sess.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sess.photoURL} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover lqip-img" style={sess.lqip ? { backgroundImage: `url(${sess.lqip})`, backgroundSize: 'cover' } : undefined} />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#F0F5F1] via-[#E4E7E2] to-white p-5 text-center">
          <span className="text-lg font-black leading-tight text-[#2E8068]/80">Rate Me</span>
        </div>
      )}
    </MediaOverlayTile>
  );
}

function ReelTile({ reel, myUid, onShare, heightClass }: { reel: ReelItem; myUid: string; onShare: (a: ChatAttachment) => void; heightClass: string }) {
  const liked = !!(reel.likes && reel.likes[myUid]);
  const disliked = !!(reel.dislikes && reel.dislikes[myUid]);
  const likeCount = reel.likes ? Object.keys(reel.likes).length : 0;
  const dislikeCount = reel.dislikes ? Object.keys(reel.dislikes).length : 0;
  return (
    <MediaOverlayTile
      href={`/reel/${reel.id}`}
      heightClass={heightClass}
      authorPhoto={reel.authorPhoto}
      authorName={reel.authorName}
      authorUid={reel.uid}
      caption={reel.caption}
      liked={liked}
      disliked={disliked}
      likeCount={likeCount}
      dislikeCount={dislikeCount}
      commentCount={reel.commentCount ?? 0}
      onLike={() => toggleReelReaction(reel.id, myUid, 'like')}
      onDislike={() => toggleReelReaction(reel.id, myUid, 'dislike')}
      onShare={() => onShare({ kind: 'reel', reelId: reel.id })}
      isOwner={reel.uid === myUid}
      onDelete={async () => { await deleteReel(reel.id, myUid); }}
      badge={(
        <span className="inline-flex items-center gap-1 rounded-full bg-[#2E8068] text-white px-2 h-6 text-[10px] font-bold">
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
        : 'border-2 border-dashed border-[#1a3d2b] p-[2px]';
  return (
    <div className="relative">
      <div className={`rounded-full ${ringClass}`}>
        <div className="rounded-full bg-white p-[2px]">
          <div className="h-[70px] w-[70px] overflow-hidden rounded-full bg-brand-light/40">
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
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white">
          <Plus size={12} />
        </span>
      ) : null}
    </div>
  );
}
