'use client';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { Mic, MicOff, PhoneOff, Phone } from './icons';
import {
  createCall,
  listenCall,
  listenIceCandidates,
  pushIceCandidate,
  setCallAnswer,
  setCallOffer,
  setCallStatus,
  clearIncoming,
  RTC_CONFIG,
  CallRecord,
} from '@/lib/services/calls';

/**
 * Shared WebRTC voice-call sheet for both caller (no `incomingCallId`) and
 * callee (passes `incomingCallId`). Captures local mic, sets up RTCPeerConn,
 * exchanges SDP + ICE via RTDB, plays remote audio, and exposes mute / hangup.
 *
 * Numbers stay private — the call routes through the app, never via PSTN.
 */
export function InAppCallSheet({
  open,
  onClose,
  me,
  peer,
  helpId,
  incomingCallId,
}: {
  open: boolean;
  onClose: () => void;
  me: { uid: string; name: string; photoURL?: string };
  peer: { uid: string; name: string; photoURL?: string };
  helpId?: string;
  incomingCallId?: string;
}) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const offerSetRef = useRef(false);
  const answerSetRef = useRef(false);
  const [callId, setCallId] = useState<string | null>(incomingCallId ?? null);
  const [status, setStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>(incomingCallId ? 'connecting' : 'ringing');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  // Tick the timer once active
  useEffect(() => {
    if (status !== 'active') return;
    const i = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [status]);

  // Wire the entire call flow
  useEffect(() => {
    if (!open) return;
    const isCaller = !incomingCallId;
    let cleanup: (() => void)[] = [];
    let active = true;

    (async () => {
      try {
        // 1) Local audio
        const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!active) { local.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = local;

        // 2) Peer connection
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        local.getTracks().forEach((t) => pc.addTrack(t, local));

        const remoteStream = new MediaStream();
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
        pc.ontrack = (ev) => ev.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));

        // 3) Ensure call record exists
        let id = incomingCallId ?? '';
        if (isCaller) {
          id = await createCall({ from: me, to: peer, helpId });
          setCallId(id);
        }
        if (!id) throw new Error('No call id');

        // 4) ICE outbound
        const myCandSide: 'caller' | 'callee' = isCaller ? 'caller' : 'callee';
        const peerCandSide: 'caller' | 'callee' = isCaller ? 'callee' : 'caller';
        pc.onicecandidate = (ev) => {
          if (ev.candidate) pushIceCandidate(id, myCandSide, ev.candidate.toJSON());
        };

        // 5) ICE inbound
        const offCands = listenIceCandidates(id, peerCandSide, async (c) => {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* noop */ }
        });
        cleanup.push(offCands);

        // 6) Track remote state changes
        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === 'connected') setStatus('active');
          if (st === 'failed' || st === 'disconnected' || st === 'closed') {
            setStatus('ended');
          }
        };

        if (isCaller) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await setCallOffer(id, { type: offer.type, sdp: offer.sdp });
          // Wait for callee answer
          const offCall = listenCall(id, async (rec) => {
            if (!rec) return;
            if (rec.status === 'rejected' || rec.status === 'ended') {
              setStatus('ended'); setTimeout(onClose, 800); return;
            }
            if (rec.answer && !answerSetRef.current) {
              answerSetRef.current = true;
              await pc.setRemoteDescription(new RTCSessionDescription(rec.answer));
              setStatus('active');
            }
          });
          cleanup.push(offCall);
        } else {
          await clearIncoming(me.uid, id);
          const offCall = listenCall(id, async (rec) => {
            if (!rec) return;
            if (rec.status === 'ended' || rec.status === 'rejected') {
              setStatus('ended'); setTimeout(onClose, 800); return;
            }
            if (rec.offer && !offerSetRef.current) {
              offerSetRef.current = true;
              await pc.setRemoteDescription(new RTCSessionDescription(rec.offer));
              const ans = await pc.createAnswer();
              await pc.setLocalDescription(ans);
              await setCallAnswer(id, { type: ans.type, sdp: ans.sdp });
              setStatus('active');
            }
          });
          cleanup.push(offCall);
        }
      } catch (e: any) {
        setError(e?.message ?? 'Could not start call');
      }
    })();

    return () => {
      active = false;
      cleanup.forEach((fn) => { try { fn(); } catch {} });
      try { pcRef.current?.close(); } catch {}
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (callId) { setCallStatus(callId, 'ended').catch(() => {}); clearIncoming(me.uid, callId).catch(() => {}); }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const hangup = () => {
    if (callId) setCallStatus(callId, 'ended').catch(() => {});
    onClose();
  };

  const fmt = (n: number) => `${Math.floor(n / 60)}:${(n % 60).toString().padStart(2, '0')}`;

  return (
    <Sheet open={open} onClose={hangup} title="Voice call">
      <div className="flex flex-col items-center gap-4 py-2">
        <Avatar src={peer.photoURL} name={peer.name} size={88} />
        <div className="text-center">
          <div className="text-lg font-extrabold">{peer.name}</div>
          <div className="text-xs text-muted mt-0.5">
            {error
              ? `Error: ${error}`
              : status === 'ringing'
              ? 'Ringing…'
              : status === 'connecting'
              ? 'Connecting…'
              : status === 'active'
              ? `In call · ${fmt(seconds)}`
              : 'Call ended'}
          </div>
        </div>
        <audio ref={remoteAudioRef} autoPlay playsInline />
        <div className="flex items-center gap-4 mt-2">
          <button
            type="button"
            onClick={toggleMute}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${muted ? 'bg-amber-100 text-amber-700' : 'bg-ink/10 text-ink'}`}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            type="button"
            onClick={hangup}
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white"
            aria-label="Hang up"
          >
            <PhoneOff size={26} />
          </button>
        </div>
        <div className="text-[11px] text-muted mt-1 flex items-center gap-1">
          <Phone size={10} /> Numbers stay private — calls route through Canact.
        </div>
      </div>
    </Sheet>
  );
}
