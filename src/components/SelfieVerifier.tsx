'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { CheckCircle2, Eye, RefreshCw, ShieldCheck, Sparkles } from '@/components/icons';

type LivenessStep = 'loading' | 'position' | 'visibility' | 'blink' | 'hold' | 'done' | 'error';
type FaceApiModule = typeof import('face-api.js');
type GuidanceTone = 'neutral' | 'warning' | 'success';

interface BlinkState {
  count: number;
  baseline: number;
  samples: number;
  closedFrames: number;
  openFrames: number;
  armed: boolean;
  lastBlinkTime: number;
}

const BLINKS_REQUIRED = 2;
const BLINK_COOLDOWN_MS = 350;
const MIN_FACE_RATIO = 0.035;
const MAX_FACE_RATIO = 0.34;

const STEPS: Array<{ id: LivenessStep; title: string; hint: string }> = [
  { id: 'position', title: 'Center your face', hint: 'Keep your whole face inside the circle' },
  { id: 'visibility', title: 'Look at the camera', hint: 'Use even light and keep your face unobstructed' },
  { id: 'blink', title: 'Blink naturally', hint: 'Blink slowly twice while looking at the camera' },
  { id: 'hold', title: 'Hold still', hint: 'Perfect — capturing your verified selfie' },
];

const INITIAL_BLINK: BlinkState = {
  count: 0,
  baseline: 0.3,
  samples: 0,
  closedFrames: 0,
  openFrames: 0,
  armed: false,
  lastBlinkTime: 0,
};

function eyeAspectRatio(points: Array<{ x: number; y: number }>) {
  if (points.length < 6) return Number.NaN;
  const [p1, p2, p3, p4, p5, p6] = points;
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  if (horizontal <= 0) return Number.NaN;
  return (
    Math.hypot(p2.x - p6.x, p2.y - p6.y) +
    Math.hypot(p3.x - p5.x, p3.y - p5.y)
  ) / (2 * horizontal);
}

function computeBlinkEAR(landmarks: any) {
  try {
    const left = eyeAspectRatio(landmarks.getLeftEye?.() || []);
    const right = eyeAspectRatio(landmarks.getRightEye?.() || []);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NaN;
    return (left + right) / 2;
  } catch {
    return Number.NaN;
  }
}

export function SelfieVerifier({
  onCapture,
  onCancel,
}: {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number>(0);
  const runningRef = useRef(false);
  const faceApiRef = useRef<FaceApiModule | null>(null);
  const stabilityRef = useRef({ position: 0, visibility: 0, hold: 0, missing: 0 });
  const blinkRef = useRef<BlinkState>({ ...INITIAL_BLINK });
  const lastDetectionRef = useRef(0);

  const [step, setStep] = useState<LivenessStep>('loading');
  const [stepIndex, setStepIndex] = useState(0);
  const [blinkCount, setBlinkCount] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [modelAttempt, setModelAttempt] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [guidance, setGuidance] = useState('Preparing secure face detection…');
  const [guidanceTone, setGuidanceTone] = useState<GuidanceTone>('neutral');

  const updateGuidance = useCallback((message: string, tone: GuidanceTone = 'neutral') => {
    setGuidance((current) => current === message ? current : message);
    setGuidanceTone(tone);
  }, []);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCameraReady(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 720 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      if (!video.videoWidth || !video.videoHeight) {
        await new Promise<void>((resolve) => video.addEventListener('loadedmetadata', () => resolve(), { once: true }));
      }
      setCameraError('');
      setCameraReady(true);
    } catch {
      setCameraError('Camera access is unavailable. Allow camera permission, then try again.');
      setStep('error');
    }
  }, []);

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
        }
      } catch {
        if (!cancelled) {
          setCameraError('Face detection could not start. Please try again.');
          setStep('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [modelAttempt]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (!modelReady || !cameraReady || step !== 'loading') return;
    setStep('position');
    setStepIndex(0);
    updateGuidance('Move your face into the circle');
  }, [cameraReady, modelReady, step, updateGuidance]);

  const captureSnapshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
      updateGuidance('Hold still while the camera focuses', 'warning');
      return false;
    }
    const size = Math.min(video.videoWidth, video.videoHeight);
    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 960;
    const context = canvas.getContext('2d');
    if (!context) return false;
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(video, sx, sy, size, size, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    if (dataUrl.length < 1_000) return false;
    setSnapshotUrl(dataUrl);
    setStep('done');
    stopCamera();
    return true;
  }, [stopCamera, updateGuidance]);

  useEffect(() => {
    if (!modelReady || !cameraReady || step === 'done' || step === 'error' || step === 'loading') return;
    const faceapi = faceApiRef.current;
    if (!faceapi) return;
    runningRef.current = true;

    const detect = async (time: number) => {
      if (!runningRef.current) return;
      if (time - lastDetectionRef.current < 90) {
        loopRef.current = requestAnimationFrame(detect);
        return;
      }
      lastDetectionRef.current = time;
      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        loopRef.current = requestAnimationFrame(detect);
        return;
      }

      try {
        const result = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.42 }))
          .withFaceLandmarks(true);

        if (!result || result.detection.score < 0.52) {
          stabilityRef.current.position = 0;
          stabilityRef.current.visibility = 0;
          stabilityRef.current.hold = 0;
          stabilityRef.current.missing += 1;
          updateGuidance(stabilityRef.current.missing > 18 ? 'Use brighter, even light on your face' : 'Move your face into the circle', 'warning');
        } else {
          const { box } = result.detection;
          const width = video.videoWidth;
          const height = video.videoHeight;
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          const faceRatio = (box.width * box.height) / (width * height);
          const horizontallyCentered = Math.abs(centerX - width / 2) / width < 0.2;
          const verticallyCentered = Math.abs(centerY - height / 2) / height < 0.22;
          const centered = horizontallyCentered && verticallyCentered;
          const sized = faceRatio >= MIN_FACE_RATIO && faceRatio <= MAX_FACE_RATIO;
          const wellPositioned = centered && sized;
          const ear = computeBlinkEAR(result.landmarks);
          stabilityRef.current.missing = 0;

          if (faceRatio < MIN_FACE_RATIO) updateGuidance('Come a little closer', 'warning');
          else if (faceRatio > MAX_FACE_RATIO) updateGuidance('Move slightly farther away', 'warning');
          else if (!centered) updateGuidance('Center your face in the circle', 'warning');
          else if (step === 'position') updateGuidance('Great — keep looking at the camera', 'success');

          if (step === 'position') {
            stabilityRef.current.position = wellPositioned ? stabilityRef.current.position + 1 : 0;
            if (stabilityRef.current.position >= 5) {
              stabilityRef.current.visibility = 0;
              setStep('visibility');
              setStepIndex(1);
              updateGuidance('Keep both eyes visible', 'success');
            }
          } else if (step === 'visibility') {
            const visible = wellPositioned && Number.isFinite(ear) && ear > 0.12 && ear < 0.7;
            stabilityRef.current.visibility = visible ? stabilityRef.current.visibility + 1 : 0;
            if (visible) {
              const blink = blinkRef.current;
              blink.baseline = blink.samples === 0 ? ear : blink.baseline * 0.8 + ear * 0.2;
              blink.samples += 1;
            } else if (wellPositioned) {
              updateGuidance('Remove anything covering your eyes', 'warning');
            }
            if (stabilityRef.current.visibility >= 6) {
              setStep('blink');
              setStepIndex(2);
              updateGuidance('Blink slowly twice', 'neutral');
            }
          } else if (step === 'blink') {
            if (!wellPositioned) {
              updateGuidance('Keep your face centered while blinking', 'warning');
            } else if (Number.isFinite(ear)) {
              const blink = blinkRef.current;
              if (!blink.armed && ear > blink.baseline * 0.86) blink.armed = true;
              const closedThreshold = Math.max(0.13, blink.baseline * 0.72);
              const openThreshold = Math.max(closedThreshold + 0.025, blink.baseline * 0.84);
              if (ear < closedThreshold && blink.armed) {
                blink.closedFrames += 1;
                blink.openFrames = 0;
              } else if (ear > openThreshold && blink.closedFrames >= 1) {
                blink.openFrames += 1;
                if (blink.openFrames >= 1 && Date.now() - blink.lastBlinkTime > BLINK_COOLDOWN_MS) {
                  blink.count += 1;
                  blink.lastBlinkTime = Date.now();
                  blink.closedFrames = 0;
                  blink.openFrames = 0;
                  blink.armed = false;
                  setBlinkCount(blink.count);
                  if (blink.count >= BLINKS_REQUIRED) {
                    stabilityRef.current.hold = 0;
                    setStep('hold');
                    setStepIndex(3);
                    updateGuidance('Perfect — hold still', 'success');
                  } else {
                    updateGuidance('One more natural blink', 'success');
                  }
                }
              } else if (ear > openThreshold) {
                blink.closedFrames = 0;
                blink.openFrames = 0;
              }
            }
          } else if (step === 'hold') {
            stabilityRef.current.hold = wellPositioned && Number.isFinite(ear)
              ? stabilityRef.current.hold + 1
              : 0;
            if (stabilityRef.current.hold >= 6) captureSnapshot();
          }
        }
      } catch {
        updateGuidance('Keep still while detection resumes', 'warning');
      }

      if (runningRef.current) loopRef.current = requestAnimationFrame(detect);
    };

    loopRef.current = requestAnimationFrame(detect);
    return () => {
      runningRef.current = false;
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    };
  }, [cameraReady, captureSnapshot, modelReady, step, updateGuidance]);

  const resetScan = useCallback(() => {
    setSnapshotUrl('');
    setBlinkCount(0);
    setStepIndex(0);
    stabilityRef.current = { position: 0, visibility: 0, hold: 0, missing: 0 };
    blinkRef.current = { ...INITIAL_BLINK };
    lastDetectionRef.current = 0;
    if (!modelReady) {
      setStep('loading');
      setModelAttempt((attempt) => attempt + 1);
    } else {
      setStep('position');
      void startCamera();
    }
  }, [modelReady, startCamera]);

  if (step === 'error') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6">
        <div className="w-full max-w-sm rounded-[32px] bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100"><ShieldCheck size={28} className="text-red-500" /></div>
          <h2 className="text-xl font-extrabold text-ink">Verification paused</h2>
          <p className="mt-2 text-sm text-ink/60">{cameraError}</p>
          <div className="mt-6 flex gap-3"><Button variant="outline" full onClick={onCancel}>Cancel</Button><Button full onClick={resetScan}>Try again</Button></div>
        </div>
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 p-6">
        <div className="w-full max-w-sm rounded-[32px] bg-white p-6 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100"><CheckCircle2 size={28} className="text-emerald-600" /></div>
          <h2 className="text-xl font-extrabold text-ink">Liveness verified</h2>
          <p className="mt-1 text-sm text-ink/60">Your live selfie is ready to use.</p>
          <div className="mx-auto mt-4 aspect-square w-48 overflow-hidden rounded-full border-2 border-emerald-400 shadow-[0_0_24px_rgba(52,211,153,0.2)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={snapshotUrl} alt="Verified selfie" className="h-full w-full object-cover" />
          </div>
          <div className="mt-6 flex gap-3"><Button variant="outline" onClick={resetScan}><RefreshCw size={16} className="mr-1" /> Retake</Button><Button full onClick={() => onCapture(snapshotUrl)}>Use this photo</Button></div>
        </div>
      </div>
    );
  }

  const currentStep = STEPS[stepIndex] ?? STEPS[0];
  const ringClass = guidanceTone === 'success'
    ? 'border-emerald-400 shadow-[0_0_36px_rgba(52,211,153,.3)]'
    : guidanceTone === 'warning'
      ? 'border-amber-300'
      : 'border-white/80';

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(0,0,0,.24)_51%,rgba(0,0,0,.62)_100%)]" />

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-6 safe-top">
          <button type="button" onClick={onCancel} className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur" aria-label="Cancel verification">✕</button>
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-20">
          <div className={`relative aspect-square w-[min(72vw,310px)] rounded-full border-[3px] transition-colors duration-300 ${ringClass}`} aria-hidden="true">
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
          </div>
        </div>

        <div className="absolute left-1/2 top-[calc(50%+135px)] w-[min(86vw,390px)] -translate-x-1/2 text-center">
          <div className={`inline-flex max-w-full items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white backdrop-blur-md ${guidanceTone === 'success' ? 'bg-emerald-600/75' : guidanceTone === 'warning' ? 'bg-amber-600/75' : 'bg-black/55'}`} role="status" aria-live="polite">
            <Sparkles size={15} className={step === 'loading' ? 'animate-pulse' : ''} />
            <span>{guidance}</span>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent p-6 pb-10 safe-bottom">
          <div className="mb-4 flex justify-center gap-2">
            {STEPS.map((item, index) => <div key={item.id} className={`h-1.5 rounded-full transition-all duration-500 ${index < stepIndex ? 'w-8 bg-emerald-400' : index === stepIndex ? 'w-8 bg-white' : 'w-1.5 bg-white/30'}`} />)}
          </div>
          <h2 className="text-center text-2xl font-extrabold text-white">{currentStep.title}</h2>
          <p className="mt-1 text-center text-sm text-white/65">{currentStep.hint}</p>
          {step === 'blink' && <div className="mt-3 flex items-center justify-center gap-2"><Eye size={16} className="text-white/60" /><span className="text-sm font-bold text-white/80">{blinkCount}/{BLINKS_REQUIRED} blinks detected</span></div>}
          {step === 'loading' && <div className="mt-4 flex items-center justify-center gap-2 text-sm text-white/60"><Sparkles size={14} className="animate-pulse" />Loading face detection…</div>}
          {step !== 'loading' && <button type="button" onClick={resetScan} className="mx-auto mt-4 block text-xs font-semibold text-white/60 underline underline-offset-4">Restart scan</button>}
        </div>
      </div>
    </div>
  );
}
