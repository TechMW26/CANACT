'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  requestVideoUpgrade,
  clearVideoRequest,
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
  // SDP fingerprints of the last offer/answer we applied so we can
  // distinguish a fresh renegotiated offer/answer from the original one
  // that's still sitting in RTDB. Without this the caller would happily
  // skip the renegotiated answer (because answerSetRef was already true)
  // and the upgraded video tracks would never connect.
  const lastOfferSdpRef = useRef<string | null>(null);
  const lastAnswerSdpRef = useRef<string | null>(null);
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
  // Mid-call video upgrade: who requested + when. When `videoRequest.from`
  // is the peer's uid, we render the Accept / Decline overlay. When it's
  // our own uid, we render a "Waiting for X to accept video..." indicator.
  const [videoRequest, setVideoRequest] = useState<{ from: string; at: number } | null>(null);
  // True only once we actually have a live local video track wired into
  // the picture-in-picture self-view. Prevents the empty black tile from
  // flashing in during incoming-call setup.
  const [hasLocalVideo, setHasLocalVideo] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);

  useEffect(() => {
    if (status !== 'active') return;
    const i = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(i);
  }, [status]);

  // Re-bind the local stream to the self-view <video> whenever
  // hasLocalVideo flips on. The original code set srcObject inside the
  // setup effect *before* the React state update mounted the element,
  // so the ref was null and the tile stayed black. Doing it here in a
  // dedicated effect guarantees the element is mounted by the time we
  // try to attach the stream.
  useEffect(() => {
    if (!hasLocalVideo) return;
    const el = localVideoRef.current;
    const stream = localStreamRef.current;
    if (!el || !stream) return;
    try { el.srcObject = stream; } catch { /* noop */ }
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay may be blocked */ });
  }, [hasLocalVideo, cameraOff]);

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
        setHasLocalVideo(!!videoStream && (videoStream.getVideoTracks().length > 0));

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
          if (ev.track?.kind === 'video') setHasRemoteVideo(true);
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
        // Buffer remote ICE candidates that arrive BEFORE setRemoteDescription
        // — Firebase RTDB delivers signaling messages in arbitrary order, so
        // on a slow network the callee can easily receive a few candidates
        // before the SDP offer lands. Calling addIceCandidate() in that
        // window throws silently and we lose the candidate forever, which
        // is one of the main causes of "connected but no media".
        const pendingCands: RTCIceCandidateInit[] = [];
        let remoteDescSet = false;
        const drainCands = async () => {
          while (pendingCands.length) {
            const c = pendingCands.shift()!;
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* noop */ }
          }
        };
        pc.onicecandidate = (ev) => {
          if (ev.candidate) pushIceCandidate(id, myCandSide, ev.candidate.toJSON());
        };
        const offCands = listenIceCandidates(id, peerCandSide, async (c) => {
          if (!remoteDescSet) { pendingCands.push(c); return; }
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
            setVideoRequest(rec.videoRequest ?? null);
            if (rec.status === 'rejected' || rec.status === 'ended') {
              setStatus('ended'); setTimeout(onClose, 150); return;
            }
            if (rec.answer && rec.answer.sdp !== lastAnswerSdpRef.current) {
              answerSetRef.current = true;
              lastAnswerSdpRef.current = rec.answer.sdp ?? null;
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(rec.answer));
                remoteDescSet = true;
                await drainCands();
                setStatus('active');
              } catch { /* ignore stale or duplicate */ }
            }
          });
          cleanup.push(offCall);
        } else {
          await clearIncoming(me.uid, id);
          const offCall = listenCall(id, async (rec) => {
            if (!rec) return;
            if (rec.kind && rec.kind !== kind) setKind(rec.kind);
            setVideoRequest(rec.videoRequest ?? null);
            if (rec.status === 'ended' || rec.status === 'rejected') {
              setStatus('ended'); setTimeout(onClose, 150); return;
            }
            if (rec.offer && rec.offer.sdp !== lastOfferSdpRef.current) {
              // First offer OR a renegotiated one — apply, answer, push back.
              try {
                if (pc.signalingState === 'stable' || !offerSetRef.current) {
                  // Mid-call video upgrade hand-off: if we have a camera
                  // stream queued from acceptVideoRequest but no video
                  // sender yet, attach it BEFORE setRemoteDescription so
                  // WebRTC pairs our outbound video with the m-line in
                  // the caller's incoming offer instead of orphaning it.
                  if (videoStreamRef.current && !videoSenderRef.current) {
                    const track = videoStreamRef.current.getVideoTracks()[0];
                    if (track) {
                      const local = localStreamRef.current ?? videoStreamRef.current;
                      try {
                        const sender = pc.addTrack(track, local);
                        videoSenderRef.current = sender;
                        applySendParameters(sender, { maxBitrate: 1_500_000, maxFramerate: 30 });
                      } catch { /* track may already be added */ }
                    }
                  }
                  await pc.setRemoteDescription(new RTCSessionDescription(rec.offer));
                  offerSetRef.current = true;
                  lastOfferSdpRef.current = rec.offer.sdp ?? null;
                  remoteDescSet = true;
                  await drainCands();
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
      setHasLocalVideo(false);
      setHasRemoteVideo(false);
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
            setHasLocalVideo(true);
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
        setHasLocalVideo(false);
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
    // Downgrade video → audio is unilateral and instantaneous (the peer
    // just stops receiving video; no consent required).
    if (kind === 'video') {
      const next: CallKind = 'audio';
      setKind(next);
      setSpeakerOn(false);
      setCallSpeaker(false).catch(() => {});
      await setCallKind(callId, next).catch(() => {});
      return;
    }
    // Upgrade audio → video must be accepted by the peer. We write a
    // `videoRequest` marker and wait — only when the peer flips `kind`
    // to 'video' (which they do *after* adding their own local video
    // track) does our own kind effect kick in and add ours too.
    await requestVideoUpgrade(callId, me.uid).catch(() => {});
  };

  /** Caller-side cancel: drop our outstanding upgrade request. */
  const cancelVideoRequest = async () => {
    if (!callId) return;
    await clearVideoRequest(callId).catch(() => {});
  };

  /** Callee-side accept: pre-acquire the camera stream and stash it in
   *  videoStreamRef so the listenCall offer-handler below can attach it
   *  to the peer connection JUST BEFORE answering the renegotiated offer
   *  the caller is about to push. We DO NOT addTrack here — adding the
   *  track in stable state creates a free-floating transceiver that
   *  doesn't get paired with the m-line in the caller's incoming offer,
   *  which is exactly the bug that left the accepter watching a black
   *  placeholder while the caller's camera streamed nowhere. */
  const acceptVideoRequest = async () => {
    if (!callId) return;
    const pc = pcRef.current;
    if (!pc) return;
    try {
      const cam = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
      });
      videoStreamRef.current = cam;
      // Light up the local self-view immediately so the user gets visual
      // confirmation their camera is on, even before the renegotiated
      // offer arrives.
      const local = localStreamRef.current;
      if (local) {
        cam.getVideoTracks().forEach((t) => {
          if (!local.getVideoTracks().includes(t)) local.addTrack(t);
        });
      }
      if (localVideoRef.current) localVideoRef.current.srcObject = local ?? cam;
      setHasLocalVideo(true);
    } catch (e: any) {
      setError(e?.message ?? 'Camera unavailable');
      await clearVideoRequest(callId).catch(() => {});
      return;
    }
    setKind('video');
    setSpeakerOn(true);
    setCallSpeaker(true).catch(() => {});
    await setCallKind(callId, 'video').catch(() => {});
  };

  /** Callee-side decline: just drop the request marker. Peer's UI hides
   *  the "waiting for accept" indicator and stays on voice. */
  const declineVideoRequest = async () => {
    if (!callId) return;
    await clearVideoRequest(callId).catch(() => {});
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
  // True when the PEER asked us to enable video — show Accept / Decline.
  const peerWantsVideo = !!videoRequest && videoRequest.from !== me.uid && kind !== 'video';
  // True when WE asked the peer and we're waiting for their answer.
  const waitingForPeer = !!videoRequest && videoRequest.from === me.uid && kind !== 'video';

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2147483000] flex flex-col bg-[#0A0A0A] text-white safe-top safe-bottom"
      role="dialog"
      aria-modal="true"
    >
      {/* Top status bar */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <div className="text-[11px] uppercase tracking-widest text-white/55">
          {isVideo ? 'Video call' : 'Voice call'}
        </div>
        <div className="text-[11px] text-white/55">
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

      {/* Main stage — fills the screen. Video for video calls, big avatar
          + name for voice calls. */}
      <div className="relative flex-1 overflow-hidden">
        {isVideo ? (
          <>
            {/* Pretty backdrop while the remote camera isn't streaming
                yet — peer avatar + name on a soft gradient. Beats the
                old empty-black-rectangle + bare spinner placeholder. */}
            {!hasRemoteVideo && (
              <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-brand/30 via-[#0A0A0A] to-[#0A0A0A]">
                <Avatar src={peer.photoURL} name={peer.name} size={120} />
                <div className="text-lg font-extrabold">{peer.name}</div>
                <div className="inline-flex items-center gap-2 text-xs text-white/70">
                  <Loader2 size={14} className="animate-spin" />
                  {status === 'active' ? 'Waiting for camera…' : 'Connecting…'}
                </div>
              </div>
            )}
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className={`relative z-[2] h-full w-full object-cover bg-transparent transition-opacity ${hasRemoteVideo ? 'opacity-100' : 'opacity-0'}`}
            />
            {/* Always-mount the self-view <video> so the React ref is
                live the instant getUserMedia resolves — the original
                `hasLocalVideo && !cameraOff` gate meant the element
                hadn't mounted yet when we tried to set srcObject, so
                the camera tile stayed black. We hide it via opacity
                until the local stream is wired and the camera is on. */}
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`absolute right-3 top-3 z-[3] h-40 w-28 rounded-2xl border-2 border-white/85 object-cover bg-black/40 shadow-lg transition-opacity ${hasLocalVideo && !cameraOff ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            />
            {/* Custom self-view placeholder shown while the camera
                spins up — replaces the empty black box that the
                browser shows when a <video> has no srcObject. */}
            {(!hasLocalVideo || cameraOff) && (
              <div className="absolute right-3 top-3 z-[3] h-40 w-28 rounded-2xl border-2 border-white/85 bg-gradient-to-br from-brand/40 to-ink/80 shadow-lg flex flex-col items-center justify-center gap-1 text-white">
                {cameraOff ? (
                  <>
                    <VideoOff size={20} />
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">Camera off</span>
                  </>
                ) : (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-[10px] font-bold uppercase tracking-wide opacity-80">You</span>
                  </>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-brand/30 via-[#0A0A0A] to-[#0A0A0A]">
            <Avatar src={peer.photoURL} name={peer.name} size={140} />
            <div className="text-2xl font-extrabold">{peer.name}</div>
            <div className="text-xs text-white/55">Numbers stay private</div>
          </div>
        )}

        {/* Peer is asking us to enable video — Accept / Decline overlay. */}
        {peerWantsVideo && (
          <div className="absolute inset-x-4 bottom-32 z-[5] rounded-3xl bg-white/95 p-4 text-ink shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Video size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold">{peer.name} wants to start video</div>
                <div className="text-xs text-ink/55">They&apos;ll see your camera once you accept.</div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={declineVideoRequest}
                className="rounded-full bg-ink/5 px-4 py-2 text-sm font-bold text-ink"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={acceptVideoRequest}
                className="rounded-full bg-brand px-4 py-2 text-sm font-bold text-white"
              >
                Accept
              </button>
            </div>
          </div>
        )}

        {/* We asked the peer — show a small waiting chip. */}
        {waitingForPeer && (
          <div className="absolute inset-x-4 bottom-32 z-[5] flex items-center justify-between gap-3 rounded-full bg-white/15 px-4 py-2 text-xs text-white backdrop-blur">
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Waiting for {peer.name} to accept video…
            </span>
            <button type="button" onClick={cancelVideoRequest} className="text-[11px] font-bold text-white/85 underline">
              Cancel
            </button>
          </div>
        )}
      </div>

      <audio ref={remoteAudioRef} autoPlay playsInline />
      {/* Outbound ringback tone for the caller. */}
      <audio ref={ringbackRef} src="/ringer.mp3" preload="auto" playsInline />

      {/* Bottom control bar */}
      <div className="px-4 pb-6 pt-3">
        <div className="mx-auto flex max-w-md items-center justify-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={toggleMute}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${muted ? 'bg-amber-100 text-amber-700' : 'bg-white/10 text-white'} backdrop-blur`}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            type="button"
            onClick={toggleSpeaker}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${speakerOn ? 'bg-brand text-white' : 'bg-white/10 text-white'} backdrop-blur`}
            aria-label={speakerOn ? 'Speaker on — tap for earpiece' : 'Earpiece — tap for speaker'}
            aria-pressed={speakerOn}
          >
            {speakerOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
          </button>
          <button
            type="button"
            onClick={flipKind}
            disabled={waitingForPeer}
            className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${isVideo ? 'bg-brand text-white' : 'bg-white/10 text-white'} backdrop-blur disabled:opacity-50`}
            aria-label={isVideo ? 'Switch to voice' : 'Switch to video'}
          >
            {isVideo ? <Phone size={22} /> : <Video size={22} />}
          </button>
          {isVideo && (
            <>
              <button
                type="button"
                onClick={toggleCamera}
                className={`inline-flex h-14 w-14 items-center justify-center rounded-full ${cameraOff ? 'bg-amber-100 text-amber-700' : 'bg-white/10 text-white'} backdrop-blur`}
                aria-label={cameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {cameraOff ? <VideoOff size={22} /> : <Video size={22} />}
              </button>
              <button
                type="button"
                onClick={switchCamera}
                className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur"
                aria-label="Flip camera"
              >
                <SwitchCamera size={22} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={hangup}
            className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white shadow-lg"
            aria-label="Hang up"
          >
            <PhoneOff size={26} />
          </button>
        </div>
        <div className="mt-3 text-center text-[11px] text-white/45">
          Numbers stay private — routed through Canact
        </div>
      </div>
    </div>,
    document.body,
  );
}
