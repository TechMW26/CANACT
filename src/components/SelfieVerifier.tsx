'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/Button';
import { CheckCircle2, Eye, RefreshCw, ShieldCheck, Sparkles } from '@/components/icons';

// ── Types ──

type LivenessStep = 'loading' | 'position' | 'visibility' | 'blink' | 'hold' | 'done' | 'error';
type FaceApiModule = typeof import('face-api.js');

interface BlinkState {
  count: number;
  earHistory: number[];
  lastBlinkTime: number;
  closed: boolean;
}

// ── Eye Aspect Ratio (EAR) for blink detection ──
// Uses 6 eye landmark points. EAR = (|p2-p6|+|p3-p5|) / (2*|p1-p4|)
// A value below ~0.22 indicates a closed eye.

function eyeAspectRatio(eyePoints: Array<{ x: number; y: number }>): number {
  if (eyePoints.length < 6) return 1;
  const [p1, p2, p3, p4, p5, p6] = eyePoints;
  const vertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const vertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  if (horizontal === 0) return 1;
  return (vertical1 + vertical2) / (2 * horizontal);
}

const EAR_BLINK_THRESHOLD = 0.24;
const BLINKS_REQUIRED = 2;
const BLINK_COOLDOWN_MS = 400;

// ── Steps configuration ──

const STEPS: Array<{ id: LivenessStep; title: string; hint: string }> = [
  { id: 'position', title: 'Center your face', hint: 'Position your face in the oval' },
  { id: 'visibility', title: 'Keep your face visible', hint: 'Keep your eyes and face unobstructed' },
  { id: 'blink', title: 'Blink your eyes', hint: 'Blink naturally to prove it\'s you' },
  { id: 'hold', title: 'Hold still…', hint: 'Smile — capturing your verified selfie' },
];

// ── Component ──

export function SelfieVerifier({
  onCapture,
  onCancel,
}: {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number>(0);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const stabilityRef = useRef({ position: 0, visibility: 0, hold: 0, lost: 0 });
  const blinkRef = useRef<BlinkState>({ count: 0, earHistory: [], lastBlinkTime: 0, closed: false });

  const [step, setStep] = useState<LivenessStep>('loading');
  const [stepIndex, setStepIndex] = useState(0);
  const [blinkCount, setBlinkCount] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [modelAttempt, setModelAttempt] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');

  // ── Load face-api.js models ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const faceapi = await import('face-api.js');
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68TinyNet.loadFromUri('/models'),
        ]);
        if (!cancelled) {
          faceApiRef.current = faceapi;
          setModelReady(true);
          setStep('position');
        }
      } catch {
        if (!cancelled) {
          setCameraError('Could not load face detection models. Check your connection and try again.');
          setStep('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [modelAttempt]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // ── Start camera ──
  const startCamera = useCallback(async () => {
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 800 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      } else {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      setCameraError('');
    } catch {
      setCameraError('Camera access denied. Please allow camera permissions to verify your identity.');
      setStep('error');
    }
  }, [stopCamera]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [startCamera, stopCamera]);

  // ── Capture snapshot ──
  const captureSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 800;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Mirror for front camera
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    setSnapshotUrl(dataUrl);
    setStep('done');
    stopCamera();
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, [stopCamera]);

  // ── Detection loop ──
  useEffect(() => {
    if (!modelReady || step === 'done' || step === 'error' || step === 'loading') return;

    let running = true;
    const faceapi = faceApiRef.current;
    if (!faceapi) return;

    const detect = async () => {
      if (!running) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) {
        animRef.current = requestAnimationFrame(detect);
        return;
      }

      try {
        const result = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.6 }))
          .withFaceLandmarks(true);

        const ctx = canvas.getContext('2d');
        if (!ctx) { animRef.current = requestAnimationFrame(detect); return; }

        // Match canvas to video dimensions
        const dw = video.videoWidth || 640;
        const dh = video.videoHeight || 800;
        if (canvas.width !== dw || canvas.height !== dh) {
          canvas.width = dw;
          canvas.height = dh;
        }
        ctx.clearRect(0, 0, dw, dh);

        if (result && result.detection.score >= 0.7) {
          const box = result.detection.box;
          const landmarks = result.landmarks;

          // Draw oval guide
          ctx.strokeStyle = step === 'hold' ? '#22c55e' : 'rgba(255,255,255,0.7)';
          ctx.lineWidth = 3;
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          const rx = box.width * 0.55;
          const ry = box.height * 0.52;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.stroke();

          // ── Liveness state machine ──
          const ear = computeBlinkEAR(landmarks);
          const faceRatio = (box.width * box.height) / (dw * dh);
          const centered = Math.abs(cx - dw / 2) / dw < 0.16 && Math.abs(cy - dh / 2) / dh < 0.18;
          const wellPositioned = faceRatio > 0.08 && centered;
          stabilityRef.current.lost = 0;

          if (step === 'position') {
            stabilityRef.current.position = wellPositioned ? stabilityRef.current.position + 1 : 0;
            if (stabilityRef.current.position >= 6) {
              stabilityRef.current.visibility = 0;
              setStep('visibility');
              setStepIndex(1);
            }
          } else if (step === 'visibility') {
            // Landmark detection cannot identify eyewear. Require a stable,
            // unobstructed eye/face reading instead of claiming it can.
            const faceVisible = wellPositioned && Number.isFinite(ear) && ear > 0.18 && ear < 0.55;
            stabilityRef.current.visibility = faceVisible ? stabilityRef.current.visibility + 1 : 0;
            if (stabilityRef.current.visibility >= 6) {
              setStep('blink');
              setStepIndex(2);
            }
          } else if (step === 'blink') {
            // Detect blinks via EAR
            const bs = blinkRef.current;
            bs.earHistory.push(ear);
            if (bs.earHistory.length > 8) bs.earHistory.shift();

            const now = Date.now();
            if (ear < EAR_BLINK_THRESHOLD && !bs.closed && now - bs.lastBlinkTime > BLINK_COOLDOWN_MS) {
              bs.closed = true;
            }
            if (ear > EAR_BLINK_THRESHOLD + 0.06 && bs.closed) {
              bs.closed = false;
              bs.count++;
              bs.lastBlinkTime = now;
              setBlinkCount(bs.count);
              if (bs.count >= BLINKS_REQUIRED) {
                stabilityRef.current.hold = 0;
                setStep('hold');
                setStepIndex(3);
              }
            }
          } else if (step === 'hold') {
            stabilityRef.current.hold = wellPositioned && ear > 0.18
              ? stabilityRef.current.hold + 1
              : 0;
            if (stabilityRef.current.hold >= 8) captureSnapshot();
          }
        } else {
          // No face or low confidence — draw dashed oval
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          const cx = dw / 2;
          const cy = dh / 2;
          ctx.beginPath();
          ctx.ellipse(cx, cy, dw * 0.22, dh * 0.2, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);

          stabilityRef.current.position = 0;
          stabilityRef.current.visibility = 0;
          stabilityRef.current.hold = 0;
          stabilityRef.current.lost += 1;
          if (stabilityRef.current.lost === 10 && step !== 'position') {
            blinkRef.current = { count: 0, earHistory: [], lastBlinkTime: 0, closed: false };
            setBlinkCount(0);
            setStepIndex(0);
            setStep('position');
          }
        }
      } catch {
        // Detection error — retry next frame
      }

      if (running) animRef.current = requestAnimationFrame(detect);
    };

    detect();
    return () => { running = false; };
  }, [captureSnapshot, modelReady, step]);

  const handleConfirm = () => {
    if (snapshotUrl) onCapture(snapshotUrl);
  };

  const handleRetry = () => {
    setSnapshotUrl('');
    setStep('position');
    setStepIndex(0);
    setBlinkCount(0);
    stabilityRef.current = { position: 0, visibility: 0, hold: 0, lost: 0 };
    blinkRef.current = { count: 0, earHistory: [], lastBlinkTime: 0, closed: false };
    if (!modelReady) {
      setStep('loading');
      setModelAttempt((attempt) => attempt + 1);
    } else {
      setStep('position');
      startCamera();
    }
  };

  // ── EAR computation from landmarks ──
  function computeBlinkEAR(landmarks: any): number {
    try {
      const leftEye = landmarks.getLeftEye?.() || [];
      const rightEye = landmarks.getRightEye?.() || [];
      const leftEAR = leftEye.length >= 6 ? eyeAspectRatio(leftEye) : 1;
      const rightEAR = rightEye.length >= 6 ? eyeAspectRatio(rightEye) : 1;
      return (leftEAR + rightEAR) / 2;
    } catch {
      return 1;
    }
  }

  // ── Render ──

  if (step === 'error') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6">
        <div className="w-full max-w-sm rounded-[32px] bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <ShieldCheck size={28} className="text-red-500" />
          </div>
          <h2 className="text-xl font-extrabold text-ink">Verification failed</h2>
          <p className="mt-2 text-sm text-ink/60">{cameraError}</p>
          <div className="mt-6 flex gap-3">
            <Button variant="outline" full onClick={onCancel}>Cancel</Button>
            <Button full onClick={handleRetry}>Try again</Button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6">
        <div className="w-full max-w-sm rounded-[32px] bg-white p-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 size={28} className="text-emerald-600" />
          </div>
          <h2 className="text-xl font-extrabold text-ink">Verified!</h2>
          <p className="mt-1 text-sm text-ink/60">Your selfie passed all checks.</p>
          {snapshotUrl && (
            <div className="mx-auto mt-4 h-48 w-40 overflow-hidden rounded-2xl border-2 border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.2)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={snapshotUrl} alt="Verified selfie" className="h-full w-full object-cover" />
            </div>
          )}
          <div className="mt-6 flex gap-3">
            <Button variant="outline" onClick={handleRetry}><RefreshCw size={16} className="mr-1" /> Retake</Button>
            <Button full onClick={handleConfirm}>Use this photo</Button>
          </div>
        </div>
      </div>
    );
  }

  const currentStep = STEPS[stepIndex] ?? STEPS[0];

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Camera preview */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
        />

        {/* Step indicator overlay */}
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-6 safe-top">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur"
            aria-label="Cancel verification"
          >
            ✕
          </button>
        </div>

        {/* Bottom instructions */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent p-6 pb-10 safe-bottom">
          {/* Step progress dots */}
          <div className="mb-4 flex justify-center gap-2">
            {STEPS.map((s, i) => (
              <div
                key={s.id}
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  i < stepIndex ? 'w-8 bg-emerald-400' : i === stepIndex ? 'w-8 bg-white' : 'w-1.5 bg-white/30'
                }`}
              />
            ))}
          </div>

          <h2 className="text-center text-2xl font-extrabold text-white">{currentStep.title}</h2>
          <p className="mt-1 text-center text-sm text-white/60">{currentStep.hint}</p>

          {step === 'blink' && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <Eye size={16} className="text-white/50" />
              <span className="text-sm font-bold text-white/70">
                {blinkCount}/{BLINKS_REQUIRED} blinks detected
              </span>
            </div>
          )}

          {step === 'loading' && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-white/50">
              <Sparkles size={14} className="animate-pulse" />
              Loading face detection…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
