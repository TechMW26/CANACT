'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceLandmarker as FaceLandmarkerInstance, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { Button } from '@/components/Button';
import { CheckCircle2, Eye, RefreshCw, ShieldCheck, Sparkles } from '@/components/icons';

type LivenessStep = 'loading' | 'position' | 'visibility' | 'blink' | 'hold' | 'done' | 'error';
type VisionModule = typeof import('@mediapipe/tasks-vision');
type GuidanceTone = 'neutral' | 'warning' | 'success';

interface BlinkState {
  count: number;
  closedFrames: number;
  openFrames: number;
  armed: boolean;
  lastBlinkTime: number;
}

const BLINKS_REQUIRED = 2;
const BLINK_COOLDOWN_MS = 380;
const DETECTION_INTERVAL_MS = 65;
const MIN_FACE_RATIO = 0.075;
const MAX_FACE_RATIO = 0.48;

const STEPS: Array<{ id: LivenessStep; title: string; hint: string }> = [
  { id: 'position', title: 'Center your face', hint: 'Keep your whole face inside the guide' },
  { id: 'visibility', title: 'Look at the camera', hint: 'Use even light and keep your face unobstructed' },
  { id: 'blink', title: 'Blink naturally', hint: 'Blink slowly twice while looking at the camera' },
  { id: 'hold', title: 'Hold still', hint: 'Perfect — completing your live verification' },
];

const INITIAL_BLINK: BlinkState = {
  count: 0,
  closedFrames: 0,
  openFrames: 0,
  armed: false,
  lastBlinkTime: 0,
};

function eyeAspectRatio(landmarks: NormalizedLandmark[], indices: number[]) {
  const points = indices.map((index) => landmarks[index]);
  if (points.some((point) => !point)) return Number.NaN;
  const [p1, p2, p3, p4, p5, p6] = points;
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  if (horizontal <= 0) return Number.NaN;
  return (
    Math.hypot(p2.x - p6.x, p2.y - p6.y) +
    Math.hypot(p3.x - p5.x, p3.y - p5.y)
  ) / (2 * horizontal);
}

function fallbackBlinkScore(landmarks: NormalizedLandmark[]) {
  const left = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]);
  const right = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Number.NaN;
  const ear = (left + right) / 2;
  return Math.max(0, Math.min(1, (0.3 - ear) / 0.18));
}

function blendshapeScore(
  categories: Array<{ categoryName: string; score: number }> | undefined,
  name: string,
) {
  return categories?.find((category) => category.categoryName === name)?.score;
}

function faceGeometry(landmarks: NormalizedLandmark[]) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    centerX: minX + width / 2,
    centerY: minY + height / 2,
    ratio: width * height,
  };
}

export function SelfieVerifier({
  onCapture,
  onCancel,
}: {
  onCapture: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const meshRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarkerInstance | null>(null);
  const visionRef = useRef<VisionModule | null>(null);
  const loopRef = useRef<number>(0);
  const runningRef = useRef(false);
  const stepRef = useRef<LivenessStep>('loading');
  const stabilityRef = useRef({ position: 0, visibility: 0, hold: 0, missing: 0 });
  const blinkRef = useRef<BlinkState>({ ...INITIAL_BLINK });
  const lastDetectionRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  const meshProgressRef = useRef(0);
  const captureSnapshotRef = useRef<() => boolean>(() => false);

  const [step, setStepState] = useState<LivenessStep>('loading');
  const [stepIndex, setStepIndex] = useState(0);
  const [blinkCount, setBlinkCount] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [modelAttempt, setModelAttempt] = useState(0);
  const [cameraError, setCameraError] = useState('');
  const [snapshotUrl, setSnapshotUrl] = useState('');
  const [guidance, setGuidance] = useState('Preparing secure face detection…');
  const [guidanceTone, setGuidanceTone] = useState<GuidanceTone>('neutral');

  const setStep = useCallback((next: LivenessStep) => {
    stepRef.current = next;
    setStepState(next);
  }, []);

  const updateGuidance = useCallback((message: string, tone: GuidanceTone = 'neutral') => {
    setGuidance((current) => current === message ? current : message);
    setGuidanceTone(tone);
  }, []);

  const clearMesh = useCallback(() => {
    const canvas = meshRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    clearMesh();
    setCameraReady(false);
  }, [clearMesh]);

  const startCamera = useCallback(async () => {
    try {
      runningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCameraReady(false);
      updateGuidance('Starting the front camera…');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 720 },
          height: { ideal: 960 },
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
  }, [setStep, updateGuidance]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        updateGuidance('Loading on-device face model…');
        const vision = await import('@mediapipe/tasks-vision');
        const files = await vision.FilesetResolver.forVisionTasks('/models/mediapipe/wasm');
        let landmarker: FaceLandmarkerInstance;
        try {
          landmarker = await vision.FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: '/models/mediapipe/face_landmarker.task', delegate: 'GPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.55,
            minFacePresenceConfidence: 0.55,
            minTrackingConfidence: 0.5,
            outputFaceBlendshapes: true,
          });
        } catch {
          landmarker = await vision.FaceLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetPath: '/models/mediapipe/face_landmarker.task', delegate: 'CPU' },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.45,
            outputFaceBlendshapes: true,
          });
        }
        if (cancelled) {
          landmarker.close();
          return;
        }
        visionRef.current = vision;
        landmarkerRef.current = landmarker;
        setModelReady(true);
      } catch (error) {
        console.warn('[face-verification] model initialization failed', error);
        if (!cancelled) {
          setCameraError('Face detection could not start. Check your connection and try again.');
          setStep('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      visionRef.current = null;
    };
  }, [modelAttempt, setStep, updateGuidance]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  useEffect(() => {
    if (!modelReady || !cameraReady || stepRef.current !== 'loading') return;
    setStep('position');
    setStepIndex(0);
    updateGuidance('Move your face into the guide');
  }, [cameraReady, modelReady, setStep, updateGuidance]);

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
  }, [setStep, stopCamera, updateGuidance]);

  useEffect(() => { captureSnapshotRef.current = captureSnapshot; }, [captureSnapshot]);

  const drawMesh = useCallback((landmarks: NormalizedLandmark[], time: number) => {
    const canvas = meshRef.current;
    const video = videoRef.current;
    const vision = visionRef.current;
    if (!canvas || !video || !vision) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    const drawing = new vision.DrawingUtils(context);
    meshProgressRef.current = Math.min(1, meshProgressRef.current + 0.055);
    const connections = vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION;
    const visibleConnections = connections.slice(0, Math.max(1, Math.floor(connections.length * meshProgressRef.current)));
    const pulse = 0.18 + ((Math.sin(time / 260) + 1) / 2) * 0.18;
    drawing.drawConnectors(landmarks, visibleConnections, { color: `rgba(97,235,191,${pulse})`, lineWidth: 0.75 });
    drawing.drawConnectors(landmarks, vision.FaceLandmarker.FACE_LANDMARKS_CONTOURS, { color: 'rgba(190,255,232,.82)', lineWidth: 1.25 });
    drawing.drawLandmarks(landmarks.filter((_, index) => index % 4 === 0), { color: 'rgba(224,255,244,.72)', radius: 0.9 });
    context.restore();
  }, []);

  useEffect(() => {
    if (!modelReady || !cameraReady || !landmarkerRef.current) return;
    runningRef.current = true;

    const detect = (time: number) => {
      if (!runningRef.current) return;
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker || video.readyState < 2 || time - lastDetectionRef.current < DETECTION_INTERVAL_MS) {
        loopRef.current = requestAnimationFrame(detect);
        return;
      }
      lastDetectionRef.current = time;
      if (video.currentTime === lastVideoTimeRef.current) {
        loopRef.current = requestAnimationFrame(detect);
        return;
      }
      lastVideoTimeRef.current = video.currentTime;

      try {
        const result = landmarker.detectForVideo(video, performance.now());
        const landmarks = result.faceLandmarks[0];
        if (!landmarks) {
          clearMesh();
          meshProgressRef.current = 0;
          stabilityRef.current.position = 0;
          stabilityRef.current.visibility = 0;
          stabilityRef.current.hold = 0;
          stabilityRef.current.missing += 1;
          updateGuidance(stabilityRef.current.missing > 24 ? 'Face the light and keep the camera steady' : 'Move your face into the guide', 'warning');
        } else {
          drawMesh(landmarks, time);
          const geometry = faceGeometry(landmarks);
          const centered = Math.abs(geometry.centerX - 0.5) < 0.15 && Math.abs(geometry.centerY - 0.47) < 0.18;
          const sized = geometry.ratio >= MIN_FACE_RATIO && geometry.ratio <= MAX_FACE_RATIO;
          const wellPositioned = centered && sized;
          const categories = result.faceBlendshapes[0]?.categories;
          const leftBlink = blendshapeScore(categories, 'eyeBlinkLeft');
          const rightBlink = blendshapeScore(categories, 'eyeBlinkRight');
          const blinkScore = typeof leftBlink === 'number' && typeof rightBlink === 'number'
            ? (leftBlink + rightBlink) / 2
            : fallbackBlinkScore(landmarks);
          stabilityRef.current.missing = 0;

          if (geometry.ratio < MIN_FACE_RATIO) updateGuidance('Come a little closer', 'warning');
          else if (geometry.ratio > MAX_FACE_RATIO) updateGuidance('Move slightly farther away', 'warning');
          else if (!centered) updateGuidance('Center your face in the guide', 'warning');

          const currentStep = stepRef.current;
          if (currentStep === 'position') {
            stabilityRef.current.position = wellPositioned ? stabilityRef.current.position + 1 : 0;
            if (wellPositioned) updateGuidance('Face detected — keep looking here', 'success');
            if (stabilityRef.current.position >= 7) {
              stabilityRef.current.visibility = 0;
              setStep('visibility');
              setStepIndex(1);
              updateGuidance('Great — keep both eyes visible', 'success');
            }
          } else if (currentStep === 'visibility') {
            const eyesVisible = wellPositioned && Number.isFinite(blinkScore) && blinkScore < 0.55;
            stabilityRef.current.visibility = eyesVisible ? stabilityRef.current.visibility + 1 : 0;
            if (!eyesVisible && wellPositioned) updateGuidance('Keep both eyes visible', 'warning');
            if (stabilityRef.current.visibility >= 8) {
              blinkRef.current.armed = true;
              setStep('blink');
              setStepIndex(2);
              updateGuidance('Blink slowly twice', 'neutral');
            }
          } else if (currentStep === 'blink') {
            if (!wellPositioned) {
              updateGuidance('Stay centered while blinking', 'warning');
            } else if (Number.isFinite(blinkScore)) {
              const blink = blinkRef.current;
              if (blinkScore > 0.48 && blink.armed) {
                blink.closedFrames += 1;
                blink.openFrames = 0;
              } else if (blinkScore < 0.24 && blink.closedFrames >= 2) {
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
                    updateGuidance('Liveness confirmed — hold still', 'success');
                  } else {
                    updateGuidance('One more natural blink', 'success');
                  }
                }
              } else if (blinkScore < 0.24) {
                blink.armed = true;
                if (blink.closedFrames < 2) blink.closedFrames = 0;
              }
            }
          } else if (currentStep === 'hold') {
            stabilityRef.current.hold = wellPositioned && Number.isFinite(blinkScore) && blinkScore < 0.55
              ? stabilityRef.current.hold + 1
              : 0;
            if (stabilityRef.current.hold >= 10) captureSnapshotRef.current();
          }
        }
      } catch (error) {
        console.warn('[face-verification] frame detection paused', error);
        updateGuidance('Keep still while detection resumes', 'warning');
      }

      if (runningRef.current) loopRef.current = requestAnimationFrame(detect);
    };

    loopRef.current = requestAnimationFrame(detect);
    return () => {
      runningRef.current = false;
      if (loopRef.current) cancelAnimationFrame(loopRef.current);
    };
  }, [cameraReady, clearMesh, drawMesh, modelReady, setStep, updateGuidance]);

  const resetScan = useCallback(() => {
    setSnapshotUrl('');
    setBlinkCount(0);
    setStepIndex(0);
    stabilityRef.current = { position: 0, visibility: 0, hold: 0, missing: 0 };
    blinkRef.current = { ...INITIAL_BLINK };
    lastDetectionRef.current = 0;
    lastVideoTimeRef.current = -1;
    meshProgressRef.current = 0;
    clearMesh();
    if (!modelReady) {
      setStep('loading');
      setModelAttempt((attempt) => attempt + 1);
    } else {
      setStep('position');
      updateGuidance('Move your face into the guide');
      void startCamera();
    }
  }, [clearMesh, modelReady, setStep, startCamera, updateGuidance]);

  if (step === 'error') {
    return (
      <div className="fixed inset-0 z-[2147483400] flex items-center justify-center bg-black/90 p-6">
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
      <div className="fixed inset-0 z-[2147483400] flex items-center justify-center bg-black/90 p-6">
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
    <div className="fixed inset-0 z-[2147483400] flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ transform: 'scaleX(-1)' }} />
        <canvas ref={meshRef} className="pointer-events-none absolute inset-0 h-full w-full object-cover" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0,transparent_34%,rgba(0,0,0,.20)_52%,rgba(0,0,0,.62)_100%)]" />

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-6 safe-top">
          <button type="button" onClick={onCancel} className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur" aria-label="Cancel verification">✕</button>
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-20">
          <div className={`relative aspect-square w-[min(76vw,330px)] rounded-full border-[3px] transition-colors duration-300 ${ringClass}`} aria-hidden="true">
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70" />
          </div>
        </div>

        <div className="absolute left-1/2 top-[calc(50%+140px)] w-[min(88vw,410px)] -translate-x-1/2 text-center">
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
