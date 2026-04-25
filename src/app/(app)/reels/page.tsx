'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { ArrowLeft, Heart, MessageCircle, Music, Plus, Send } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { listenReels, toggleReelLike, bumpReelView } from '@/lib/services/reels';
import type { ReelItem } from '@/lib/types';

export default function ReelsPage() {
  const { user } = useAuth();
  const [reels, setReels] = useState<ReelItem[]>([]);

  useEffect(() => listenReels(setReels), []);

  return (
    <div className="fixed inset-0 z-30 bg-black text-white">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
        <Link href="/feed" aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur">
          <ArrowLeft size={18} />
        </Link>
        <div className="rounded-full bg-black/40 px-3 py-1 text-xs font-extrabold backdrop-blur">Reels</div>
        <Link href="/reel/create" aria-label="Create" className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur">
          <Plus size={18} />
        </Link>
      </div>

      {reels.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="text-2xl font-black">No reels yet</div>
          <div className="text-sm text-white/70">Be the first to share a vertical short.</div>
          <Link href="/reel/create" className="mt-2 rounded-full bg-brand px-5 py-3 text-sm font-extrabold">
            Create a Reel
          </Link>
        </div>
      ) : (
        <div className="h-full snap-y snap-mandatory overflow-y-auto">
          {reels.map((r) => (
            <ReelTile key={r.id} reel={r} myUid={user?.uid ?? ''} />
          ))}
        </div>
      )}
    </div>
  );
}

function ReelTile({ reel, myUid }: { reel: ReelItem; myUid: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [paused, setPaused] = useState(false);

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
      className="relative h-screen w-full snap-start"
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
        loop
        playsInline
        muted={!!reel.music}
      />
      {reel.music && (
        <audio ref={audioRef} src={reel.music.url} loop />
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/30" />

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 pb-24">
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
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center gap-1"
            aria-label="Comment"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
              <MessageCircle size={22} />
            </span>
            <span className="text-xs font-bold">0</span>
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

      {paused && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/55 px-4 py-2 text-xs font-bold">Paused</span>
        </div>
      )}
    </div>
  );
}
