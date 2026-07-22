'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Aperture, Check, Film, ImageIcon, Loader2, X } from './icons';

type Mode = 'photo' | 'video';
type Facing = 'user' | 'environment';

type CameraCaptureProps = {
  defaultFacing?: Facing;
  multiple?: boolean;
  maxPhotos?: number;
  allowVideo?: boolean;
  allowPhoto?: boolean;
  initialMode?: Mode;
  maxVideoSec?: number;
  onCancel: () => void;
  /** Returns data URLs so existing editors and upload preparation stay compatible. */
  onCapture: (dataUrls: string[]) => void;
};

/**
 * Native media capture entry point shared by every Canact composer.
 *
 * Recording is deliberately delegated to the phone camera. This avoids the
 * codec, audio and backgrounding failures caused by MediaRecorder in mobile
 * WebViews while preserving the app-owned edit and publish stages.
 */
export function CameraCapture({
  multiple = false,
  maxPhotos = 1,
  allowVideo = true,
  allowPhoto = true,
  initialMode = 'photo',
  maxVideoSec = 60,
  onCancel,
  onCapture,
  defaultFacing = 'environment',
}: CameraCaptureProps) {
  const photoCameraRef = useRef<HTMLInputElement | null>(null);
  const videoCameraRef = useRef<HTMLInputElement | null>(null);
  const libraryRef = useRef<HTMLInputElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<Mode>(() => initialMode === 'video' && allowVideo ? 'video' : 'photo');
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAttemptedRef = useRef(false);

  // Start live camera preview — must be triggered by a user gesture on mobile
  const startPreview = async () => {
    if (previewReady || previewLoading || previewAttemptedRef.current) return;
    previewAttemptedRef.current = true;
    setPreviewLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: defaultFacing, width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play();
        setPreviewReady(true);
      } else {
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch {
      setPreviewReady(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const photoEnabled = allowPhoto;
  const videoEnabled = allowVideo;
  const showModeToggle = photoEnabled && videoEnabled;

  const resetInput = (input: HTMLInputElement) => {
    input.value = '';
  };

  const readFiles = async (files: FileList | null, sourceMode: Mode, input: HTMLInputElement) => {
    if (!files?.length || busy) {
      resetInput(input);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const capacity = sourceMode === 'photo' && multiple ? Math.max(1, maxPhotos - shots.length) : 1;
      const selected = Array.from(files).slice(0, capacity);
      if (sourceMode === 'video') {
        const file = selected[0];
        if (!file || (file.type && !file.type.startsWith('video/'))) throw new Error('Choose a video to continue.');
        const duration = await getVideoDuration(file);
        if (Number.isFinite(duration) && duration > maxVideoSec + 0.5) {
          throw new Error(`Keep this video under ${maxVideoSec} seconds.`);
        }
        onCapture([await fileToDataUrl(file)]);
        return;
      }

      const images = selected.filter((file) => !file.type || file.type.startsWith('image/'));
      if (!images.length) throw new Error('Choose a photo to continue.');
      const urls = await Promise.all(images.map(fileToDataUrl));
      if (!multiple || maxPhotos === 1) {
        onCapture(urls.slice(0, 1));
        return;
      }
      setShots((current) => [...current, ...urls].slice(0, maxPhotos));
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Could not open that media.');
    } finally {
      resetInput(input);
      setBusy(false);
    }
  };

  const openCamera = (nextMode = mode) => {
    setError(null);
    if (nextMode === 'video') videoCameraRef.current?.click();
    else photoCameraRef.current?.click();
  };

  const switchMode = (nextMode: Mode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    // The click remains inside the user's gesture, which is required by iOS.
    openCamera(nextMode);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[2147482000] flex min-h-[100dvh] flex-col bg-[#0b0c0b] text-white">
      <input
        ref={photoCameraRef}
        type="file"
        accept="image/*"
        capture={defaultFacing}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void readFiles(event.target.files, 'photo', event.currentTarget)}
      />
      <input
        ref={videoCameraRef}
        type="file"
        accept="video/*"
        capture={defaultFacing}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void readFiles(event.target.files, 'video', event.currentTarget)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept={mode === 'video' ? 'video/*' : 'image/*'}
        multiple={mode === 'photo' && multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void readFiles(event.target.files, mode, event.currentTarget)}
      />

      <header className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))]">
        <button type="button" onClick={onCancel} aria-label="Close media capture" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white active:bg-white/10">
          <X size={24} />
        </button>
        <div className="text-[17px] font-extrabold tracking-tight">Create</div>
        <button
          type="button"
          disabled={!shots.length || busy}
          onClick={() => onCapture(shots)}
          className="min-w-11 text-right text-sm font-extrabold text-[#79d5b2] disabled:invisible"
        >
          Next
        </button>
      </header>

      <main className="relative flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 items-center justify-center px-5 py-6">
          {shots.length ? (
            <div className="w-full max-w-md">
              <div className="grid max-h-[62dvh] grid-cols-2 gap-2 overflow-y-auto rounded-[28px] bg-white/5 p-2">
                {shots.map((src, index) => (
                  <div key={`${index}-${src.slice(-12)}`} className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Selected photo ${index + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => setShots((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur"
                    >
                      <X size={15} />
                    </button>
                    <span className="absolute bottom-2 left-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-black/65 px-2 text-xs font-bold backdrop-blur">
                      {index + 1}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-center text-xs font-semibold text-white/55">{shots.length} of {maxPhotos} selected</div>
            </div>
          ) : (
            <div className="w-full max-w-sm text-center">
              <button
                type="button"
                onClick={() => { if (previewReady) { openCamera(); } else if (!previewAttemptedRef.current) { startPreview(); } else { openCamera(); } }}
                disabled={busy}
                className="group relative mx-auto flex aspect-[4/5] w-full max-w-[310px] flex-col items-center justify-center overflow-hidden rounded-[36px] ring-1 ring-white/14 transition active:scale-[.985]"
              >
                {/* Fallback gradient behind the video */}
                <div className="absolute inset-0 bg-gradient-to-br from-[#173f34] via-[#0d201b] to-black" />
                {/* Live camera preview — always mounted, hidden until ready */}
                <video
                  ref={previewVideoRef}
                  playsInline
                  muted
                  className={`absolute inset-0 h-full w-full object-cover ${previewReady ? '' : 'hidden'}`}
                />
                {/* Overlay UI on top of preview */}
                <span className="relative z-10 inline-flex h-20 w-20 items-center justify-center rounded-full bg-black/30 text-white shadow-[0_20px_60px_rgb(89_211_168_/_25%)] backdrop-blur-md ring-1 ring-white/20">
                  {busy || previewLoading ? <Loader2 size={30} className="animate-spin" /> : mode === 'video' ? <Film size={31} /> : <Aperture size={31} />}
                </span>
                <span className="relative z-10 mt-6 text-xl font-black drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
                  {previewLoading ? 'Starting camera…' : previewReady ? 'Tap to open camera' : 'Tap to enable camera'}
                </span>
                <span className="relative z-10 mt-2 max-w-[230px] text-sm font-medium leading-5 text-white/70 drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
                  {mode === 'video' ? `Record with your phone camera · up to ${maxVideoSec}s` : 'Take a photo with your phone camera'}
                </span>
              </button>
            </div>
          )}
        </div>

        {error && <div role="alert" className="mx-5 mb-3 rounded-2xl bg-[#391f20] px-4 py-3 text-center text-sm font-bold text-[#ffb7b7]">{error}</div>}

        <div className="border-t border-white/10 bg-black/70 px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
          {showModeToggle && (
            <div className="mb-4 flex justify-center gap-8" role="tablist" aria-label="Media type">
              {(['photo', 'video'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={mode === item}
                  disabled={busy}
                  onClick={() => switchMode(item)}
                  className={`relative px-2 py-2 text-xs font-black uppercase tracking-[.16em] transition ${mode === item ? 'text-white' : 'text-white/45'}`}
                >
                  {item}
                  {mode === item && <span className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-white" />}
                </button>
              ))}
            </div>
          )}

          <div className="mx-auto grid w-full max-w-md grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => libraryRef.current?.click()}
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-extrabold ring-1 ring-white/12 active:bg-white/15 disabled:opacity-50"
            >
              <ImageIcon size={19} /> Library
            </button>
            <button
              type="button"
              onClick={() => shots.length ? onCapture(shots) : openCamera()}
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-extrabold text-[#10251f] active:scale-[.985] disabled:opacity-50"
            >
              {shots.length ? <Check size={19} /> : mode === 'video' ? <Film size={19} /> : <Aperture size={19} />}
              {shots.length ? 'Next' : mode === 'video' ? 'Record' : 'Camera'}
            </button>
          </div>
        </div>
      </main>
    </div>,
    document.body,
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read media.'));
    reader.readAsDataURL(file);
  });
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const timeout = window.setTimeout(() => finish(Number.NaN), 4000);
    const finish = (duration: number) => {
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      video.remove();
      resolve(duration);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(Number.NaN);
    video.src = url;
  });
}

export function isVideoUrl(url: string | undefined | null) {
  if (!url) return false;
  if (url.startsWith('data:video/')) return true;
  if (url.startsWith('blob:')) return false;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}
