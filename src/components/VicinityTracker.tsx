'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth';
import { startVicinity, listenPendingRatings, dismissPendingRating } from '@/lib/services/vicinity';
import { getAttributeCooldownMs, listenAttributeVotes, removeAttribute, setAttribute, setLikeDislike, type AttributeVoteMap } from '@/lib/services/votes';
import type { AttrKey, PendingRating } from '@/lib/types';
import { Avatar } from './Avatar';
import { ThumbsUp, ThumbsDown, X } from './icons';
import { toast } from './Toaster';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';
import { AttributePairSlider } from './ProfileRecognitionFolders';

const ATTRIBUTE_PAIRS: ReadonlyArray<{ negative: AttrKey; positive: AttrKey }> = [
  { negative: 'rude', positive: 'behaviour' },
  { negative: 'unreliable', positive: 'reliability' },
  { negative: 'uncivil', positive: 'civic_sense' },
];
type AttributeDraft = { key: AttrKey; action: 'set' | 'remove' };

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
  const [attributeDraft, setAttributeDraft] = useState<AttributeDraft | null>(null);
  const [attrVotes, setAttrVotes] = useState<AttributeVoteMap>({});
  const [busy, setBusy] = useState(false);
  const minutes = Math.max(1, Math.round(pending.durationMs / 60000));
  const swipe = useTopScrollSwipeDismiss({ onClose: () => { void handleSkip(); } });

  useEffect(() => listenAttributeVotes(pending.otherUid, myUid, setAttrVotes), [pending.otherUid, myUid]);

  const handleSubmit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (attributeDraft) {
        const result = attributeDraft.action === 'remove'
          ? await removeAttribute(pending.otherUid, myUid, attributeDraft.key)
          : await setAttribute(pending.otherUid, myUid, attributeDraft.key);
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
      <div ref={swipe.ref as React.RefObject<HTMLDivElement | null>} className="no-scrollbar max-h-[calc(var(--canact-viewport-height,100svh)-24px)] w-full max-w-md overflow-y-auto rounded-[32px] bg-[#faf8f2] p-4 shadow-[0_18px_60px_rgba(20,48,40,0.16)] will-change-transform overscroll-contain">
        <div className="relative overflow-hidden rounded-[26px] border border-brand/10 bg-gradient-to-br from-[#e5f2ec] via-white to-[#f7eee5] p-4">
          <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-brand/5" aria-hidden="true" />
          <button type="button" aria-label="Skip rating" onClick={handleSkip} className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-ink/45 shadow-sm transition hover:text-ink">
            <X size={18} />
          </button>
          <div className="flex items-center gap-4 pr-10">
            <Avatar src={pending.otherPhoto ?? null} name={pending.otherName} size={96} className="shrink-0 rounded-[24px] ring-4 ring-white shadow-[0_10px_24px_rgba(24,60,48,0.16)]" />
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[.18em] text-brand/55">You just met</div>
              <div className="mt-1 truncate text-[22px] font-black leading-tight tracking-[-.035em] text-ink">{pending.otherName}</div>
              <div className="mt-1 inline-flex items-center rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold text-ink/50">About {minutes} min nearby</div>
            </div>
          </div>
        </div>

        {/* Like / Dislike */}
        <div className="mt-4 grid grid-cols-2 gap-1.5 rounded-[20px] bg-ink/[.045] p-1.5">
          <button
            type="button"
            onClick={() => setVote(vote === 'like' ? null : 'like')}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-black transition ${
              vote === 'like' ? 'bg-[#d8f4e6] text-emerald-700 shadow-sm ring-1 ring-emerald-400' : 'bg-white/75 text-ink/55 hover:bg-white'
            }`}
          >
            <ThumbsUp size={18} /> Good
          </button>
          <button
            type="button"
            onClick={() => setVote(vote === 'dislike' ? null : 'dislike')}
            className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl text-sm font-black transition ${
              vote === 'dislike' ? 'bg-[#fde0e0] text-rose-700 shadow-sm ring-1 ring-rose-400' : 'bg-white/75 text-ink/55 hover:bg-white'
            }`}
          >
            <ThumbsDown size={18} /> Not good
          </button>
        </div>

        <section className="mt-4 rounded-[24px] border border-brand/10 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]" aria-labelledby="vicinity-attribute-title">
          <div className="mb-4">
            <h3 id="vicinity-attribute-title" className="text-[15px] font-black tracking-[-.02em] text-ink">Slide the signals</h3>
            <p className="mt-1 text-[11px] font-semibold leading-relaxed text-ink/50">Move one slider toward the quality that best matched your experience.</p>
          </div>
          <div className="grid gap-4">
          {ATTRIBUTE_PAIRS.map(({ negative, positive }) => {
            const existingKey = attrVotes[negative] ? negative : attrVotes[positive] ? positive : null;
            const draftIsForPair = attributeDraft?.key === negative || attributeDraft?.key === positive;
            const selectedValue: -1 | 0 | 1 = draftIsForPair
              ? attributeDraft?.action === 'remove' ? 0 : attributeDraft?.key === negative ? -1 : 1
              : existingKey === negative ? -1 : existingKey === positive ? 1 : 0;
            const cooldown = Math.max(getAttributeCooldownMs(attrVotes, negative), getAttributeCooldownMs(attrVotes, positive));
            return (
              <AttributePairSlider
                key={positive}
                negative={negative}
                positive={positive}
                negativeCount={0}
                positiveCount={0}
                selectedValue={selectedValue}
                busy={busy}
                cooldownMs={cooldown}
                readOnly={false}
                labelMode="names"
                dynamicLabel
                onCommit={(value) => {
                  if (value === 0) {
                    setAttributeDraft(existingKey ? { key: existingKey, action: 'remove' } : null);
                    return;
                  }
                  const nextKey = value === -1 ? negative : positive;
                  setAttributeDraft(existingKey === nextKey ? null : { key: nextKey, action: 'set' });
                }}
              />
            );
          })}
          </div>
        </section>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            disabled={busy || (!vote && !attributeDraft)}
            onClick={handleSubmit}
            className="min-h-[52px] w-full rounded-full bg-brand px-5 py-3.5 text-sm font-black text-white shadow-[0_10px_24px_rgba(31,107,85,0.2)] transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Submitting…' : 'Submit feedback'}
          </button>
          <button type="button" disabled={busy} onClick={handleSkip} className="w-full py-2 text-xs font-bold text-ink/40 transition hover:text-ink/65 disabled:opacity-40">
            Skip for now
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
