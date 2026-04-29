'use client';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { Mic, MicOff, PhoneOff, Phone, Video, VideoOff, SwitchCamera, Volume2, VolumeX } from './icons';
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
import { startCallAudio, setCallSpeaker, endCallAudio } from '@/lib/audioRouter';

/**
 * Cap a sender's outbound bitrate / framerate so the WebView's encoder
 * doesn't sit at the codec default ceiling. Tuned for sub-1.5 Mbps mobile
 * uplinks where staying under-budget keeps frames smooth instead of the
 * encoder periodically dropping to recover. Best-effort \u2014 some browsers
 * silently ignore unsupported keys, which is fine.
 */
function applySendParameters(
  sender: RTCRtpSender,
  encoding: { maxBitrate?: number; maxFramerate?: number },
) {
  try {
    const params = sender.getParameters() as RTCRtpSendParameters & {
      encodings: RTCRtpEncodingParameters[];
      degradationPreference?: RTCDegradationPreference;
    };
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}];
    }
    params.encodings[0] = { ...params.encodings[0], ...encoding };
    // For video: preserve smooth motion when the network can't sustain
    // both \u2014 the resolution drops temporarily but the frame rate stays at
    // 30 fps so the call doesn't feel like a slideshow.
    params.degradationPreference = 'maintain-framerate';
    void sender.setParameters(params).catch(() => {});
  } catch { /* noop */ }
}

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
  // Composite stream wired into the local <video> tile. Holds whichever
  // tracks we're currently capturing (always audio, optionally video).
  const audioStreamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  // Senders we hand to the peer connection on day one via addTransceiver.
  // Pre-creating both audio + video m-sections in the very first SDP
  // offer means a mid-call audio↔video flip is just `replaceTrack(...)`
  // — no renegotiation, no second offer/answer round-trip, no race
  // condition where one side adds a track and the other never sees it.
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const videoSenderRef = useRef<RTCRtpSender | null>(null);
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
  // Voice calls default to the device earpiece (speaker=false) so users can
  // hold the phone to their ear like a normal call. Video calls default to
  // the loudspeaker since the phone is held away from the face.
  const [speakerOn, setSpeakerOn] = useState<boolean>((initialKind ?? 'audio') === 'video');
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
        // Flip Android into MODE_IN_COMMUNICATION so the WebRTC remote
        // stream renders out the earpiece (or speaker, for video) instead
        // of always blasting through MEDIA volume on the loudspeaker.
        await startCallAudio(wantVideo);

        // 1) Peer connection FIRST so we can pre-create the audio+video
        //    transceivers before we even capture media. The m-sections
        //    are now baked into the first SDP offer regardless of whether
        //    the call started as audio or video, which is what makes a
        //    mid-call audio→video upgrade just `replaceTrack(track)` on
        //    both sides instead of a dance of addTrack + renegotiate.
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        const audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
        const videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
        audioSenderRef.current = audioTx.sender;
        videoSenderRef.current = videoTx.sender;

        // 2) Local capture. Audio is always on; video only if the call
        //    started as video.
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) { audioStream.getTracks().forEach((t) => t.stop()); return; }
        audioStreamRef.current = audioStream;
        await audioTx.sender.replaceTrack(audioStream.getAudioTracks()[0] ?? null);

        let videoStream: MediaStream | null = null;
        if (wantVideo) {
          try {
            videoStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
            });
            if (!active) { videoStream.getTracks().forEach((t) => t.stop()); return; }
            videoStreamRef.current = videoStream;
            await videoTx.sender.replaceTrack(videoStream.getVideoTracks()[0] ?? null);
          } catch { /* user denied camera — fall back to audio-only */ }
        }

        // Composite stream for the local <video> tile.
        const local = new MediaStream();
        audioStream.getAudioTracks().forEach((t) => local.addTrack(t));
        videoStream?.getVideoTracks().forEach((t) => local.addTrack(t));
        localStreamRef.current = local;
        if (localVideoRef.current && wantVideo) localVideoRef.current.srcObject = local;

        // Cap bitrates so the WebView doesn't sit at the codec's default
        // multi-megabit ceiling on weaker networks (which on mobile means
        // dropped frames + crackly audio). Numbers are tuned to stay
        // smooth on a 3G/LTE link.
        applySendParameters(audioTx.sender, { maxBitrate: 64_000 });
        applySendParameters(videoTx.sender, {
          maxBitrate: 1_500_000, // 1.5 Mbps cap
          maxFramerate: 30,
        });

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        pc.ontrack = (ev) => {
          ev.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
          // Re-bind in case the element was created before ontrack fired.
          if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream;
          if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
        };

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
              setTimeout(() => onClose(), 150);
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
              setStatus('ended'); setTimeout(onClose, 150); return;
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
              setStatus('ended'); setTimeout(onClose, 150); return;
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
      // Stop both source streams — freeing mic / camera HW immediately
      // matters because users will often launch another app right after.
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      videoStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
      videoStreamRef.current = null;
      localStreamRef.current = null;
      audioSenderRef.current = null;
      videoSenderRef.current = null;
      // Drop the remote stream from the audio/video tags so the WebView
      // releases its decoder + GPU surface immediately rather than
      // hanging on for ~1s after pc.close() (which is the visual
      // "call ended but the screen is still showing" lag).
      remoteStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      remoteStreamRef.current = null;
      try { if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null; } catch {}
      try { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null; } catch {}
      try { if (localVideoRef.current) localVideoRef.current.srcObject = null; } catch {}
      // Use the ref — the state captured at mount time is null for the
      // caller, so without this the call record would never be marked
      // ended on RTDB and the peer would keep ringing forever.
      const id = callIdRef.current;
      if (id) {
        setCallStatus(id, 'ended').catch(() => {});
        clearIncoming(me.uid, id).catch(() => {});
      }
      // Restore Android audio mode so other apps' media playback isn't
      // stuck on the in-call volume channel after the sheet closes.
      endCallAudio().catch(() => {});
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the shared kind flips, mirror it on local capture using the
  // pre-created video transceiver — no renegotiation needed since the
  // m=video section was baked into the first offer.
  useEffect(() => {
    const pc = pcRef.current;
    const videoSender = videoSenderRef.current;
    if (!pc || !videoSender) return;
    const localComposite = localStreamRef.current;
    const hasVideo = (videoStreamRef.current?.getVideoTracks().length ?? 0) > 0;

    if (kind === 'video' && !hasVideo) {
      (async () => {
        try {
          const cam = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
          });
          videoStreamRef.current = cam;
          const track = cam.getVideoTracks()[0];
          if (track) {
            await videoSender.replaceTrack(track);
            // Re-apply bitrate cap — setParameters is per-sender state
            // but some browsers reset it after replaceTrack.
            applySendParameters(videoSender, { maxBitrate: 1_500_000, maxFramerate: 30 });
            localComposite?.addTrack(track);
            if (localVideoRef.current) localVideoRef.current.srcObject = localComposite ?? null;
          }
        } catch { /* user denied camera */ }
      })();
    } else if (kind === 'audio' && hasVideo) {
      (async () => {
        try { await videoSender.replaceTrack(null); } catch {}
        videoStreamRef.current?.getVideoTracks().forEach((t) => {
          try { t.stop(); } catch {}
          localComposite?.removeTrack(t);
        });
        videoStreamRef.current = null;
        if (localVideoRef.current) localVideoRef.current.srcObject = null;
      })();
    }
  }, [kind, facing]);

  const toggleMute = () => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    const next = !muted;
    tracks.forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    setCallSpeaker(next).catch(() => {});
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
    const videoSender = videoSenderRef.current;
    const local = localStreamRef.current;
    if (!videoSender || kind !== 'video') return;
    try {
      // Capacitor's Android WebView often ignores the facingMode constraint
      // — it just hands back whatever camera is currently selected. Stop
      // the existing track FIRST so the OS releases the camera, then ask
      // for the other facing; if the resulting track has the wrong
      // facingMode reported back, fall through to enumerateDevices and
      // pick the next videoinput device by deviceId, which always works.
      videoStreamRef.current?.getVideoTracks().forEach((t) => {
        try { t.stop(); local?.removeTrack(t); } catch {}
      });

      let cam: MediaStream | null = null;
      try {
        cam = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: next }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        });
      } catch {
        // exact-facingMode rejected — enumerate and round-robin instead.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        const cams = devices.filter((d) => d.kind === 'videoinput');
        if (cams.length > 1) {
          const currentId = videoStreamRef.current?.getVideoTracks()[0]?.getSettings().deviceId;
          const nextDev = cams.find((d) => d.deviceId !== currentId) ?? cams[0];
          cam = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: nextDev.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
          });
        } else {
          // Single-camera device — nothing to flip to. Restore previous capture.
          cam = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
        }
      }

      videoStreamRef.current = cam;
      const newTrack = cam.getVideoTracks()[0];
      if (newTrack) {
        await videoSender.replaceTrack(newTrack);
        applySendParameters(videoSender, { maxBitrate: 1_500_000, maxFramerate: 30 });
        local?.addTrack(newTrack);
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = local ?? null;
    } catch { /* noop */ }
  };

  const flipKind = async () => {
    if (!callId) return;
    const next: CallKind = kind === 'audio' ? 'video' : 'audio';
    setKind(next);
    // Mid-call upgrade to video → user almost certainly wants the loud
    // speaker; downgrade to audio → they want the earpiece back. The
    // explicit speaker button still lets them override either default.
    const wantSpeaker = next === 'video';
    setSpeakerOn(wantSpeaker);
    setCallSpeaker(wantSpeaker).catch(() => {});
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
    audioStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    videoStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    localStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    audioStreamRef.current = null;
    videoStreamRef.current = null;
    localStreamRef.current = null;
    audioSenderRef.current = null;
    videoSenderRef.current = null;
    // Drop the remote stream too so the WebView's video decoder releases
    // its surface immediately — this is what was making the screen
    // appear to "hang" for a second after tapping hang-up on a video call.
    remoteStreamRef.current?.getTracks().forEach((t) => { try { t.stop(); } catch {} });
    remoteStreamRef.current = null;
    try { if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null; } catch {}
    try { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null; } catch {}
    try { if (localVideoRef.current) localVideoRef.current.srcObject = null; } catch {}
    // Restore the device's normal audio mode — mirrors the cleanup in
    // the open-effect's teardown for the case where the user taps the
    // hang-up button (which calls onClose synchronously).
    endCallAudio().catch(() => {});
    onClose();
  };

  const fmt = (n: number) => `${Math.floor(n / 60)}:${(n % 60).toString().padStart(2, '0')}`;
  const isVideo = kind === 'video';

  return (
    <Sheet open={open} onClose={hangup} title={isVideo ? 'Video call' : 'Voice call'}>
      <div className="flex flex-col items-center gap-4 py-2">
        {isVideo ? (
          <div
            className="relative w-full overflow-hidden rounded-2xl aspect-[3/4] max-h-[60vh]"
            style={{
              background:
                'radial-gradient(120% 80% at 50% 0%, #FFE4E8 0%, #F4B6BF 55%, #C8102E 130%)',
            }}
          >
            {/* Branded waiting backdrop — sits BEHIND the <video>; once the
                remote stream arrives the cover paints over it, but until
                then we get a tasteful gradient + the peer's avatar
                instead of the WebView's black play-triangle default. */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Avatar src={peer.photoURL} name={peer.name} size={104} />
              <div className="rounded-full bg-white/85 px-3 py-1 text-xs font-extrabold text-brand backdrop-blur">
                {status === 'active' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Ringing…'}
              </div>
            </div>
            <video ref={remoteVideoRef} autoPlay playsInline className="relative z-[1] h-full w-full object-cover" />
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute right-2 bottom-2 z-[2] h-32 w-24 rounded-xl border-2 border-white/80 object-cover bg-brand-light/40"
            />
            <div className="absolute left-2 top-2 z-[2] rounded-full bg-black/55 px-2 py-1 text-xs font-bold text-white">
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
            onClick={toggleSpeaker}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full ${speakerOn ? 'bg-brand text-white' : 'bg-ink/10 text-ink'}`}
            aria-label={speakerOn ? 'Speaker on — tap for earpiece' : 'Earpiece — tap for speaker'}
            aria-pressed={speakerOn}
          >
            {speakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
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
