'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { listenHelpFeed } from '@/lib/services/help';
import { haversineMeters } from '@/lib/utils';
import type { HelpRequest } from '@/lib/types';
import { Avatar } from './Avatar';
import { HeartHandshake, X } from './icons';

type Alert =
  | { kind: 'request'; id: string; helpId: string; authorName: string; authorPhoto?: string; text: string; type: HelpRequest['type'] }
  | { kind: 'offer'; id: string; helpId: string; helperUid: string; helperName: string; helperPhoto?: string; helpText: string };

/** Speak a phrase using the browser's TTS. Best-effort — silent if unavailable. */
function speak(text: string) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1; u.pitch = 1; u.volume = 1; u.lang = 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch { /* no-op */ }
}

/**
 * Play a short attention chime so users notice the alert even when TTS
 * is blocked (e.g. tab not yet interacted with). Uses the same WebAudio
 * pattern as IncomingCallRinger.
 */
function chime(pattern: 'request' | 'offer') {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = pattern === 'request' ? [880, 660, 880] : [660, 880, 1100];
    let t = ctx.currentTime;
    for (const f of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      osc.type = 'sine';
      osc.connect(gain).connect(ctx.destination);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.04);
      gain.gain.linearRampToValueAtTime(0, t + 0.32);
      osc.start(t); osc.stop(t + 0.34);
      t += 0.28;
    }
    setTimeout(() => { try { ctx.close(); } catch {} }, 1500);
  } catch { /* no-op */ }
}

const TYPE_LABEL: Record<HelpRequest['type'], { label: string; tint: string }> = {
  red:    { label: 'Red Help',    tint: 'bg-red-500'    },
  orange: { label: 'Orange Help', tint: 'bg-orange-500' },
  yellow: { label: 'Yellow Help', tint: 'bg-yellow-500' },
};

/**
 * Globally mounted listener that surfaces non-dismissible-on-backdrop popups
 * (with TTS) for two events:
 *  1. A new help request created within my vicinity radius (by anyone else).
 *  2. Someone offering to help on a request I created.
 *
 * Multiple alerts queue up and are shown one at a time. They MUST be dismissed
 * manually — no auto-close, no backdrop dismissal.
 */
export function HelpAlertManager() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const router = useRouter();

  // Track which IDs we have already alerted on. Initialised from the first
  // snapshot so we never alert on pre-existing items at mount time.
  const seenRequestIds = useRef<Set<string> | null>(null);
  const seenOfferKeys  = useRef<Set<string> | null>(null);

  const [queue, setQueue] = useState<Alert[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    if (!user) return;
    return listenHelpFeed((items) => {
      const isFirstSnapshot = seenRequestIds.current === null;
      if (isFirstSnapshot) {
        seenRequestIds.current = new Set(items.map((i) => i.id));
        seenOfferKeys.current  = new Set(
          items.flatMap((i) =>
            i.uid === user.uid
              ? Object.keys(i.acceptedBy ?? {}).map((helperUid) => `${i.id}:${helperUid}`)
              : [],
          ),
        );
        return;
      }

      const newAlerts: Alert[] = [];

      for (const h of items) {
        // 1) Brand-new help request from someone else, in radius, still open.
        if (
          !seenRequestIds.current!.has(h.id) &&
          h.uid !== user.uid &&
          h.status === 'open'
        ) {
          seenRequestIds.current!.add(h.id);
          const inRadius =
            coords && typeof h.lat === 'number' && typeof h.lng === 'number'
              ? haversineMeters(coords, { lat: h.lat, lng: h.lng }) <= (h.vicinityMeters ?? 0)
              : false;
          // Only alert when we know the user is inside the request's vicinity.
          if (inRadius) {
            newAlerts.push({
              kind: 'request',
              id: `req:${h.id}`,
              helpId: h.id,
              authorName: h.authorName,
              authorPhoto: h.authorPhoto,
              text: h.text,
              type: h.type,
            });
          }
        } else if (!seenRequestIds.current!.has(h.id)) {
          // Mark seen even if we don't alert (own request / closed / out of radius).
          seenRequestIds.current!.add(h.id);
        }

        // 2) New offer on a request I authored.
        if (h.uid === user.uid && h.acceptedBy) {
          for (const [helperUid, helper] of Object.entries(h.acceptedBy)) {
            const k = `${h.id}:${helperUid}`;
            if (!seenOfferKeys.current!.has(k)) {
              seenOfferKeys.current!.add(k);
              newAlerts.push({
                kind: 'offer',
                id: `off:${k}`,
                helpId: h.id,
                helperUid,
                helperName: helper.name,
                helperPhoto: helper.photoURL,
                helpText: h.text,
              });
            }
          }
        }
      }

      if (newAlerts.length) {
        setQueue((q) => [...q, ...newAlerts]);
        // Fire chime + TTS for the FIRST new alert only — subsequent ones in
        // the queue will trigger when they reach the front (see effect below).
      }
    });
    // We deliberately do not include `coords` so reconnecting the listener on
    // every coord update doesn't replay the firstSnapshot init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Whenever the front-of-queue alert changes, play sound + speak.
  useEffect(() => {
    if (!current) return;
    if (current.kind === 'request') {
      chime('request');
      speak(`A help request is raised by ${current.authorName}`);
    } else {
      chime('offer');
      speak(`${current.helperName} is offering to help`);
    }
  }, [current?.id]);

  if (!user || !profile || !current) return null;

  const dismiss = () => setQueue((q) => q.slice(1));
  const view = () => { router.push(`/help/${current.helpId}`); dismiss(); };

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-alert-title"
    >
      {/* Solid dark backdrop — clicks do NOT dismiss. */}
      <div className="absolute inset-0 bg-ink/70 backdrop-blur-sm" aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-3xl bg-white ring-1 ring-black/5 overflow-hidden">
        {current.kind === 'request' ? (
          <>
            <div className={`flex items-center gap-2 px-5 py-3 text-white font-bold ${TYPE_LABEL[current.type].tint}`}>
              <HeartHandshake size={18} />
              <span>{TYPE_LABEL[current.type].label} nearby</span>
            </div>
            <div className="px-5 pt-5 pb-3 flex items-center gap-3">
              <Avatar src={current.authorPhoto} name={current.authorName} size={56} />
              <div className="min-w-0">
                <div className="text-sm uppercase tracking-wide text-ink/60">Help request raised by</div>
                <div className="text-lg font-extrabold text-ink truncate">{current.authorName}</div>
              </div>
            </div>
            <p className="px-5 pb-5 text-ink/85 text-sm leading-relaxed">
              {current.text}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 px-5 py-3 bg-emerald-500 text-white font-bold">
              <HeartHandshake size={18} />
              <span>Someone wants to help</span>
            </div>
            <div className="px-5 pt-5 pb-3 flex items-center gap-3">
              <Avatar src={current.helperPhoto} name={current.helperName} size={56} />
              <div className="min-w-0">
                <div className="text-sm uppercase tracking-wide text-ink/60">Offer to help from</div>
                <div className="text-lg font-extrabold text-ink truncate">{current.helperName}</div>
              </div>
            </div>
            <p className="px-5 pb-5 text-ink/85 text-sm leading-relaxed">
              On your request: <span className="italic">“{current.helpText}”</span>
            </p>
          </>
        )}

        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={dismiss}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-ink/15 bg-white text-ink font-semibold py-2.5 hover:bg-ink/5"
          >
            <X size={16} /> Dismiss
          </button>
          <button
            type="button"
            onClick={view}
            className="flex-1 inline-flex items-center justify-center rounded-full bg-brand text-white font-bold py-2.5 hover:bg-brand-dark"
          >
            {current.kind === 'request' ? 'View request' : 'View offer'}
          </button>
        </div>

        {queue.length > 1 && (
          <div className="px-5 pb-3 -mt-2 text-center text-xs text-ink/50">
            +{queue.length - 1} more alert{queue.length - 1 === 1 ? '' : 's'} queued
          </div>
        )}
      </div>
    </div>
  );
}
