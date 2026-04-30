'use client';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { Mic, MicOff, PhoneOff, Phone, Video, VideoOff, SwitchCamera, Volume2, VolumeX, Loader2 } from './icons';
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
  // Outbound ringback tone the caller hears while waiting for the
  // callee to pick up. Plays on a loop, stops the moment status flips
  // to 'active' (peer answered) or 'ended' (peer rejected / hung up).
  const ringbackRef = useRef<HTMLAudioElement | null>(null);
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

  // Drive the outbound ringback tone purely off status. Caller-only
  // (callee never plays ringback — they hear the actual ringtone via
  // the native foreground service / IncomingCallRinger).
  useEffect(() => {
    if (incomingCallId) return; // we are the callee; no ringback
    const el = ringbackRef.current;
    if (!el) return;
    if (status === 'ringing' || status === 'connecting') {
      el.loop = true;
      el.volume = 0.6;
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay may be blocked until user gesture */ });
    } else {
      try { el.pause(); el.currentTime = 0; } catch { /* noop */ }
    }
    return () => { try { el.pause(); } catch {} };
  }, [status, incomingCallId]);

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

        // 1) Local capture FIRST. We have to use plain addTrack(track,
        //    stream) instead of pre-allocating transceivers + replaceTrack
        //    because Capacitor's Android WebView (Chromium-derived but
        //    older) silently drops the encoder pipeline when a sender
        //    starts life trackless and a track is bolted on later — the
        //    SDP looks correct but no RTP ever flows. addTrack on the
        //    other hand is the path the WebView is actually exercised on
        //    in WebRTC conformance tests, so it Just Works.
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active) { audioStream.getTracks().forEach((t) => t.stop()); return; }
        audioStreamRef.current = audioStream;

        let videoStream: MediaStream | null = null;
        if (wantVideo) {
          try {
            videoStream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
            });
            if (!active) { videoStream.getTracks().forEach((t) => t.stop()); return; }
            videoStreamRef.current = videoStream;
          } catch { /* user denied camera — fall back to audio-only */ }
        }

        // Composite stream for the local <video> tile.
        const local = new MediaStream();
        audioStream.getAudioTracks().forEach((t) => local.addTrack(t));
        videoStream?.getVideoTracks().forEach((t) => local.addTrack(t));
        localStreamRef.current = local;
        if (localVideoRef.current && wantVideo) localVideoRef.current.srcObject = local;

        // 2) Peer connection. Add tracks straight away so the very first
        //    SDP offer carries the SSRCs/MSIDs of our real audio (and
        //    video, if this started as a video call) — no track-less
        //    m-section workaround.
        const pc = new RTCPeerConnection(RTC_CONFIG);
        pcRef.current = pc;
        const audioSender = pc.addTrack(audioStream.getAudioTracks()[0], local);
        audioSenderRef.current = audioSender;
        applySendParameters(audioSender, { maxBitrate: 64_000 });
        if (videoStream) {
          const vTrack = videoStream.getVideoTracks()[0];
          if (vTrack) {
            const videoSender = pc.addTrack(vTrack, local);
            videoSenderRef.current = videoSender;
            applySendParameters(videoSender, { maxBitrate: 1_500_000, maxFramerate: 30 });
          }
        }

        const remoteStream = new MediaStream();
        remoteStreamRef.current = remoteStream;
        // Helper that (re)binds the remote stream to the audio + video
        // tags AND explicitly calls .play(). Capacitor's Android WebView
        // ignores the autoplay attribute on a srcObject set after mount
        // — so the connection succeeds, ICE connects, RTP flows, and yet
        // the user hears / sees nothing because the element is paused.
        // We call play() in a microtask after every ontrack and again
        // when loadedmetadata fires, then swallow the inevitable
        // NotAllowedError that browsers raise when no user gesture has
        // happened yet (the original sheet-open tap counts on most
        // platforms but not all).
        const kick = () => {
          const a = remoteAudioRef.current;
          const v = remoteVideoRef.current;
          if (a) {
            try { a.srcObject = remoteStream; } catch {}
            try { a.muted = false; a.volume = 1; } catch {}
            const p = a.play(); if (p && typeof p.catch === 'function') p.catch(() => {});
          }
          if (v) {
            try { v.srcObject = remoteStream; } catch {}
            const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        };
        kick();
        pc.ontrack = (ev) => {
          ev.streams[0]?.getTracks().forEach((t) => {
            try { remoteStream.addTrack(t); } catch {}
          });
          // Some WebRTC stacks send each track in its own stream rather
          // than the unified `streams[0]` — also pick up the bare track.
          if (ev.track && !remoteStream.getTracks().includes(ev.track)) {
            try { remoteStream.addTrack(ev.track); } catch {}
          }
          kick();
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

  // When the shared kind flips, mirror it on local capture. We addTrack
  // (or removeTrack + stop) so the existing peer connection picks up the
  // change; the caller's onnegotiationneeded handler will fire and push
  // a fresh offer/answer round-trip. Both sides run this hook so they
  // each adjust their own outbound media independently.
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc) return;
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
            const sender = pc.addTrack(track, localComposite ?? cam);
            videoSenderRef.current = sender;
            applySendParameters(sender, { maxBitrate: 1_500_000, maxFramerate: 30 });
            localComposite?.addTrack(track);
            if (localVideoRef.current) localVideoRef.current.srcObject = localComposite ?? null;
          }
        } catch { /* user denied camera */ }
      })();
    } else if (kind === 'audio' && hasVideo) {
      (async () => {
        try {
          const sender = videoSenderRef.current;
          if (sender) {
            try { pc.removeTrack(sender); } catch {}
            videoSenderRef.current = null;
          }
        } catch {}
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
    // 1) Tell the peer FIRST and AWAIT the write so we don't lose it to
    //    a process death when the user is on a flaky link. Fire-and-
    //    forget the close-and-cleanup work in parallel so the UI still
    //    snaps shut instantly.
    if (id) {
      // Try to write 'ended' three times spaced ~250ms apart — RTDB on
      // a half-broken connection silently buffers the write but never
      // ships it, and the peer is then stuck on the call screen until
      // their own ICE timeout fires (~30s). Triple-tapping makes the
      // signal land as soon as the radio recovers.
      const writeEnded = (attempt = 0): void => {
        setCallStatus(id, 'ended').catch(() => {
          if (attempt < 2) setTimeout(() => writeEnded(attempt + 1), 250);
        });
      };
      writeEnded();
      clearIncoming(me.uid, id).catch(() => {});
    }
    // 2) Hard-close locally so the mic / camera are freed instantly
    //    and the user sees the sheet vanish even if RTDB is slow.
    try {
      // Stopping each sender's track BEFORE pc.close() makes the peer
      // see an immediate ICE 'disconnected' even when our 'ended' write
      // hasn't arrived yet — their connectionstatechange handler will
      // tear down on its own within 150ms.
      pcRef.current?.getSenders().forEach((s) => { try { s.track?.stop(); } catch {} });
      pcRef.current?.close();
    } catch {}
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
            className="relative w-full overflow-hidden rounded-2xl aspect-[3/4] max-h-[60vh] bg-[#0A0A0A]"
          >
            {/* Minimalist waiting backdrop \u2014 a single brand-coloured spinner
                centred on a flat dark canvas. Sits BEHIND the <video>; the
                moment the remote stream starts painting it covers the
                spinner. No avatar, no text, no gradient \u2014 the cleanest
                possible "waiting" state, matching iOS / WhatsApp video
                calls. */}
            {status !== 'active' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <Loader2 size={36} className="animate-spin text-white/70" />
              </div>
            )}
            <video ref={remoteVideoRef} autoPlay playsInline className="relative z-[1] h-full w-full object-cover" />
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute right-2 bottom-2 z-[2] h-32 w-24 rounded-xl border-2 border-white/80 object-cover bg-black/40"
            />
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
        {/* Outbound ringback tone for the caller (see effect above). */}
        <audio ref={ringbackRef} src="/ringer.mp3" preload="auto" playsInline />
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
