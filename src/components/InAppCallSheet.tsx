'use client';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { Mic, MicOff, PhoneOff, Phone, Video, VideoOff, SwitchCamera } from './icons';
import {
  createCall,
  listenCall,
  listenIceCandidates,
  pushIceCandidate,
  setCallAnswer,
  setCallOffer,
  setCallStatus,
  setCallKind,
  clearIncoming,
  RTC_CONFIG,
  CallKind,
} from '@/lib/services/calls';

/**
 * Shared WebRTC voice/video-call sheet for both caller (no `incomingCallId`)
 * and callee (passes `incomingCallId`). Either side can flip the call between
 * audio and video mid-call by tapping the upgrade/downgrade button — we write
 * the new `kind` to RTDB and the peer's listener picks it up and adjusts its
 * local capture to match. Numbers stay private — the call routes through the
 * app, never via PSTN.
 */
export function InAppCallSheet({
  open,
  onClose,
  me,
  peer,
  helpId,
  incomingCallId,
  initialKind,
}: {
  open: boolean;
  onClose: () => void;
  me: { uid: string; name: string; photoURL?: string };
  peer: { uid: string; name: string; photoURL?: string };
  helpId?: string;
  incomingCallId?: string;
  initialKind?: CallKind;
}) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const offerSetRef = useRef(false);
  const answerSetRef = useRef(false);
  // Mirror of `callId` state in a ref so the cleanup closure (which is
  // captured at mount time) can always reach the latest id — critical for
  // the caller, whose id is only known after createCall() resolves.
  const callIdRef = useRef<string | null>(incomingCallId ?? null);
  const closingRef = useRef(false);
  const [callId, setCallId] = useState<string | null>(incomingCallId ?? null);
  const [status, setStatus] = useState<'connecting' | 'ringing' | 'active' | 'ended'>(
    incomingCallId ? 'connecting' : 'ringing',
  );
  const [muted, setMuted] = useState(false);
  const [kind, setKind] = useState<CallKind>(initialKind ?? 'audio');
  const [cameraOff, setCameraOff] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (status !== 'active') return;
    const i = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [status]);

  // Wire the entire call flow once when sheet opens.
  useEffect(() => {
    if (!open) return;
    const isCaller = !incomingCallId;
    const cleanup: (() => void)[] = [];
    let active = true;
    const wantVideo = (initialKind ?? 'audio') === 'video';

    (async () => {
      try {
        // 1) Local capture matching the requested kind.
        const local = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: wantVideo ? { facingMode: facing } : false,
        });
        if (!active) { local.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = local;
        if (localVideoRef.current && wantVideo) localVideoRef.current.srcObject = local;

        // 2) Peer connection
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        local.getTracks().forEach((t) => pc.addTrack(t, local));

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        pc.ontrack = (ev) => ev.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));

        let id = incomingCallId ?? '';
        if (isCaller) {
          id = await createCall({ from: me, to: peer, helpId, kind: wantVideo ? 'video' : 'audio' });
          setCallId(id);
          callIdRef.current = id;
        }
        if (!id) throw new Error('No call id');

        const myCandSide: 'caller' | 'callee' = isCaller ? 'caller' : 'callee';
        const peerCandSide: 'caller' | 'callee' = isCaller ? 'callee' : 'caller';
        pc.onicecandidate = (ev) => {
          if (ev.candidate) pushIceCandidate(id, myCandSide, ev.candidate.toJSON());
        };
        const offCands = listenIceCandidates(id, peerCandSide, async (c) => {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* noop */ }
        });
        cleanup.push(offCands);

        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === 'connected') setStatus('active');
          if (st === 'failed' || st === 'disconnected' || st === 'closed') {
            // Peer dropped — tear everything down so the sheet closes
            // automatically, matching what happens when the *local* user
            // taps hang-up. Without this, both sides would just freeze
            // on the call screen forever after the other side ended.
            setStatus('ended');
            if (!closingRef.current) {
              closingRef.current = true;
              setTimeout(() => onClose(), 600);
            }
          }
        };

        // Renegotiation — fired when caller adds/removes tracks (kind flip).
        pc.onnegotiationneeded = async () => {
          if (!isCaller) return;
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await setCallOffer(id, { type: offer.type, sdp: offer.sdp });
          } catch { /* noop */ }
        };

        if (isCaller) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await setCallOffer(id, { type: offer.type, sdp: offer.sdp });

          const offCall = listenCall(id, async (rec) => {
            if (!rec) return;
            if (rec.kind && rec.kind !== kind) setKind(rec.kind);
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
            if (rec.kind && rec.kind !== kind) setKind(rec.kind);
            if (rec.status === 'ended' || rec.status === 'rejected') {
              setStatus('ended'); setTimeout(onClose, 800); return;
            }
            if (rec.offer) {
              // First offer OR a renegotiated one — apply, answer, push back.
              try {
                if (pc.signalingState === 'stable' || !offerSetRef.current) {
                  await pc.setRemoteDescription(new RTCSessionDescription(rec.offer));
                  offerSetRef.current = true;
                  const ans = await pc.createAnswer();
                  await pc.setLocalDescription(ans);
                  await setCallAnswer(id, { type: ans.type, sdp: ans.sdp });
                  setStatus('active');
                }
              } catch { /* skip duplicate offers */ }
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
      // Use the ref — the state captured at mount time is null for the
      // caller, so without this the call record would never be marked
      // ended on RTDB and the peer would keep ringing forever.
      const id = callIdRef.current;
      if (id) {
        setCallStatus(id, 'ended').catch(() => {});
        clearIncoming(me.uid, id).catch(() => {});
      }
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the shared kind flips, ensure local capture matches.
  useEffect(() => {
    const pc = pcRef.current;
    const local = localStreamRef.current;
    if (!pc || !local) return;
    const hasVideo = local.getVideoTracks().length > 0;
    if (kind === 'video' && !hasVideo) {
      (async () => {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
          const track = cam.getVideoTracks()[0];
          if (track) {
            local.addTrack(track);
            pc.addTrack(track, local);
            if (localVideoRef.current) localVideoRef.current.srcObject = local;
          }
        } catch { /* user denied camera */ }
      })();
    } else if (kind === 'audio' && hasVideo) {
      local.getVideoTracks().forEach((t) => { t.stop(); local.removeTrack(t); });
      pc.getSenders().filter((s) => s.track?.kind === 'video').forEach((s) => {
        try { pc.removeTrack(s); } catch {}
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    }
  }, [kind, facing]);

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const toggleCamera = () => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    const next = !cameraOff;
    tracks.forEach((t) => { t.enabled = !next; });
    setCameraOff(next);
  };

  const switchCamera = async () => {
    const next: 'user' | 'environment' = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    const local = localStreamRef.current;
    const pc = pcRef.current;
    if (!local || !pc || kind !== 'video') return;
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: next } });
      const newTrack = cam.getVideoTracks()[0];
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && newTrack) await sender.replaceTrack(newTrack);
      local.getVideoTracks().forEach((t) => { t.stop(); local.removeTrack(t); });
      if (newTrack) local.addTrack(newTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = local;
    } catch { /* noop */ }
  };

  const flipKind = async () => {
    if (!callId) return;
    const next: CallKind = kind === 'audio' ? 'video' : 'audio';
    setKind(next);
    await setCallKind(callId, next).catch(() => {});
  };

  const hangup = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    const id = callIdRef.current ?? callId;
    // 1) Tell the peer FIRST so their listenCall fires and they tear
    //    down too, before we close our own pc (which they'd otherwise
    //    learn about only via ICE timeout, ~30s later).
    if (id) setCallStatus(id, 'ended').catch(() => {});
    // 2) Hard-close locally so the mic / camera are freed instantly
    //    and the user sees the sheet vanish even if RTDB is slow.
    try { pcRef.current?.close(); } catch {}
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    onClose();
  };

  const fmt = (n: number) => `${Math.floor(n / 60)}:${(n % 60).toString().padStart(2, '0')}`;
  const isVideo = kind === 'video';

  return (
    <Sheet open={open} onClose={hangup} title={isVideo ? 'Video call' : 'Voice call'}>
      <div className="flex flex-col items-center gap-4 py-2">
        {isVideo ? (
          <div className="relative w-full overflow-hidden rounded-2xl bg-black aspect-[3/4] max-h-[60vh]">
            <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute right-2 bottom-2 h-32 w-24 rounded-xl border-2 border-white/80 object-cover"
            />
            <div className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-1 text-xs font-bold text-white">
              {peer.name}
            </div>
          </div>
        ) : (
          <Avatar src={peer.photoURL} name={peer.name} size={88} />
        )}
        <div className="text-center">
          {!isVideo && <div className="text-lg font-extrabold">{peer.name}</div>}
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
        <div className="flex items-center gap-3 mt-2 flex-wrap justify-center">
          <button
            type="button"
            onClick={toggleMute}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${muted ? 'bg-amber-100 text-amber-700' : 'bg-ink/10 text-ink'}`}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            type="button"
            onClick={flipKind}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${isVideo ? 'bg-brand text-white' : 'bg-ink/10 text-ink'}`}
            aria-label={isVideo ? 'Switch to voice' : 'Switch to video'}
          >
            {isVideo ? <Phone size={20} /> : <Video size={20} />}
          </button>
          {isVideo && (
            <>
              <button
                type="button"
                onClick={toggleCamera}
                className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${cameraOff ? 'bg-amber-100 text-amber-700' : 'bg-ink/10 text-ink'}`}
                aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {cameraOff ? <VideoOff size={20} /> : <Video size={20} />}
              </button>
              <button
                type="button"
                onClick={switchCamera}
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink/10 text-ink"
                aria-label="Flip camera"
              >
                <SwitchCamera size={20} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={hangup}
            className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white"
            aria-label="Hang up"
          >
            <PhoneOff size={24} />
          </button>
        </div>
        <div className="text-[11px] text-muted mt-1 flex items-center gap-1">
          <Phone size={10} /> Numbers stay private — calls route through Canact.
        </div>
      </div>
    </Sheet>
  );
}
