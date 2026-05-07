'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Aperture, Film, ImageIcon, Loader2, SwitchCamera, X, Zap } from './icons';

type Mode = 'photo' | 'video';
type Facing = 'user' | 'environment';

type ZoomState = {
  supported: boolean;
  min: number;
  max: number;
  step: number;
  value: number;
};

type ImageCaptureLike = {
  takePhoto?: (settings?: Record<string, unknown>) => Promise<Blob>;
  getPhotoCapabilities?: () => Promise<Record<string, any>>;
};

type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

const PHOTO_QUALITY = 0.96;
const FALLBACK_ZOOM: ZoomState = { supported: false, min: 1, max: 1, step: 0.1, value: 1 };
const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=h264,aac',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function CameraCapture({
  multiple = false,
  maxPhotos = 1,
  allowVideo = true,
  maxVideoSec = 60,
  onCancel,
  onCapture,
  defaultFacing = 'environment',
}: {
  defaultFacing?: Facing;
  multiple?: boolean;
  maxPhotos?: number;
  allowVideo?: boolean;
  maxVideoSec?: number;
  onCancel: () => void;
  /** Returns data URLs. Video items will be `data:video/...` so consumers can detect type. */
  onCapture: (dataUrls: string[]) => void;
}) {
  const photoFileRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const nativePhotoRef = useRef<HTMLInputElement | null>(null);
  const nativeVideoRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordStartedAtRef = useRef(0);
  const recordTimerRef = useRef<number | null>(null);
  const stopTimeoutRef = useRef<number | null>(null);
  const discardRecordingRef = useRef(false);

  const [mode, setMode] = useState<Mode>('photo');
  const [facing, setFacing] = useState<Facing>(defaultFacing);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [shots, setShots] = useState<string[]>([]);
  const [streamReady, setStreamReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(FALLBACK_ZOOM);

  const mediaRecorderSupported = typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined';

  const stopRecording = useCallback((discard = false) => {
    const recorder = recorderRef.current;
    if (discard) discardRecordingRef.current = true;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const stopCurrentStream = useCallback(() => {
    if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
    if (stopTimeoutRef.current) window.clearTimeout(stopTimeoutRef.current);
    recordTimerRef.current = null;
    stopTimeoutRef.current = null;
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const next = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput');
      setDevices(next);
    } catch {
      setDevices([]);
    }
  }, []);

  const activateStream = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera unavailable');
      return;
    }
    setStreamReady(false);
    setCameraError(null);
    stopCurrentStream();

    try {
      const stream = await getBestCameraStream({ mode, facing, deviceId: selectedDeviceId });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        try { await video.play(); } catch {}
      }

      const track = stream.getVideoTracks()[0];
      await applyAutoCameraProcessing(track);
      const settings = track.getSettings?.() ?? {};
      setActiveDeviceId(typeof settings.deviceId === 'string' ? settings.deviceId : selectedDeviceId);
      setZoom(readZoomState(track));
      setStreamReady(true);
      await refreshDevices();
    } catch (error: any) {
      setStreamReady(false);
      setZoom(FALLBACK_ZOOM);
      setCameraError(error?.name === 'NotAllowedError' ? 'Camera permission needed' : 'Camera unavailable');
    }
  }, [facing, mode, refreshDevices, selectedDeviceId, stopCurrentStream]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await activateStream();
      if (cancelled) stopCurrentStream();
    })();
    return () => {
      cancelled = true;
      stopRecording(true);
      stopCurrentStream();
    };
  }, [activateStream, stopCurrentStream, stopRecording]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    video.srcObject = streamRef.current;
  }, [streamReady]);

  const lensDevices = useMemo(() => devicesForFacing(devices, facing), [devices, facing]);
  const showLensControls = lensDevices.length > 1 && lensDevices.some((device) => device.label);
  const canRecordVideo = mode === 'video' && mediaRecorderSupported && streamReady;

  const appendPhotoUrls = (urls: string[]) => {
    if (!multiple || maxPhotos === 1) {
      onCapture(urls.slice(0, 1));
      return;
    }
    const next = [...shots, ...urls].slice(0, maxPhotos);
    setShots(next);
    if (next.length >= maxPhotos) onCapture(next);
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files).slice(0, mode === 'video' ? 1 : (multiple ? Math.max(maxPhotos - shots.length, 1) : 1));
    const urls: string[] = [];
    for (const file of list) urls.push(await blobToDataUrl(file));
    if (mode === 'video') {
      onCapture(urls);
      return;
    }
    appendPhotoUrls(urls);
  };

  const capturePhoto = async () => {
    if (busy) return;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !videoRef.current) {
      nativePhotoRef.current?.click();
      return;
    }
    setBusy(true);
    try {
      const rawBlob = await takeBestStill(track, videoRef.current);
      const enhancedBlob = await autoEnhanceImageBlob(rawBlob);
      appendPhotoUrls([await blobToDataUrl(enhancedBlob)]);
    } catch {
      nativePhotoRef.current?.click();
    } finally {
      setBusy(false);
    }
  };

  const startRecording = async () => {
    if (busy || recording) return;
    if (!canRecordVideo || !streamRef.current) {
      nativeVideoRef.current?.click();
      return;
    }
    setBusy(true);
    chunksRef.current = [];
    discardRecordingRef.current = false;
    try {
      const recorder = new MediaRecorder(streamRef.current, getRecorderOptions(streamRef.current));
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        const discard = discardRecordingRef.current;
        discardRecordingRef.current = false;
        if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
        if (stopTimeoutRef.current) window.clearTimeout(stopTimeoutRef.current);
        recordTimerRef.current = null;
        stopTimeoutRef.current = null;
        setRecording(false);
        setRecordingSec(0);
        setBusy(false);
        const type = recorder.mimeType || chunksRef.current[0]?.type || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        if (!discard && blob.size) onCapture([await blobToDataUrl(blob)]);
      };
      recordStartedAtRef.current = Date.now();
      recorder.start(500);
      setRecording(true);
      setRecordingSec(0);
      setBusy(false);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSec(Math.min(maxVideoSec, Math.floor((Date.now() - recordStartedAtRef.current) / 1000)));
      }, 250);
      stopTimeoutRef.current = window.setTimeout(() => stopRecording(), maxVideoSec * 1000);
    } catch {
      setBusy(false);
      nativeVideoRef.current?.click();
    }
  };

  const removeShot = (idx: number) => {
    setShots((curr) => curr.filter((_, index) => index !== idx));
  };

  const switchFacing = () => {
    if (recording) return;
    setSelectedDeviceId(null);
    setFacing((current) => (current === 'environment' ? 'user' : 'environment'));
  };

  const applyZoomValue = async (value: number) => {
    const nextValue = Number(value.toFixed(2));
    setZoom((current) => ({ ...current, value: nextValue }));
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ zoom: nextValue }] as any });
    } catch {}
  };

  const handlePrimaryAction = () => {
    if (mode === 'photo') {
      capturePhoto();
      return;
    }
    if (recording) stopRecording();
    else startRecording();
  };

  const close = () => {
    stopRecording(true);
    stopCurrentStream();
    onCancel();
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black text-white">
      <input
        ref={nativePhotoRef}
        type="file"
        accept="image/*"
        capture={facing}
        className="hidden"
        onChange={(event) => onPickFiles(event.target.files)}
      />
      <input
        ref={photoFileRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(event) => onPickFiles(event.target.files)}
      />
      <input
        ref={nativeVideoRef}
        type="file"
        accept="video/*"
        capture={facing}
        className="hidden"
        onChange={(event) => onPickFiles(event.target.files)}
      />
      <input
        ref={videoFileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(event) => onPickFiles(event.target.files)}
      />

      <video
        ref={videoRef}
        className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
        autoPlay
        muted
        playsInline
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/5 to-black/78" />

      <div className="relative flex h-full w-full flex-col">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 safe-top">
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-xl ring-1 ring-white/15"
          >
            <X size={20} />
          </button>
          <div className="inline-flex items-center gap-2 rounded-full bg-black/35 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide backdrop-blur-xl ring-1 ring-white/15">
            {streamReady ? <Zap size={12} /> : <Loader2 size={12} className="animate-spin" />}
            {mode === 'photo' ? (multiple ? `${shots.length}/${maxPhotos}` : 'Photo') : recording ? formatDuration(recordingSec) : `Video ${maxVideoSec}s`}
          </div>
          <button
            type="button"
            onClick={switchFacing}
            aria-label="Switch camera"
            disabled={recording}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-xl ring-1 ring-white/15 disabled:opacity-40"
          >
            <SwitchCamera size={20} />
          </button>
        </div>

        {allowVideo && (
          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full bg-black/35 p-1 backdrop-blur-xl ring-1 ring-white/15">
              {(['photo', 'video'] as const).map((nextMode) => (
                <button
                  key={nextMode}
                  type="button"
                  disabled={recording}
                  onClick={() => setMode(nextMode)}
                  className={`inline-flex h-8 items-center gap-1 rounded-full px-3 text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-45 ${
                    mode === nextMode ? 'bg-white text-ink' : 'text-white/85'
                  }`}
                >
                  {nextMode === 'photo' ? <Aperture size={12} /> : <Film size={12} />} {nextMode}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-1 flex-col justify-end px-4 pb-6 safe-bottom">
          {cameraError && (
            <div className="mx-auto mb-4 max-w-sm rounded-2xl bg-black/55 px-4 py-3 text-center text-sm font-semibold text-white backdrop-blur-xl ring-1 ring-white/15">
              {cameraError}
            </div>
          )}

          {showLensControls && (
            <div className="mb-3 flex justify-center">
              <div className="flex max-w-full gap-2 overflow-x-auto rounded-full bg-black/30 p-1 backdrop-blur-xl ring-1 ring-white/15 no-scrollbar">
                {lensDevices.map((device, index) => {
                  const active = (activeDeviceId && device.deviceId === activeDeviceId) || (!activeDeviceId && index === 0);
                  return (
                    <button
                      key={device.deviceId || index}
                      type="button"
                      disabled={recording}
                      onClick={() => setSelectedDeviceId(device.deviceId)}
                      className={`h-8 shrink-0 rounded-full px-3 text-xs font-bold transition disabled:opacity-45 ${active ? 'bg-white text-ink' : 'text-white/85'}`}
                    >
                      {lensLabel(device, index)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {zoom.supported && (
            <div className="mx-auto mb-4 flex w-full max-w-xs items-center gap-3 rounded-full bg-black/30 px-3 py-2 backdrop-blur-xl ring-1 ring-white/15">
              <span className="w-9 text-center text-xs font-bold">{zoom.value.toFixed(zoom.value < 10 ? 1 : 0)}x</span>
              <input
                aria-label="Camera zoom"
                type="range"
                min={zoom.min}
                max={zoom.max}
                step={zoom.step}
                value={zoom.value}
                disabled={recording}
                onChange={(event) => applyZoomValue(Number(event.target.value))}
                className="min-w-0 flex-1 accent-white disabled:opacity-45"
              />
            </div>
          )}

          <div className="grid grid-cols-[56px_1fr_56px] items-center gap-5">
            <button
              type="button"
              onClick={() => (mode === 'photo' ? photoFileRef.current?.click() : videoFileRef.current?.click())}
              aria-label="Choose from gallery"
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur-xl ring-1 ring-white/18"
            >
              <ImageIcon size={22} />
            </button>

            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={busy || (!streamReady && !cameraError)}
              aria-label={mode === 'video' && recording ? 'Stop recording' : mode === 'video' ? 'Record video' : 'Take photo'}
              className={`mx-auto inline-flex h-[76px] w-[76px] items-center justify-center rounded-full border-[5px] border-white transition active:scale-95 disabled:opacity-45 ${
                mode === 'video' && recording ? 'bg-rose-500' : 'bg-white/18'
              }`}
            >
              {busy ? <Loader2 size={24} className="animate-spin" /> : mode === 'video' && recording ? <span className="h-7 w-7 rounded-md bg-white" /> : <span className="h-14 w-14 rounded-full bg-white" />}
            </button>

            <button
              type="button"
              onClick={() => (mode === 'photo' ? nativePhotoRef.current?.click() : nativeVideoRef.current?.click())}
              aria-label="Open system camera"
              className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur-xl ring-1 ring-white/18"
            >
              {mode === 'photo' ? <Aperture size={22} /> : <Film size={22} />}
            </button>
          </div>

          {mode === 'photo' && multiple && shots.length > 0 && (
            <div className="mt-5">
              <div className="flex items-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                {shots.map((src, index) => (
                  <div key={index} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeShot(index)}
                      aria-label="Remove"
                      className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onCapture(shots)}
                className="mt-2 w-full rounded-2xl bg-white px-5 py-3.5 text-base font-bold text-ink"
              >
                Done · {shots.length}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

async function getBestCameraStream({ mode, facing, deviceId }: { mode: Mode; facing: Facing; deviceId: string | null }) {
  const audio = mode === 'video'
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    : false;
  const attempts: MediaStreamConstraints[] = [];
  const baseHigh = {
    width: { ideal: 3840 },
    height: { ideal: 2160 },
    frameRate: { ideal: 60, max: 60 },
    resizeMode: 'none',
  } as any;
  const baseBalanced = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60, max: 60 },
    resizeMode: 'none',
  } as any;
  const baseSafe = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  } as any;

  if (deviceId) {
    attempts.push({ audio, video: { ...baseHigh, deviceId: { exact: deviceId } } as any });
    attempts.push({ audio, video: { ...baseBalanced, deviceId: { exact: deviceId } } as any });
  } else {
    attempts.push({ audio, video: { ...baseHigh, facingMode: { exact: facing } } as any });
    attempts.push({ audio, video: { ...baseHigh, facingMode: { ideal: facing } } as any });
    attempts.push({ audio, video: { ...baseBalanced, facingMode: { ideal: facing } } as any });
  }
  attempts.push({ audio, video: { ...baseSafe, facingMode: { ideal: facing } } as any });
  attempts.push({ audio, video: { facingMode: { ideal: facing } } as any });
  attempts.push({ audio, video: true });

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function applyAutoCameraProcessing(track: MediaStreamTrack | undefined) {
  if (!track?.applyConstraints || !track.getCapabilities) return;
  const capabilities = track.getCapabilities() as any;
  const advanced: Record<string, unknown> = {};
  for (const key of ['focusMode', 'exposureMode', 'whiteBalanceMode'] as const) {
    const options = capabilities[key];
    if (Array.isArray(options)) {
      if (options.includes('continuous')) advanced[key] = 'continuous';
      else if (options.includes('auto')) advanced[key] = 'auto';
    }
  }
  if (Array.isArray(capabilities.resizeMode) && capabilities.resizeMode.includes('none')) advanced.resizeMode = 'none';
  if (!Object.keys(advanced).length) return;
  try { await track.applyConstraints({ advanced: [advanced] as any }); } catch {}
}

function readZoomState(track: MediaStreamTrack | undefined): ZoomState {
  if (!track?.getCapabilities) return FALLBACK_ZOOM;
  const capabilities = track.getCapabilities() as any;
  const settings = track.getSettings?.() as any;
  const zoom = capabilities.zoom;
  if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number' || zoom.max <= zoom.min) return FALLBACK_ZOOM;
  return {
    supported: true,
    min: zoom.min,
    max: Math.min(zoom.max, 10),
    step: typeof zoom.step === 'number' && zoom.step > 0 ? zoom.step : 0.1,
    value: typeof settings.zoom === 'number' ? settings.zoom : Math.max(1, zoom.min),
  };
}

async function takeBestStill(track: MediaStreamTrack, video: HTMLVideoElement): Promise<Blob> {
  const ImageCaptureCtor = (window as Window & { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (ImageCaptureCtor) {
    try {
      const capture = new ImageCaptureCtor(track);
      if (capture.takePhoto) {
        const settings = await bestPhotoSettings(capture);
        const blob = await capture.takePhoto(settings);
        if (blob?.size) return blob;
      }
    } catch {}
  }
  return captureVideoFrame(video);
}

async function bestPhotoSettings(capture: ImageCaptureLike): Promise<Record<string, unknown>> {
  if (!capture.getPhotoCapabilities) return {};
  try {
    const capabilities = await capture.getPhotoCapabilities();
    const settings: Record<string, unknown> = {};
    const width = capabilities.imageWidth;
    const height = capabilities.imageHeight;
    if (width && typeof width.max === 'number') settings.imageWidth = width.max;
    if (height && typeof height.max === 'number') settings.imageHeight = height.max;
    if (Array.isArray(capabilities.fillLightMode) && capabilities.fillLightMode.includes('auto')) settings.fillLightMode = 'auto';
    if (capabilities.redEyeReduction === true || capabilities.redEyeReduction === 'controllable') settings.redEyeReduction = true;
    return settings;
  } catch {
    return {};
  }
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth || 1920;
  const height = video.videoHeight || 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not capture photo');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, 'image/jpeg', PHOTO_QUALITY);
  if (!blob) throw new Error('Could not capture photo');
  return blob;
}

async function autoEnhanceImageBlob(blob: Blob): Promise<Blob> {
  if (typeof document === 'undefined') return blob;
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' } as any);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return blob;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = 'brightness(1.015) contrast(1.045) saturate(1.055)';
      ctx.drawImage(bitmap, 0, 0);
      const enhanced = await canvasToBlob(canvas, 'image/jpeg', PHOTO_QUALITY);
      return enhanced && enhanced.size ? enhanced : blob;
    } finally {
      bitmap.close?.();
    }
  } catch {
    return blob;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), type, quality));
}

function getRecorderOptions(stream: MediaStream): MediaRecorderOptions {
  const mimeType = VIDEO_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const settings = stream.getVideoTracks()[0]?.getSettings?.() ?? {};
  const width = Number(settings.width || 1920);
  const height = Number(settings.height || 1080);
  const fps = Number(settings.frameRate || 30);
  const pixels = width * height;
  const videoBitsPerSecond = pixels >= 3840 * 2160
    ? (fps > 45 ? 24_000_000 : 16_000_000)
    : pixels >= 1920 * 1080
      ? (fps > 45 ? 12_000_000 : 8_000_000)
      : 5_000_000;
  return {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond,
    audioBitsPerSecond: 160_000,
  };
}

function devicesForFacing(devices: MediaDeviceInfo[], facing: Facing) {
  const labelled = devices.filter((device) => device.label);
  if (!labelled.length) return devices;
  const matcher = facing === 'environment'
    ? /(back|rear|environment|wide|tele|ultra|macro|0\.5|1x|2x|3x)/i
    : /(front|user|face|selfie)/i;
  const matches = labelled.filter((device) => matcher.test(device.label));
  return matches.length ? matches : labelled;
}

function lensLabel(device: MediaDeviceInfo, index: number) {
  const label = device.label || `Lens ${index + 1}`;
  if (/ultra|0\.5/i.test(label)) return '0.5x';
  if (/tele|3x/i.test(label)) return '3x';
  if (/2x/i.test(label)) return '2x';
  if (/front|selfie|user/i.test(label)) return 'Selfie';
  if (/wide|back|rear|environment/i.test(label)) return '1x';
  return `Lens ${index + 1}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function isVideoUrl(url: string | undefined | null) {
  if (!url) return false;
  if (url.startsWith('data:video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}
