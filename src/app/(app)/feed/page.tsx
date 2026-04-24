'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { listenWhaFeed, reactWha } from '@/lib/services/wha';
import { listenPollFeed, votePoll } from '@/lib/services/poll';
import { listenActiveRateMe, voteRateMe } from '@/lib/services/rateme';
import { FeedItem, Poll, RateMeSession, WhaPost } from '@/lib/types';
import { formatDistance, haversineMeters, timeAgo, timeLeft } from '@/lib/utils';
import { toast } from '@/components/Toaster';
import { Sparkles, MessageCircle, ThumbsUp, ThumbsDown, Smile, Heart, PartyPopper, Frown, Angry } from '@/components/icons';
import type { LucideIcon } from 'lucide-react';

const REACTIONS: { id: 'cool' | 'love' | 'wow' | 'sad' | 'angry'; Icon: LucideIcon; label: string }[] = [
  { id: 'cool',  Icon: Smile,       label: 'Cool' },
  { id: 'love',  Icon: Heart,       label: 'Love' },
  { id: 'wow',   Icon: PartyPopper, label: 'Wow' },
  { id: 'sad',   Icon: Frown,       label: 'Sad' },
  { id: 'angry', Icon: Angry,       label: 'Angry' },
];

const RADII = [1000, 5000, 10000, 25000, 100000, Infinity];
const FILTERS = [
  { id: 'all', label: 'All' }, { id: 'wha', label: "What's Happening" },
  { id: 'poll', label: 'Polls' }, { id: 'rateme', label: 'Rate Me' },
];

export default function FeedPage() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const [wha, setWha] = useState<WhaPost[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [rms, setRms] = useState<RateMeSession[]>([]);
  const [filter, setFilter] = useState<'all' | 'wha' | 'poll' | 'rateme'>('all');
  const [radiusIdx, setRadiusIdx] = useState(2);
  useEffect(() => listenWhaFeed(setWha), []);
  useEffect(() => listenPollFeed(setPolls), []);
  useEffect(() => listenActiveRateMe(setRms), []);

  const radius = RADII[radiusIdx];
  const items: FeedItem[] = useMemo(() => {
    const a: FeedItem[] = [
      ...wha.map((d) => ({ kind: 'wha' as const, data: d })),
      ...polls.map((d) => ({ kind: 'poll' as const, data: d })),
      ...rms.map((d) => ({ kind: 'rateme' as const, data: d })),
    ];
    a.sort((x, y) => tsOf(y) - tsOf(x));
    return a.filter((it) => filter === 'all' || it.kind === filter)
      .filter((it) => withinRadius(it, coords, radius));
  }, [wha, polls, rms, filter, coords, radius]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id as any)}
              className={`whitespace-nowrap rounded-full px-4 h-9 text-sm font-semibold border ${filter === f.id ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{coords ? 'Showing within' : 'Location off — showing all'}</span>
          <button className="rounded-full px-3 h-8 text-xs font-bold bg-brand-light text-brand"
            onClick={() => setRadiusIdx((i) => (i + 1) % RADII.length)}>
            {radius === Infinity ? 'Anywhere' : formatDistance(radius)}
          </button>
        </div>
      </div>

      {items.length === 0 && (
        <Card className="text-center text-muted">
          Nothing here yet. Be the first — tap
          <span className="ml-1 inline-flex items-center gap-1 text-brand font-bold">
            <Sparkles size={14} /> Create
          </span>.
        </Card>
      )}

      {items.map((it) => it.kind === 'wha' ? (
        <WhaCard key={`wha_${it.data.id}`} post={it.data} myUid={user!.uid} />
      ) : it.kind === 'poll' ? (
        <PollCard key={`poll_${it.data.id}`} poll={it.data} myUid={user!.uid} />
      ) : (
        <RateMeCard key={`rm_${it.data.id}`} sess={it.data} myUid={user!.uid} />
      ))}
    </div>
  );
}

function tsOf(it: FeedItem) { return 'createdAt' in it.data ? it.data.createdAt : (it.data as any).startedAt; }
function withinRadius(it: FeedItem, c: { lat: number; lng: number } | null, r: number) {
  if (r === Infinity) return true;
  const d: any = it.data;
  if (d.lat == null || d.lng == null || !c) return true;
  return haversineMeters(c, { lat: d.lat, lng: d.lng }) <= r;
}

function WhaCard({ post, myUid }: { post: WhaPost; myUid: string }) {
  const myReact = post.reactionVoters?.[myUid];
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Link href={`/profile/${post.uid}`}><Avatar src={post.authorPhoto} name={post.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${post.uid}`} className="font-bold truncate block">{post.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(post.createdAt)} • What's Happening</span>
        </div>
      </div>
      <Link href={`/post/${post.id}`}>
        {post.text && <p className="mt-2 whitespace-pre-wrap">{post.text}</p>}
        {post.mediaUrls?.length ? (
          <div className={`mt-3 grid gap-2 ${post.mediaUrls.length === 1 ? '' : 'grid-cols-2'}`}>
            {post.mediaUrls.slice(0, 4).map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" className="w-full h-48 object-cover rounded-xl bg-brand-light" />
            ))}
          </div>
        ) : null}
      </Link>
      <div className="mt-3 flex gap-2 overflow-x-auto no-scrollbar">
        {REACTIONS.map(({ id, Icon, label }) => (
          <button key={id} onClick={() => reactWha(post.id, myUid, id)} aria-label={label}
            className={`inline-flex items-center gap-1 rounded-full px-3 h-8 text-xs font-semibold border ${myReact === id ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}>
            <Icon size={14} /> {post.reactions?.[id] ?? 0}
          </button>
        ))}
        <Link href={`/post/${post.id}`} className="ml-auto rounded-full px-3 h-8 text-xs font-semibold border border-line bg-white inline-flex items-center gap-1">
          <MessageCircle size={14} /> {post.commentCount ?? 0}
        </Link>
      </div>
    </Card>
  );
}

function PollCard({ poll, myUid }: { poll: Poll; myUid: string }) {
  const total = poll.options.reduce((s, o) => s + (o.votes ?? 0), 0);
  const mine = poll.voters?.[myUid];
  const ended = poll.endsAt < Date.now();
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Link href={`/profile/${poll.uid}`}><Avatar name={poll.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${poll.uid}`} className="font-bold truncate block">{poll.authorName}</Link>
          <span className="text-xs text-muted">{timeAgo(poll.createdAt)} • Poll • {ended ? 'Ended' : timeLeft(poll.endsAt)}</span>
        </div>
      </div>
      <p className="mt-2 font-semibold">{poll.question}</p>
      <div className="mt-2 space-y-2">
        {poll.options.map((o) => {
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
      </div>
      <div className="mt-3 flex gap-2 text-xs text-muted">
        <Link href={`/poll/${poll.id}`} className="rounded-full px-3 h-8 inline-flex items-center font-semibold border border-line bg-white">Open</Link>
        <span className="ml-auto self-center">{total} votes</span>
      </div>
    </Card>
  );
}

function RateMeCard({ sess, myUid }: { sess: RateMeSession; myUid: string }) {
  const isOwner = sess.uid === myUid;
  const my = sess.votes?.[myUid];
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Link href={`/profile/${sess.uid}`}><Avatar src={sess.photoURL} name={sess.authorName} /></Link>
        <div className="flex-1 min-w-0">
          <Link href={`/profile/${sess.uid}`} className="font-bold truncate block">{sess.authorName}</Link>
          <span className="text-xs text-muted">Rate Me • {timeLeft(sess.endsAt)}</span>
        </div>
      </div>
      {sess.photoURL && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={sess.photoURL} alt="" className="mt-3 w-full max-h-96 object-cover rounded-xl" />
      )}
      <div className="mt-3 flex gap-2">
        <Button variant={my === 'like' ? 'primary' : 'outline'} disabled={isOwner} onClick={async () => { try { await voteRateMe(sess.id, myUid, 'like'); } catch (e: any) { toast(e.message, 'error'); } }}>
          <ThumbsUp size={16} className="mr-1" /> {sess.likes ?? 0}
        </Button>
        <Button variant={my === 'dislike' ? 'primary' : 'outline'} disabled={isOwner} onClick={async () => { try { await voteRateMe(sess.id, myUid, 'dislike'); } catch (e: any) { toast(e.message, 'error'); } }}>
          <ThumbsDown size={16} className="mr-1" /> {sess.dislikes ?? 0}
        </Button>
      </div>
    </Card>
  );
}
