'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth';
import { startVicinity, listenPendingRatings, dismissPendingRating } from '@/lib/services/vicinity';
import { getAttributeCooldownMs, listenAttributeVotes, removeAttribute, setAttribute, setLikeDislike, type AttributeVoteMap } from '@/lib/services/votes';
import type { AttrKey, PendingRating } from '@/lib/types';
import { POSITIVE_ATTRS, NEGATIVE_ATTRS, ATTR_LABELS } from '@/lib/types';
import { Avatar } from './Avatar';
import { ThumbsUp, ThumbsDown, X } from './icons';
import { toast } from './Toaster';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';

const ALL_ATTRS = [...POSITIVE_ATTRS, ...NEGATIVE_ATTRS] as AttrKey[];

export function VicinityTracker() {
  const { user, profile } = useAuth();
  const [queue, setQueue] = useState<PendingRating[]>([]);

  useEffect(() => {
    if (!user || !profile) return;
    const handle = startVicinity({
      uid: user.uid,
      profile: { fullName: profile.fullName, photoURL: profile.photoURL },
    });
    return () => handle.stop();
  }, [user?.uid, profile?.fullName, profile?.photoURL]);

  useEffect(() => {
    if (!user) return;
    return listenPendingRatings(user.uid, setQueue);
  }, [user?.uid]);

  if (!user || queue.length === 0) return null;
  const top = queue[0];
  return (
    <ProximityRatingPrompt
      key={top.pairKey}
      pending={top}
      myUid={user.uid}
      onSkip={async () => { await dismissPendingRating(user.uid, top.pairKey); }}
    />
  );
}

function ProximityRatingPrompt({
  pending, myUid, onSkip,
}: {
  pending: PendingRating;
  myUid: string;
  onSkip: () => Promise<void>;
}) {
  const [vote, setVote] = useState<'like' | 'dislike' | null>(null);
  const [attr, setAttr] = useState<AttrKey | null>(null);
  const [attrVotes, setAttrVotes] = useState<AttributeVoteMap>({});
  const [busy, setBusy] = useState(false);
  const minutes = Math.max(1, Math.round(pending.durationMs / 60000));
  const swipe = useTopScrollSwipeDismiss({ onClose: () => { void handleSkip(); } });

  const isPositive = (key: AttrKey) => (POSITIVE_ATTRS as readonly string[]).includes(key);

  useEffect(() => listenAttributeVotes(pending.otherUid, myUid, setAttrVotes), [pending.otherUid, myUid]);

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (attr) {
        const result = attrVotes[attr]
          ? await removeAttribute(pending.otherUid, myUid, attr)
          : await setAttribute(pending.otherUid, myUid, attr);
        if (!result.ok) throw new Error(`This attribute is locked for ${Math.max(1, Math.ceil((result.waitMs ?? 0) / 3_600_000))}h`);
      }
      if (vote) await setLikeDislike(pending.otherUid, myUid, vote);
      toast('Rating submitted', 'success');
      await dismissPendingRating(myUid, pending.pairKey);
    } catch (error: any) {
      toast(error?.message || 'Could not submit rating', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSkip = async () => {
    if (busy) return;
    setBusy(true);
    try { await onSkip(); } finally { setBusy(false); }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-canact-popup="true" className="canact-popup-backdrop canact-popup-layer fixed inset-0 flex items-end justify-center p-3 md:items-center">
      <div ref={swipe.ref as React.RefObject<HTMLDivElement | null>} className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl will-change-transform">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar src={pending.otherPhoto ?? null} name={pending.otherName} size={48} />
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[.14em] text-ink/40">You just met</div>
              <div className="text-lg font-extrabold text-ink leading-tight">{pending.otherName}</div>
              <div className="text-xs text-ink/50">~{minutes} min nearby</div>
            </div>
          </div>
          <button type="button" aria-label="Skip" onClick={handleSkip} className="rounded-full p-1 text-ink/40 hover:text-ink">
            <X size={20} />
          </button>
        </div>

        {/* Like / Dislike */}
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => setVote(vote === 'like' ? null : 'like')}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold transition ${
              vote === 'like' ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400' : 'bg-ink/5 text-ink/60 hover:bg-ink/10'
            }`}
          >
            <ThumbsUp size={18} /> Good
          </button>
          <button
            type="button"
            onClick={() => setVote(vote === 'dislike' ? null : 'dislike')}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-extrabold transition ${
              vote === 'dislike' ? 'bg-rose-100 text-rose-700 ring-2 ring-rose-400' : 'bg-ink/5 text-ink/60 hover:bg-ink/10'
            }`}
          >
            <ThumbsDown size={18} /> Not good
          </button>
        </div>

        {/* Attribute chips */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {ALL_ATTRS.map((key) => {
            const given = !!attrVotes[key];
            const cooldown = getAttributeCooldownMs(attrVotes, key);
            const selected = attr === key || given;
            const pos = isPositive(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                title={given ? 'Tap to take back' : cooldown > 0 ? `Available in ${Math.ceil(cooldown / 3_600_000)}h` : undefined}
                onClick={() => {
                  if (cooldown > 0 && !given) {
                    toast(`You already gave ${ATTR_LABELS[key]} · available in ${Math.ceil(cooldown / 3_600_000)}h`, 'error');
                    return;
                  }
                  setAttr(attr === key ? null : key);
                }}
                className={`rounded-lg py-2 text-[11px] font-extrabold transition ${
                  selected
                    ? pos ? 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-400' : 'bg-rose-100 text-rose-700 ring-2 ring-rose-400'
                    : 'bg-ink/5 text-ink/55 hover:bg-ink/10'
                }`}
              >
                {ATTR_LABELS[key]}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={handleSubmit}
          className="mt-4 w-full rounded-full bg-brand py-3 text-sm font-bold text-white transition hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit'}
        </button>
        <button type="button" onClick={handleSkip} className="mt-2 w-full py-2 text-xs font-medium text-ink/40 hover:text-ink/60">
          Skip
        </button>
      </div>
    </div>,
    document.body,
  );
}
