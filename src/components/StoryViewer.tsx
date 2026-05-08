'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Avatar } from './Avatar';
import { isVideoUrl } from './CameraCapture';
import { filterCss } from '@/lib/mediaFilters';
import { lockPageScroll } from '@/lib/scrollLock';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';
import { Heart, MessageSquare, Send, Trash2, X, Eye, Volume2, VolumeX } from './icons';
import { listenStory, markStoryView, replyToStory, toggleStoryLike } from '@/lib/services/stories';
import type { StoryItem } from '@/lib/types';
import { timeAgo } from '@/lib/utils';
import { toast } from './Toaster';

const DURATION_MS = 5000;

export function StoryViewer({
  stories,
  startIndex,
  meUid,
  meName,
  mePhoto,
  onClose,
  onDelete,
}: {
  stories: StoryItem[];
  startIndex: number;
  meUid: string;
  meName: string;
  mePhoto?: string | null;
  onClose: () => void;
  /** Called when the owner taps the trash icon. The implementation
   *  should remove just this single story (identified by storyId), not
   *  the user's entire archive. */
  onDelete: (authorUid: string, storyId: string) => Promise<void>;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liveStory, setLiveStory] = useState<StoryItem | null>(stories[startIndex] ?? null);
  const [showViewers, setShowViewers] = useState(false);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [vidMuted, setVidMuted] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const elapsedRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const viewersSheetRef = useRef<HTMLDivElement | null>(null);
  const viewersSwipeDismissHandlers = useTopScrollSwipeDismiss({
    onClose: () => setShowViewers(false),
    getScrollElement: () => viewersSheetRef.current,
  });

  const story = liveStory ?? stories[index];
  const isMine = story?.uid === meUid;

  useEffect(() => {
    return lockPageScroll();
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('canact-story-open');
    document.body.classList.add('canact-story-open');
    return () => {
      document.documentElement.classList.remove('canact-story-open');
      document.body.classList.remove('canact-story-open');
    };
  }, []);

  // Listen to live story (for likes / replies / viewers updates)
  useEffect(() => {
    const target = stories[index];
    if (!target) return;
    setLiveStory(target);
    return listenStory(target.uid, target.id, (s) => setLiveStory(s ?? target));
  }, [index, stories]);

  // Mark view + reset progress when index changes
  useEffect(() => {
    const target = stories[index];
    if (!target) return;
    if (target.uid !== meUid) {
      void markStoryView(target.uid, target.id, { uid: meUid, name: meName, photoURL: mePhoto ?? undefined });
    }
    setProgress(0);
    elapsedRef.current = 0;
    startedAtRef.current = Date.now();
  }, [index, stories, meUid, meName, mePhoto]);

  // Progress timer
  useEffect(() => {
    if (paused || showViewers) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const now = Date.now();
      const delta = now - startedAtRef.current;
      const total = elapsedRef.current + delta;
      const pct = Math.min(1, total / DURATION_MS);
      setProgress(pct);
      if (pct >= 1) {
        if (index >= stories.length - 1) {
          onClose();
        } else {
          setIndex((i) => i + 1);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // accumulate elapsed when pausing
      elapsedRef.current += Date.now() - startedAtRef.current;
      startedAtRef.current = Date.now();
    };
  }, [paused, showViewers, index, stories.length, onClose]);

  if (!story) return null;

  const goPrev = () => {
    if (index > 0) setIndex((i) => i - 1);
  };
  const goNext = () => {
    if (index >= stories.length - 1) onClose();
    else setIndex((i) => i + 1);
  };

  const liked = !!(liveStory?.likes?.[meUid]);
  const likeCount = liveStory?.likes ? Object.keys(liveStory.likes).length : 0;
  const viewers = useMemo(() => {
    const v = liveStory?.viewers ? Object.values(liveStory.viewers) : [];
    return v.sort((a, b) => b.at - a.at);
  }, [liveStory?.viewers]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || !story || isMine) return;
    setSending(true);
    try {
      await replyToStory(story.uid, story.id, {
        fromUid: meUid,
        fromName: meName,
        fromPhoto: mePhoto ?? undefined,
        text,
      });
      setReply('');
      toast('Reply sent', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not send', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <PortalWrap>
      <div className="canact-story-viewer fixed inset-0 z-[100] bg-black text-white">
      <div className="mx-auto flex h-full max-w-md flex-col px-2 pb-3 pt-2 safe-top safe-bottom">
        {/* Segmented progress — only the CURRENT user's stories show up
            as bars, so the counter at the top accurately reflects "how
            many of THIS person's stories am I watching" rather than the
            total feed. When the viewer auto-advances to the next user
            the bar resets to that user's segments. */}
        <div className="mb-2 flex gap-1 px-1">
          {(() => {
            const segs: number[] = [];
            stories.forEach((s, i) => { if (s.uid === story.uid) segs.push(i); });
            const myPos = segs.indexOf(index);
            return segs.map((origIdx, segIdx) => (
              <div key={origIdx} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
                <div
                  className="h-full rounded-full bg-white"
                  style={{
                    width: segIdx < myPos ? '100%' : segIdx === myPos ? `${progress * 100}%` : '0%',
                    transition: segIdx === myPos ? 'none' : 'width 120ms linear',
                  }}
                />
              </div>
            ));
          })()}
        </div>

        {/* Header */}
        <div className="mb-2 flex items-center gap-3 px-1">
          <Link href={`/profile/${story.uid}`} onClick={onClose}>
            <Avatar src={story.authorPhoto ?? null} name={story.authorName} size={36} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/profile/${story.uid}`} onClick={onClose} className="truncate font-bold">
              {story.authorName}
            </Link>
            <div className="text-xs text-white/70">{timeAgo(story.createdAt)}</div>
          </div>
          {isMine ? (
            <button
              type="button"
              onClick={async () => {
                if (!confirm('Delete this story?')) return;
                await onDelete(story.uid, story.id);
                onClose();
              }}
              aria-label="Delete story"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
            >
              <Trash2 size={16} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15"
          >
            <X size={16} />
          </button>
        </div>

        {/* Media */}
        <div
          className="relative flex-1 overflow-hidden rounded-[28px] bg-white/5 select-none"
          onPointerDown={() => setPaused(true)}
          onPointerUp={() => setPaused(false)}
          onPointerLeave={() => setPaused(false)}
          onPointerCancel={() => setPaused(false)}
        >
          {isVideoUrl(story.mediaUrl) ? (
            <>
              <video
                src={story.mediaUrl}
                className="h-full w-full object-contain"
                style={{ filter: filterCss(story.filter) }}
                autoPlay
                loop
                playsInline
                muted={vidMuted}
              />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setVidMuted((m) => !m); }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={vidMuted ? 'Unmute' : 'Mute'}
                className="absolute right-3 top-3 z-30 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
              >
                {vidMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={story.mediaUrl} alt={story.caption ?? ''} decoding="async" className="h-full w-full object-cover" style={{ filter: filterCss(story.filter) }} draggable={false} />
          )}
          {(story.overlays ?? []).map((o) => (
            <div
              key={o.id}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 px-3 py-1.5"
              style={{
                left: `${o.x * 100}%`,
                top: `${o.y * 100}%`,
                color: o.color ?? '#fff',
                background: o.background,
                borderRadius: o.background ? 14 : 0,
                fontWeight: 800,
                fontSize: 22,
                textShadow: o.background ? 'none' : '0 2px 12px rgba(0,0,0,0.55)',
                maxWidth: '85%',
                wordBreak: 'break-word',
                textAlign: 'center',
              }}
            >
              {o.text}
            </div>
          ))}

          {/* Tap zones — inset top so they don't sit over the mute / close controls */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
            className="absolute bottom-0 left-0 top-16 z-10 w-1/3"
            aria-label="Previous"
          />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goNext(); }}
            className="absolute bottom-0 right-0 top-16 z-10 w-1/3"
            aria-label="Next"
          />

          {story.caption ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-2xl bg-black/45 px-4 py-2 text-sm leading-6 backdrop-blur">
              {story.caption}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="mt-3 px-1">
          {isMine ? (
            <button
              type="button"
              onClick={() => setShowViewers(true)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-white/15 px-4 py-3 text-sm font-bold backdrop-blur"
            >
              <Eye size={16} /> {viewers.length} {viewers.length === 1 ? 'view' : 'views'}
              {likeCount > 0 ? <span className="ml-2 inline-flex items-center gap-1 text-pink-300"><Heart size={14} fill="currentColor" /> {likeCount}</span> : null}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void sendReply();
                }}
                placeholder={`Reply to ${story.authorName.split(' ')[0]}…`}
                className="flex-1 rounded-full bg-white/15 px-4 py-3 text-sm text-white placeholder:text-white/60 backdrop-blur outline-none"
              />
              <button
                type="button"
                onClick={() => void toggleStoryLike(story.uid, story.id, meUid, !liked)}
                aria-label={liked ? 'Unlike' : 'Like'}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 backdrop-blur"
              >
                <Heart size={18} className={liked ? 'text-pink-400' : ''} fill={liked ? 'currentColor' : 'none'} />
              </button>
              <button
                type="button"
                disabled={!reply.trim() || sending}
                onClick={() => void sendReply()}
                aria-label="Send reply"
                className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Viewers sheet (owner) */}
      {showViewers && isMine ? (
        <div className="absolute inset-0 z-[110] flex items-end bg-transparent backdrop-blur-sm" onClick={() => setShowViewers(false)}>
          <div
            {...viewersSwipeDismissHandlers}
            ref={viewersSheetRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: '70svh',
              paddingBottom: 'var(--canact-popup-bottom-inset)',
            }}
            className="w-[100vw] max-w-[100vw] overflow-y-auto rounded-t-[28px] bg-white px-4 pt-3 text-ink"
          >
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-ink/10" />
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-extrabold">Viewers · {viewers.length}</h3>
              <button type="button" onClick={() => setShowViewers(false)} className="rounded-full bg-brand-light/60 px-3 py-1 text-xs font-bold text-brand">Close</button>
            </div>
            {viewers.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink/55">No views yet.</p>
            ) : (
              <ul className="space-y-1">
                {viewers.map((v) => (
                  <li key={v.uid} className="flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-brand-light/40">
                    <Avatar src={v.photoURL ?? null} name={v.name} size={36} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{v.name}</div>
                      <div className="text-xs text-ink/55">{timeAgo(v.at)}</div>
                    </div>
                    {v.liked ? <Heart size={16} className="text-pink-500" fill="currentColor" /> : null}
                  </li>
                ))}
              </ul>
            )}

            {liveStory?.replies && Object.keys(liveStory.replies).length > 0 ? (
              <div className="mt-5">
                <div className="mb-2 inline-flex items-center gap-2 text-sm font-bold">
                  <MessageSquare size={14} /> Replies
                </div>
                <ul className="space-y-1">
                  {Object.values(liveStory.replies)
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((r) => (
                      <li key={r.id} className="flex items-start gap-3 rounded-2xl px-2 py-2 hover:bg-brand-light/40">
                        <Avatar src={r.fromPhoto ?? null} name={r.fromName} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold">{r.fromName}</div>
                          <div className="text-sm text-ink/80">{r.text}</div>
                          <div className="text-xs text-ink/45">{timeAgo(r.createdAt)}</div>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      </div>
    </PortalWrap>
  );
}

function PortalWrap({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
