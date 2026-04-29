'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { listenIncomingCalls, setCallStatus, clearIncoming, CallRecord } from '@/lib/services/calls';
import { Avatar } from './Avatar';
import { PhoneCall, PhoneOff, Video } from './icons';
import { InAppCallSheet } from './InAppCallSheet';

/**
 * Pre-decisions made by the native ringer (IncomingCallActivity) when the
 * user taps Answer / Decline before the WebView ringer can render. The
 * NativeCallDeepLinkRouter fills this map; IncomingCallRinger drains it on
 * every state change so the user never has to confirm twice.
 */
type PreDecision = 'answer' | 'decline';
const preDecisions = new Map<string, PreDecision>();
const preDecisionListeners = new Set<() => void>();
export function setCallPreDecision(callId: string, action: PreDecision) {
  preDecisions.set(callId, action);
  preDecisionListeners.forEach((fn) => { try { fn(); } catch { /* noop */ } });
}

/**
 * Globally mounted listener that watches `incomingCalls/{uid}` and surfaces a
 * full-screen accept/reject ringer. On accept, it hands the call off to
 * `InAppCallSheet` which sets up the WebRTC peer connection.
 */
export function IncomingCallRinger() {
  const { user, profile } = useAuth();
  const [pending, setPending] = useState<CallRecord | null>(null);
  const [accepted, setAccepted] = useState<CallRecord | null>(null);

  useEffect(() => {
    if (!user) return;
    return listenIncomingCalls(user.uid, (calls) => {
      // Show the most recent ringing call.
      const ringing = calls.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
      setPending(ringing);
    });
  }, [user]);

  // Honour any pre-decision the native ringer made (Answer / Decline tapped
  // from the lockscreen IncomingCallActivity). Whenever a pending call
  // appears, immediately accept or reject if the user has already chosen.
  useEffect(() => {
    if (!user) return;
    const apply = () => {
      const p = pending;
      if (!p) return;
      const decision = preDecisions.get(p.id);
      if (!decision) return;
      preDecisions.delete(p.id);
      if (decision === 'answer') {
        setAccepted(p);
        setPending(null);
      } else {
        setCallStatus(p.id, 'rejected').catch(() => {});
        clearIncoming(user.uid, p.id).catch(() => {});
        setPending(null);
      }
    };
    apply();
    preDecisionListeners.add(apply);
    return () => { preDecisionListeners.delete(apply); };
  }, [pending?.id, user]);

  // Loop the bundled ringtone while a call is pending. The mp3 lives at
  // /public/ringtone.mp3 and is served from the WebView via the same origin.
  useEffect(() => {
    if (!pending) return;
    let audio: HTMLAudioElement | null = null;
    let stopped = false;
    try {
      audio = new Audio('/ringtone.mp3');
      audio.loop = true;
      audio.volume = 1;
      const tryPlay = () => {
        if (stopped || !audio) return;
        audio.play().catch(() => {
          // Autoplay may be blocked until user gesture; retry shortly.
          setTimeout(tryPlay, 600);
        });
      };
      tryPlay();
    } catch { /* no audio permission */ }
    return () => {
      stopped = true;
      try { audio?.pause(); } catch {}
      try { if (audio) audio.currentTime = 0; } catch {}
      audio = null;
    };
  }, [pending?.id]);

  if (!user || !profile) return null;

  if (accepted) {
    return (
      <InAppCallSheet
        open={!!accepted}
        onClose={() => setAccepted(null)}
        me={{ uid: user.uid, name: profile.fullName, photoURL: profile.photoURL }}
        peer={accepted.from}
        helpId={accepted.helpId}
        incomingCallId={accepted.id}
        initialKind={accepted.kind ?? 'audio'}
      />
    );
  }

  if (!pending) return null;

  const reject = async () => {
    await setCallStatus(pending.id, 'rejected').catch(() => {});
    await clearIncoming(user.uid, pending.id).catch(() => {});
    setPending(null);
  };
  const accept = () => { setAccepted(pending); setPending(null); };

  return (
    <div className="fixed inset-0 z-[200] bg-ink/95 text-white flex flex-col items-center justify-between py-16 px-6">
      <div className="text-center">
        <div className="text-xs uppercase tracking-widest opacity-60">Incoming {pending.kind === 'video' ? 'video call' : 'call'}</div>
        <div className="mt-2 text-base opacity-80 flex items-center justify-center gap-1">
          {pending.kind === 'video' && <Video size={14} />}
          {pending.helpId ? 'Help request' : 'Direct call'}
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Avatar src={pending.from.photoURL} name={pending.from.name} size={120} />
        <div className="text-2xl font-extrabold">{pending.from.name}</div>
        <div className="text-sm opacity-70">Numbers stay private</div>
      </div>
      <div className="flex items-center gap-12">
        <button
          type="button"
          onClick={reject}
          className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500"
          aria-label="Decline"
        >
          <PhoneOff size={26} />
        </button>
        <button
          type="button"
          onClick={accept}
          className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 animate-pulse"
          aria-label="Accept"
        >
          <PhoneCall size={26} />
        </button>
      </div>
    </div>
  );
}
