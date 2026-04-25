'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/Avatar';
import {
  ArrowLeft, Heart, MessageCircle, Music, Plus, Send,
  Volume2, VolumeX, Play, X,
} from '@/components/icons';
import { useAuth } from '@/lib/auth';
import {
  listenReels, toggleReelLike, bumpReelView,
  addReelComment, listenReelComments,
} from '@/lib/services/reels';
import type { ReelItem } from '@/lib/types';
import { filterCss } from '@/lib/mediaFilters';

export function ReelsScroller({ initialReelId }: { initialReelId?: string }) {
  const { user, profile } = useAuth();
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [mounted, setMounted] = useState(false);
  const [commentReel, setCommentReel] = useState<ReelItem | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => listenReels(setReels), []);

  useEffect(() => {
    setMounted(true);
    const shell = document.getElementById('canact-app-shell');
    shell?.setAttribute('data-header-hidden', 'true');
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      shell?.setAttribute('data-header-hidden', 'false');
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Reorder so the requested reel is first; the rest follow underneath.
  const ordered = useMemo(() => {
    if (!initialReelId) return reels;
    const idx = reels.findIndex((r) => r.id === initialReelId);
    if (idx <= 0) return reels;
    return [reels[idx], ...reels.slice(0, idx), ...reels.slice(idx + 1)];
  }, [reels, initialReelId]);

  if (!mounted) return null;

  const ui = (
    <div className="fixed inset-0 z-[60] bg-black text-white">
      {/* Header — soft top fade, no hard line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-32 bg-gradient-to-b from-black/55 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 top-0 z-30 flex items-center justify-between p-4 safe-top">
        <Link href="/feed" aria-label="Back" className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur ring-1 ring-white/15">
          <ArrowLeft size={18} />
        </Link>
        <div className="rounded-full bg-black/45 px-3 py-1 text-xs font-extrabold backdrop-blur ring-1 ring-white/15">Reels</div>
        <Link href="/reel/create" aria-label="Create" className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur ring-1 ring-white/15">
          <Plus size={18} />
        </Link>
      </div>

      {ordered.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-2xl font-black">No reels yet</div>
          <div className="text-sm text-white/70">Be the first to share a vertical short.</div>
          <Link href="/reel/create" className="mt-2 rounded-full bg-brand px-5 py-3 text-sm font-extrabold">
            Create a Reel
          </Link>
        </div>
      ) : (
        <div ref={containerRef} className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain">
          {ordered.map((r) => (
            <ReelTile
              key={r.id}
              reel={r}
              myUid={user?.uid ?? ''}
              onComment={() => setCommentReel(r)}
            />
          ))}
        </div>
      )}

      {commentReel && (
        <CommentsSheet
          reel={commentReel}
          myUid={user?.uid ?? ''}
          myName={profile?.fullName ?? 'You'}
          myPhoto={profile?.photoURL ?? undefined}
          onClose={() => setCommentReel(null)}
        />
      )}
    </div>
  );

  return createPortal(ui, document.body);
}

function ReelTile({
  reel, myUid, onComment,
}: {
  reel: ReelItem; myUid: string; onComment: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            videoRef.current?.play().catch(() => {});
            audioRef.current?.play().catch(() => {});
            bumpReelView(reel.id).catch(() => {});
          } else {
            videoRef.current?.pause();
            audioRef.current?.pause();
          }
        });
      },
      { threshold: [0, 0.6, 1] },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [reel.id]);

  const liked = !!(myUid && reel.likes && reel.likes[myUid]);
  const likeCount = reel.likes ? Object.keys(reel.likes).length : 0;

  return (
    <div
      ref={ref}
      className="relative h-[100dvh] w-full snap-start snap-always"
      onClick={() => {
        if (paused) {
          videoRef.current?.play().catch(() => {});
          audioRef.current?.play().catch(() => {});
        } else {
          videoRef.current?.pause();
          audioRef.current?.pause();
        }
        setPaused((p) => !p);
      }}
    >
      <video
        ref={videoRef}
        src={reel.videoUrl}
        className="h-full w-full object-cover"
        style={{ filter: filterCss(reel.filter) }}
        loop
        playsInline
        muted={!!reel.music || muted}
      />
      {reel.music && (
        <audio ref={audioRef} src={reel.music.url} loop muted={muted} />
      )}

      {/* Mute toggle */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
        aria-label={muted ? 'Unmute' : 'Mute'}
        className="absolute right-3 top-20 z-30 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur ring-1 ring-white/15"
      >
        {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>

      {/* Pause indicator */}
      {paused && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur">
            <Play size={26} />
          </span>
        </div>
      )}

      {/* Soft bottom fade — no hard line */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/75 via-black/35 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 p-4 pb-28">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Avatar src={reel.authorPhoto ?? null} name={reel.authorName} size={36} />
            <div className="text-sm font-extrabold">{reel.authorName}</div>
          </div>
          {reel.caption && <div className="mt-2 text-sm leading-snug">{reel.caption}</div>}
          {reel.music && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-[11px] font-bold backdrop-blur">
              <Music size={12} /> {reel.music.title} · {reel.music.artist}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); if (myUid) toggleReelLike(reel.id, myUid); }}
            className="flex flex-col items-center gap-1"
            aria-label="Like"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur ${liked ? 'bg-brand text-white' : 'bg-black/40 text-white'}`}>
              <Heart size={22} fill={liked ? 'currentColor' : 'none'} />
            </span>
            <span className="text-xs font-bold">{likeCount}</span>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onComment(); }}
            className="flex flex-col items-center gap-1"
            aria-label="Comment"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
              <MessageCircle size={22} />
            </span>
            <span className="text-xs font-bold">{reel.commentCount ?? 0}</span>
          </button>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center gap-1"
            aria-label="Share"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
              <Send size={22} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CommentsSheet({
  reel, myUid, myName, myPhoto, onClose,
}: {
  reel: ReelItem; myUid: string; myName: string; myPhoto?: string; onClose: () => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => listenReelComments(reel.id, setItems), [reel.id]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [items.length]);

  // Pause all reel videos in the background while sheet is open; resume on close.
  useEffect(() => {
    const vids = Array.from(document.querySelectorAll<HTMLVideoElement>('video'));
    const wasPlaying = vids.filter((v) => !v.paused);
    if (expanded) {
      wasPlaying.forEach((v) => v.pause());
    }
    return () => {
      // resume on unmount handled by parent close
    };
  }, [expanded]);

  // Expand sheet to nearly full height when user scrolls within the comments list.
  function onListScroll(e: React.UIEvent<HTMLDivElement>) {
    if (!expanded && e.currentTarget.scrollTop > 4) setExpanded(true);
  }

  return (
    <div className="absolute inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 canact-sheet-backdrop" />
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-3xl bg-white text-ink shadow-2xl canact-sheet-slide transition-[height] duration-300 ease-out ${expanded ? 'h-[92dvh]' : 'h-[58dvh]'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center justify-center px-4 pt-3 pb-1"
        >
          <span className="h-1 w-10 rounded-full bg-line" />
        </button>
        <div className="flex items-center justify-between px-4 pb-2">
          <div className="text-sm font-extrabold">Comments</div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 text-ink/70 hover:bg-brand-light/40">
            <X size={18} />
          </button>
        </div>
        <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
          {items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">Be the first to comment.</div>
          ) : (
            <ul className="space-y-3">
              {items.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <Avatar src={c.photoURL ?? null} name={c.name} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold">{c.name}</div>
                    <div className="whitespace-pre-wrap break-words text-sm">{c.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="flex items-center gap-2 border-t border-line bg-white px-3 py-2 safe-bottom"
        >
          <Avatar src={myPhoto ?? null} name={myName} size={28} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setExpanded(true)}
            placeholder={myUid ? 'Add a comment…' : 'Sign in to comment'}
            disabled={!myUid || busy}
            className="h-10 flex-1 rounded-full border border-line bg-brand-light/40 px-4 text-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={!text.trim() || !myUid || busy}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white disabled:opacity-50"
            aria-label="Post"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );

  async function send() {
    const t = text.trim();
    if (!t || !myUid || busy) return;
    setBusy(true);
    try {
      await addReelComment(reel.id, myUid, myName, myPhoto, t);
      setText('');
    } finally {
      setBusy(false);
    }
  }
}
