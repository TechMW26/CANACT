'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Avatar } from './Avatar';
import { MediaSlider } from './MediaSlider';
import { PostMenu } from './PostMenu';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import { Angry, Frown, Heart, MessageCircle, PartyPopper, Send, Share2, Smile, ThumbsDown, ThumbsUp } from './icons';
import { addComment, deletePost, listenComments, listenPost, reactWha } from '@/lib/services/wha';
import { commentPoll, deletePoll, listenPoll, listenPollComments, reactPoll, votePoll } from '@/lib/services/poll';
import { commentRateMe, deleteRateMeSession, listenRateMeComments, listenRateMeSession, voteRateMe } from '@/lib/services/rateme';
import type { ChatAttachment, Poll, RateMeSession, WhaPost } from '@/lib/types';
import { timeAgo, timeLeft } from '@/lib/utils';

export type PostDetailSheetItem =
  | { kind: 'wha'; data: WhaPost }
  | { kind: 'wha'; id: string; data?: WhaPost | null }
  | { kind: 'poll'; data: Poll }
  | { kind: 'poll'; id: string; data?: Poll | null }
  | { kind: 'rateme'; id: string; data?: RateMeSession | null }
  | { kind: 'rateme'; data: RateMeSession };

type CommentRow = {
  id: string;
  uid?: string;
  name: string;
  text: string;
  createdAt: number;
};

const WHA_REACTIONS: { id: 'cool' | 'love' | 'wow' | 'sad' | 'angry'; Icon: LucideIcon; label: string }[] = [
  { id: 'cool', Icon: Smile, label: 'Cool' },
  { id: 'love', Icon: Heart, label: 'Love' },
  { id: 'wow', Icon: PartyPopper, label: 'Wow' },
  { id: 'sad', Icon: Frown, label: 'Sad' },
  { id: 'angry', Icon: Angry, label: 'Angry' },
];

export function PostDetailSheet({
  item,
  myUid,
  myName,
  onClose,
  onShare,
}: {
  item: PostDetailSheetItem | null;
  myUid: string;
  myName: string;
  onClose: () => void;
  onShare: (attachment: ChatAttachment) => void;
}) {
  const [post, setPost] = useState<WhaPost | null>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [rateMe, setRateMe] = useState<RateMeSession | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const activeItemId = item ? ('id' in item ? item.id : item.data.id) : '';
  const itemKey = item ? `${item.kind}:${activeItemId}` : '';

  useEffect(() => {
    setText('');
    setComments([]);
    setPost(item?.kind === 'wha' ? ('data' in item ? item.data ?? null : null) : null);
    setPoll(item?.kind === 'poll' ? ('data' in item ? item.data ?? null : null) : null);
    setRateMe(item?.kind === 'rateme' ? ('data' in item ? item.data ?? null : null) : null);
    if (!item) return;
    if (item.kind === 'wha') return activeItemId ? listenPost(activeItemId, setPost) : undefined;
    if (item.kind === 'poll') return activeItemId ? listenPoll(activeItemId, setPoll) : undefined;
    return activeItemId ? listenRateMeSession(activeItemId, setRateMe) : undefined;
  }, [itemKey]);

  useEffect(() => {
    if (!item) return;
    if (item.kind === 'wha') return activeItemId ? listenComments(activeItemId, setComments) : undefined;
    if (item.kind === 'poll') return activeItemId ? listenPollComments(activeItemId, setComments) : undefined;
    return activeItemId ? listenRateMeComments(activeItemId, setComments) : undefined;
  }, [itemKey]);

  const attachment = useMemo<ChatAttachment | null>(() => {
    if (item?.kind === 'wha' && post) {
      return {
        kind: 'post',
        postId: post.id,
        authorName: post.authorName,
        text: post.text,
        thumbUrl: post.mediaPosters?.[0] ?? post.mediaUrls?.[0],
      };
    }
    if (item?.kind === 'poll' && poll) {
      return { kind: 'poll', pollId: poll.id, authorName: poll.authorName, question: poll.question, thumbUrl: poll.photoURL };
    }
    if (item?.kind === 'rateme' && rateMe) {
      return { kind: 'rateme', sessionId: rateMe.id, authorName: rateMe.authorName, thumbUrl: rateMe.photoURL };
    }
    return null;
  }, [item?.kind, post, poll, rateMe]);

  const title = item?.kind === 'poll' ? 'Poll' : item?.kind === 'rateme' ? 'Rate Me' : 'Post';
  const composerPlaceholder = item?.kind === 'poll' ? 'Reply...' : 'Add a comment...';

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!item || !activeItemId || sending) return;
    const value = text.trim();
    if (!value) return;
    setSending(true);
    setText('');
    try {
      if (item.kind === 'wha') await addComment(activeItemId, myUid, myName, value);
      else if (item.kind === 'poll') await commentPoll(activeItemId, myUid, myName, value);
      else await commentRateMe(activeItemId, myUid, myName, value);
    } catch (error: any) {
      setText(value);
      toast(error?.message ?? 'Could not comment', 'error');
    } finally {
      setSending(false);
    }
  };

  const share = () => {
    if (!attachment) return;
    onShare(attachment);
  };

  return (
    <Sheet open={!!item} onClose={onClose} title={title} topmost>
      {/* Render content directly into the Sheet's own scroll container so
          the composer below can use `position: sticky` against it without
          a nested scroll context (which previously clipped the composer
          on mobile). */}
      <div className="-mx-2 pb-24">
        {item?.kind === 'wha' && post ? (
          <WhaPostDetails post={post} myUid={myUid} onShare={share} onDeleted={onClose} />
        ) : item?.kind === 'poll' && poll ? (
          <PollDetails poll={poll} myUid={myUid} onShare={share} onDeleted={onClose} />
        ) : item?.kind === 'rateme' && rateMe ? (
          <RateMeDetails session={rateMe} myUid={myUid} onShare={share} onDeleted={onClose} />
        ) : (
          <div className="py-16 text-center text-sm text-ink/55">Loading...</div>
        )}

        <section className="mt-5 pt-4">
          <div className="mb-3 flex items-center gap-2">
            <MessageCircle size={16} className="text-brand" />
            <h3 className="text-sm font-extrabold text-ink">Comments</h3>
            <span className="text-xs font-semibold text-ink/45">{comments.length}</span>
          </div>
          {comments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink/50">
              Be the first to comment.
            </div>
          ) : (
            <div className="space-y-3 pb-2">
              {comments.map((comment) => (
                <div key={comment.id} className="flex items-start gap-3">
                  <Avatar name={comment.name} size={32} />
                  <div className="min-w-0 flex-1 rounded-2xl bg-brand-light/45 px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-extrabold text-ink">{comment.name}</span>
                      <span className="shrink-0 text-[10px] font-semibold text-ink/45">{timeAgo(comment.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm leading-snug text-ink/80">{comment.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <form onSubmit={submitComment} className="sticky bottom-0 z-10 flex shrink-0 gap-2 rounded-[999px] bg-white p-2">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={1}
          placeholder={composerPlaceholder}
          className="max-h-28 min-h-11 flex-1 resize-none rounded-[900px] border border-line bg-white p-2.5 text-sm leading-snug outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Send comment"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-45"
        >
          <Send size={17} />
        </button>
      </form>
    </Sheet>
  );
}

function DetailHeader({ authorName, authorUid, authorPhoto, subline, onShare, onDelete }: { authorName: string; authorUid: string; authorPhoto?: string | null; subline: string; onShare: () => void; onDelete?: () => Promise<void> | void }) {
  return (
    <div className="flex items-center gap-3">
      <Link href={`/profile/${authorUid}`} className="shrink-0">
        <Avatar src={authorPhoto ?? null} name={authorName} size={42} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/profile/${authorUid}`} className="block truncate text-sm font-extrabold text-ink">{authorName}</Link>
        <div className="text-[11px] font-semibold text-ink/45">{subline}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button type="button" onClick={onShare} aria-label="Share" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-light text-brand">
          <Share2 size={17} />
        </button>
        {onDelete ? <PostMenu isOwner onDelete={onDelete} /> : null}
      </div>
    </div>
  );
}

/**
 * Full-bleed media block with the author/share header overlaid on top.
 * The Sheet scroll container owns the side padding, so `-mx-4` reaches the
 * true panel edges while `overflow-x-hidden` prevents horizontal scroll.
 */
function FullBleedMediaHeader({
  authorName,
  authorUid,
  authorPhoto,
  subline,
  onShare,
  onDelete,
  bottomOverlay,
  children,
}: {
  authorName: string;
  authorUid: string;
  authorPhoto?: string | null;
  subline: string;
  onShare: () => void;
  onDelete?: () => Promise<void> | void;
  bottomOverlay?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      {children}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent" />
      {bottomOverlay ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/58 via-black/22 to-transparent" />
          <div className="pointer-events-auto absolute inset-x-0 bottom-0 px-4 pb-5">
            {bottomOverlay}
          </div>
        </>
      ) : null}
      <div className="pointer-events-auto absolute inset-x-0 top-0 flex items-center gap-3 px-4 pt-3">
        <Link href={`/profile/${authorUid}`} className="shrink-0">
          <Avatar src={authorPhoto ?? null} name={authorName} size={42} />
        </Link>
        <div className="min-w-0 flex-1">
          <Link href={`/profile/${authorUid}`} className="block truncate text-sm font-extrabold text-white drop-shadow">{authorName}</Link>
          <div className="text-[11px] font-semibold text-white/85 drop-shadow">{subline}</div>
        </div>
        <button type="button" onClick={onShare} aria-label="Share" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/85 text-ink backdrop-blur">
          <Share2 size={17} />
        </button>
        {onDelete ? <PostMenu isOwner onDelete={onDelete} variant="dark" /> : null}
      </div>
    </div>
  );
}

function WhaPostDetails({ post, myUid, onShare, onDeleted }: { post: WhaPost; myUid: string; onShare: () => void; onDeleted: () => void }) {
  const hasMedia = !!post.mediaUrls?.length;
  const onDelete = post.uid === myUid ? async () => { await deletePost(post.id, post.uid); onDeleted(); } : undefined;
  return (
    <div>
      {hasMedia ? (
        <FullBleedMediaHeader
          authorName={post.authorName}
          authorUid={post.uid}
          authorPhoto={post.authorPhoto}
          subline={timeAgo(post.createdAt)}
          onShare={onShare}
          onDelete={onDelete}
          bottomOverlay={<WhaReactionBar post={post} myUid={myUid} overlay />}
        >
          <MediaSlider urls={post.mediaUrls!} posters={post.mediaPosters} lqips={post.mediaLqips} rounded={false} />
        </FullBleedMediaHeader>
      ) : (
        <DetailHeader authorName={post.authorName} authorUid={post.uid} authorPhoto={post.authorPhoto} subline={timeAgo(post.createdAt)} onShare={onShare} onDelete={onDelete} />
      )}
      {post.text ? <p className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{post.text}</p> : null}
      {!hasMedia ? <WhaReactionBar post={post} myUid={myUid} /> : null}
    </div>
  );
}

function WhaReactionBar({ post, myUid, overlay = false }: { post: WhaPost; myUid: string; overlay?: boolean }) {
  const myReact = post.reactionVoters?.[myUid];
  return (
    <div className={`${overlay ? '' : 'mt-4'} flex gap-2 overflow-x-auto pb-1 no-scrollbar`}>
      {WHA_REACTIONS.map(({ id, Icon, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => reactWha(post.id, myUid, id)}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold ${
            myReact === id
              ? 'border-brand bg-brand text-white'
              : overlay
                ? 'border-white/50 bg-white/95 text-ink'
                : 'border-line bg-white text-ink shadow-sm'
          }`}
        >
          <Icon size={14} /> {post.reactions?.[id] ?? 0}<span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}

function PollDetails({ poll, myUid, onShare, onDeleted }: { poll: Poll; myUid: string; onShare: () => void; onDeleted: () => void }) {
  const options = Array.isArray(poll.options) ? poll.options : [];
  const total = options.reduce((sum, option) => sum + (option.votes ?? 0), 0);
  const mine = poll.voters?.[myUid];
  const myReact = poll.reactionVoters?.[myUid];
  const ended = poll.endsAt < Date.now();
  const locked = ended || !!mine;
  const onDelete = poll.uid === myUid ? async () => { await deletePoll(poll.id, poll.uid); onDeleted(); } : undefined;
  return (
    <div>
      {poll.photoURL ? (
        <FullBleedMediaHeader
          authorName={poll.authorName}
          authorUid={poll.uid}
          subline={`${timeAgo(poll.createdAt)} · ${ended ? 'Ended' : timeLeft(poll.endsAt)}`}
          onShare={onShare}
          onDelete={onDelete}
          bottomOverlay={
            <div className="flex gap-2">
              <button type="button" onClick={() => reactPoll(poll.id, myUid, 'like')} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold ${myReact === 'like' ? 'bg-emerald-500 text-white' : 'bg-white/90 text-ink'}`}>
                <ThumbsUp size={14} /> {poll.likes ?? 0}
              </button>
              <button type="button" onClick={() => reactPoll(poll.id, myUid, 'dislike')} className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold ${myReact === 'dislike' ? 'bg-rose-500 text-white' : 'bg-white/90 text-ink'}`}>
                <ThumbsDown size={14} /> {poll.dislikes ?? 0}
              </button>
            </div>
          }
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={poll.photoURL} alt="" className="max-h-[58svh] w-full object-cover lqip-img" style={poll.lqip ? { backgroundImage: `url(${poll.lqip})`, backgroundSize: 'cover' } : undefined} />
        </FullBleedMediaHeader>
      ) : (
        <DetailHeader authorName={poll.authorName} authorUid={poll.uid} subline={`${timeAgo(poll.createdAt)} · ${ended ? 'Ended' : timeLeft(poll.endsAt)}`} onShare={onShare} onDelete={onDelete} />
      )}
      <div className="mt-4 rounded-3xl bg-brand-light/55 p-4">
        <div className="text-lg font-black leading-tight text-ink">{poll.question}</div>
        {!poll.openEnded && options.length > 0 ? (
          <div className="mt-4 space-y-2">
            {options.map((option) => {
              const pct = total ? Math.round((option.votes / total) * 100) : 0;
              const selected = mine === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={locked}
                  onClick={() => { if (!locked) votePoll(poll.id, myUid, option.id); }}
                  className={`relative w-full overflow-hidden rounded-2xl border px-3 py-3 text-left ${selected ? 'border-brand' : 'border-line'} bg-white disabled:opacity-70`}
                >
                  <div className="absolute inset-y-0 left-0 bg-brand-light" style={{ width: `${pct}%` }} />
                  <div className="relative flex items-center justify-between gap-3 text-sm font-bold text-ink">
                    <span className="min-w-0 truncate">{option.text}</span>
                    <span className="shrink-0 text-xs text-ink/55">{pct}% · {option.votes}</span>
                  </div>
                </button>
              );
            })}
            <div className="text-xs font-semibold text-ink/55">{total} votes{mine ? ' · You voted' : ''}</div>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-dashed border-line bg-white px-3 py-3 text-sm text-ink/55">
            Open-ended poll. Add your response below.
          </div>
        )}
      </div>
    </div>
  );
}

function RateMeDetails({ session, myUid, onShare, onDeleted }: { session: RateMeSession; myUid: string; onShare: () => void; onDeleted: () => void }) {
  const isOwner = session.uid === myUid;
  const ended = session.endsAt <= Date.now();
  const myVote = session.votes?.[myUid];
  const locked = ended || isOwner || !!myVote;
  const likes = session.likes ?? 0;
  const dislikes = session.dislikes ?? 0;
  const total = likes + dislikes;
  const upPct = total ? Math.round((likes / total) * 100) : 0;
  const downPct = total ? 100 - upPct : 0;
  const onDelete = isOwner ? async () => { await deleteRateMeSession(session.id, session.uid); onDeleted(); } : undefined;
  const cast = (kind: 'like' | 'dislike') => {
    if (locked) return;
    voteRateMe(session.id, myUid, kind).catch((error: any) => toast(error?.message ?? 'Could not vote', 'error'));
  };
  return (
    <div>
      <FullBleedMediaHeader
        authorName={session.authorName}
        authorUid={session.uid}
        authorPhoto={session.photoURL}
        subline={ended ? 'Voting closed' : timeLeft(session.endsAt)}
        onShare={onShare}
        onDelete={onDelete}
        bottomOverlay={locked ? undefined : (
          <div className="flex gap-2">
            <button type="button" disabled={locked} onClick={() => cast('dislike')} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-extrabold disabled:opacity-55 ${myVote === 'dislike' ? 'bg-rose-500 text-white' : 'bg-white/90 text-rose-600'}`}>
              <ThumbsDown size={14} /> Down
            </button>
            <button type="button" disabled={locked} onClick={() => cast('like')} className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-extrabold disabled:opacity-55 ${myVote === 'like' ? 'bg-emerald-500 text-white' : 'bg-white/90 text-emerald-700'}`}>
              <ThumbsUp size={14} /> Up
            </button>
          </div>
        )}
      >
        {session.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={session.photoURL} alt="" className="max-h-[62svh] w-full object-cover lqip-img" style={session.lqip ? { backgroundImage: `url(${session.lqip})`, backgroundSize: 'cover' } : undefined} />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center bg-brand-light text-xl font-black text-brand">Rate Me</div>
        )}
      </FullBleedMediaHeader>
      <div className="mt-4 rounded-3xl bg-brand-light/55 p-4">
        <div className="flex items-center justify-between text-xs font-extrabold uppercase tracking-wide text-ink/55">
          <span className="text-rose-500">Down · {dislikes}</span>
          <span className="text-emerald-600">Up · {likes}</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white">
          <div style={{ width: `${downPct}%` }} className="bg-rose-300" />
          <div style={{ width: `${upPct}%` }} className="bg-emerald-300" />
        </div>
      </div>
    </div>
  );
}
