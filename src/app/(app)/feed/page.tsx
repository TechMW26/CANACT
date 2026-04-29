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
import { MediaSlider } from '@/components/MediaSlider';
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
  useEffect(() => listenPollFeed((v) => { setPolls(v); setLoaded((s) => ({ ...s, polls: true })); }), []);
  useEffect(() => listenActiveRateMe((v) => { setRms(v); setLoaded((s) => ({ ...s, rms: true })); }), []);
  useEffect(() => listenReels((v) => { setReels(v); setLoaded((s) => ({ ...s, reels: true })); }), []);
  useEffect(() => listenActiveStories((v) => { setStories(v); setLoaded((s) => ({ ...s, stories: true })); }), []);
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
          <div className="flex min-w-max items-center gap-2.5 pr-2">
            <button type="button" onClick={openOwnStory} className="flex w-[64px] shrink-0 items-center justify-center">
              <div className="relative rounded-full bg-[conic-gradient(from_180deg_at_50%_50%,#C8102E,#FFD8DD,#FECACA,#C8102E)] p-[2px]">
                <div className="rounded-full bg-white p-[2px]">
                  <div className="relative">
                    <Avatar src={profile?.photoURL ?? null} name={profile?.fullName} size={56} />
                    <span className="absolute bottom-0 right-0 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white ring-2 ring-white">
                      {myStory ? <Eye size={10} /> : <Plus size={12} />}
                    </span>
                  </div>
                </div>
              </div>
            </button>

            {!loaded.stories && stories.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`s_skel_${i}`} className="flex w-[64px] shrink-0 items-center justify-center">
                  <Skeleton circle width={60} height={60} />
                </div>
              ))
            ) : orderedStories.filter((story) => story.uid !== user?.uid).map((story) => (
              <button
                key={story.id}
                type="button"
                onClick={() => setViewerIndex(orderedStories.findIndex((item) => item.id === story.id))}
                className="flex w-[64px] shrink-0 items-center justify-center"
              >
                <div className="rounded-full bg-[conic-gradient(from_180deg_at_50%_50%,#C8102E,#FFD8DD,#FECACA,#C8102E)] p-[2px]">
                  <div className="rounded-full bg-white p-[2px]">
                    <Avatar src={story.authorPhoto ?? null} name={story.authorName} size={56} />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
        {/* Filter trigger — same visual size as a story ring, inline so it always sits in line */}
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

      {/* Today's reels banner — drops users straight into the vertical
          scroller. Hidden when the user has filtered to a non-reel kind
          or when there are no reels at all. */}
      {reels.length > 0 && (filter === 'all' || filter === 'reel') && (
        <Link
          href="/reels"
          prefetch
          className="mt-1 mb-3 flex items-center gap-3 rounded-[28px] border border-[#F1D7DC] bg-gradient-to-r from-white via-brand-light/40 to-white px-4 py-3 shadow-[0_18px_36px_-26px_rgba(10,10,10,0.18)] active:scale-[0.99] transition"
        >
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-[0_8px_18px_-8px_rgba(200,16,46,0.6)]">
            <Play size={22} fill="currentColor" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold leading-tight">Today's reels</div>
            <div className="text-xs text-muted">
              {reels.length} {reels.length === 1 ? 'reel' : 'reels'} from your circle
            </div>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-brand ring-1 ring-brand/20">
            Watch
          </span>
        </Link>
      )}

      <section className="pt-1">
        {isLoading && items.length === 0 ? (
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <article key={`skel_${i}`} className="rounded-[30px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_22px_44px_-28px_rgba(10,10,10,0.22)]">
                <div className="flex items-center gap-3">
                  <Skeleton circle width={40} height={40} />
                  <div className="flex-1">
                    <Skeleton width={120} height={12} />
                    <Skeleton width={80} height={10} />
                  </div>
                </div>
                <div className="mt-3"><Skeleton height={14} count={2} /></div>
                <div className="mt-3"><Skeleton height={220} borderRadius={24} /></div>
              </article>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[30px] border border-dashed border-[#E8C8CE] bg-white/70 px-6 py-12 text-center text-muted shadow-[0_18px_36px_-26px_rgba(10,10,10,0.16)]">
            Nothing here yet. Be the first to post around you.
          </div>
        ) : null}

        <div className="space-y-6">
          {items.map((it) => it.kind === 'wha' ? (
            <WhaCard key={`wha_${it.data.id}`} post={it.data} myUid={user!.uid} onShare={setShareAttachment} />
          ) : it.kind === 'poll' ? (
            <PollCard key={`poll_${it.data.id}`} poll={it.data} myUid={user!.uid} />
          ) : it.kind === 'reel' ? (
            <ReelCard key={`reel_${it.data.id}`} reel={it.data} myUid={user!.uid} onShare={setShareAttachment} />
          ) : (
            <RateMeCard key={`rm_${it.data.id}`} sess={it.data} myUid={user!.uid} />
          ))}
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

function WhaCard({ post, myUid, onShare }: { post: WhaPost; myUid: string; onShare: (a: ChatAttachment) => void }) {
  const myReact = post.reactionVoters?.[myUid];
  return (
    <article className="rounded-[30px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_22px_44px_-28px_rgba(10,10,10,0.22)] backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${post.uid}`}><Avatar src={post.authorPhoto} name={post.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${post.uid}`} className="font-bold truncate block">{post.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(post.createdAt)} • What's Happening</span>
        </div>
        <PostMenu
          isOwner={post.uid === myUid}
          onDelete={async () => { await deletePost(post.id, myUid); }}
        />
      </div>
      <Link href={`/post/${post.id}`} prefetch>
        {post.text && <p className="mt-2 whitespace-pre-wrap">{post.text}</p>}
        {post.mediaUrls?.length ? (
          <div className="mt-3"><MediaSlider urls={post.mediaUrls} /></div>
        ) : null}
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

function PollCard({ poll, myUid }: { poll: Poll; myUid: string }) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const total = options.reduce((s, o) => s + (o.votes ?? 0), 0);
  const mine = poll.voters?.[myUid];
  const ended = poll.endsAt < Date.now();
  return (
    <article className="rounded-[30px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_22px_44px_-28px_rgba(10,10,10,0.22)] backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${poll.uid}`}><Avatar name={poll.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${poll.uid}`} className="font-bold truncate block">{poll.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(poll.createdAt)} • Poll • {ended ? 'Ended' : timeLeft(poll.endsAt)}</span>
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
                <span className="text-xs text-muted">{pct}% • {o.votes}</span>
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
    <article className="rounded-[30px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_22px_44px_-28px_rgba(10,10,10,0.22)] backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${sess.uid}`}><Avatar src={sess.photoURL} name={sess.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${sess.uid}`} className="font-bold truncate block">{sess.authorName}</Link>
          <span className="text-xs text-muted">Rate Me • {timeLeft(sess.endsAt)}</span>
        </div>
      </div>
      {sess.photoURL && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sess.photoURL} alt="" className="mt-3 w-full max-h-96 object-cover rounded-[24px]" />
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

function ReelCard({ reel, myUid, onShare }: { reel: ReelItem; myUid: string; onShare: (a: ChatAttachment) => void }) {
  const likeCount = reel.likes ? Object.keys(reel.likes).length : 0;
  return (
    <article className="rounded-[30px] border border-[#F1D7DC] bg-white/92 p-4 shadow-[0_22px_44px_-28px_rgba(10,10,10,0.22)] backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${reel.uid}`}>
          <Avatar src={reel.authorPhoto} name={reel.authorName} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/profile/${reel.uid}`} className="block truncate font-bold">
            {reel.authorName}
          </Link>
          <span className="text-xs text-muted">{timeAgo(reel.createdAt)} • Reel</span>
        </div>
        <PostMenu
          isOwner={reel.uid === myUid}
          onDelete={async () => { await deleteReel(reel.id, myUid); }}
        />
      </div>
      {reel.caption ? <p className="mt-2 whitespace-pre-wrap">{reel.caption}</p> : null}
      <Link href={`/reel/${reel.id}`} prefetch className="mt-3 block">
        <VideoPreview
          src={reel.videoUrl}
          className="aspect-[9/16] w-full rounded-[24px]"
          fit="cover"
        />
      </Link>
      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand">
          <Heart size={14} /> {likeCount}
        </span>
        <Link
          href={`/reel/${reel.id}`}
          prefetch
          className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-ink/75"
        >
          Watch in Reels
        </Link>
        <button onClick={() => onShare({ kind: 'reel', reelId: reel.id })} aria-label="Share"
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-ink/75">
          <Send size={14} />
        </button>
      </div>
    </article>
  );
}
