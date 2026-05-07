'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { startVicinity, listenPendingRatings, submitProximityRating, dismissPendingRating } from '@/lib/services/vicinity';
import type { PendingRating } from '@/lib/types';
import { Avatar } from './Avatar';
import { Star, X } from './icons';

export function VicinityTracker() {
  const { user, profile } = useAuth();
  const [queue, setQueue] = useState<PendingRating[]>([]);

  // Start the geolocation-based presence + encounter tracker.
  useEffect(() => {
    if (!user || !profile) return;
    const handle = startVicinity({
      uid: user.uid,
      profile: { fullName: profile.fullName, photoURL: profile.photoURL },
    });
    return () => handle.stop();
  }, [user?.uid, profile?.fullName, profile?.photoURL]);

  // Subscribe to pending ratings.
  useEffect(() => {
    if (!user) return;
    return listenPendingRatings(user.uid, setQueue);
  }, [user?.uid]);

  if (!user || queue.length === 0) return null;
  const top = queue[0];
  return (
    <RatingPromptModal
      key={top.pairKey}
      pending={top}
      onSubmit={async (stars) => {
        await submitProximityRating(user.uid, top.otherUid, top.pairKey, stars);
      }}
      onSkip={async () => { await dismissPendingRating(user.uid, top.pairKey); }}
    />
  );
}

function RatingPromptModal({
  pending, onSubmit, onSkip,
}: {
  pending: PendingRating;
  onSubmit: (stars: number) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const [stars, setStars] = useState(0);
  const [busy, setBusy] = useState(false);
  const minutes = Math.max(1, Math.round(pending.durationMs / 60000));
  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-ink/40 backdrop-blur-sm p-3">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar src={pending.otherPhoto ?? null} name={pending.otherName} size={48} />
            <div>
              <div className="text-xs uppercase tracking-wide text-ink/50 font-bold">You just met</div>
              <div className="text-lg font-bold text-ink leading-tight">{pending.otherName}</div>
              <div className="text-xs text-ink/60">~{minutes} min nearby</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Skip"
            onClick={() => { if (!busy) { setBusy(true); onSkip().finally(() => setBusy(false)); } }}
            className="text-ink/50 hover:text-ink rounded-full p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 text-sm text-ink/70">How was the interaction?</div>
        <div className="mt-2 flex items-center justify-between">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setStars(n)}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              className="p-2 rounded-full hover:bg-brand-light transition"
            >
              <Star
                size={32}
                strokeWidth={1.6}
                fill={stars >= n ? 'currentColor' : 'none'}
                className={stars >= n ? 'text-brand' : 'text-ink/30'}
              />
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={!stars || busy}
          onClick={() => { setBusy(true); onSubmit(stars).finally(() => setBusy(false)); }}
          className="mt-5 w-full rounded-full bg-brand text-white font-bold py-3 disabled:opacity-50 hover:bg-brand-dark transition"
        >
          {busy ? 'Sending…' : 'Submit rating'}
        </button>
        <button
          type="button"
          onClick={() => { if (!busy) { setBusy(true); onSkip().finally(() => setBusy(false)); } }}
          className="mt-2 w-full text-sm text-ink/60 hover:text-ink py-2"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
