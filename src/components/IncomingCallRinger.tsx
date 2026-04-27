'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { listenIncomingCalls, setCallStatus, clearIncoming, CallRecord } from '@/lib/services/calls';
import { Avatar } from './Avatar';
import { PhoneCall, PhoneOff } from './icons';
import { InAppCallSheet } from './InAppCallSheet';

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

  // Auto-play a ringtone using a tiny generated tone (no external asset).
  useEffect(() => {
    if (!pending) return;
    let ctx: AudioContext | null = null;
    let osc: OscillatorNode | null = null;
    let gain: GainNode | null = null;
    let stopped = false;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ring = () => {
        if (!ctx || stopped) return;
        osc = ctx.createOscillator();
        gain = ctx.createGain();
        osc.frequency.value = 480;
        osc.connect(gain).connect(ctx.destination);
        gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 0.05);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
        setTimeout(ring, 1700);
      };
      ring();
    } catch { /* no audio permission */ }
    return () => { stopped = true; try { ctx?.close(); } catch {} };
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
        <div className="text-xs uppercase tracking-widest opacity-60">Incoming call</div>
        <div className="mt-2 text-base opacity-80">
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
