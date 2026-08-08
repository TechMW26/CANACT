'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Aperture, Check, Film, ImageIcon, Loader2, Plus, X } from './icons';

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
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<Mode>(() => initialMode === 'video' && allowVideo ? 'video' : 'photo');
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoEnabled = allowPhoto;
  const videoEnabled = allowVideo;

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

  const openGallery = () => {
    setError(null);
    galleryRef.current?.click();
  };

  const readGallery = async (files: FileList | null, input: HTMLInputElement) => {
    if (!files?.length || busy) {
      resetInput(input);
      return;
    }
    const selected = Array.from(files);
    const hasVideo = selected.some((file) => file.type.startsWith('video/'));
    const hasPhoto = selected.some((file) => !file.type || file.type.startsWith('image/'));
    if (hasVideo && (hasPhoto || selected.length > 1)) {
      setError('Choose one video, or select photos only.');
      resetInput(input);
      return;
    }
    await readFiles(files, hasVideo ? 'video' : 'photo', input);
  };

  const chooseMode = (nextMode: Mode) => {
    setMode(nextMode);
    // Keep the native picker launch in this gesture. iOS and Android then use
    // the device camera's highest configured capture quality; video processing
    // preserves up to 1080p/60fps when the device supplies it.
    openCamera(nextMode);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-canact-popup="true" className="canact-popup-layer fixed inset-0 flex min-h-[100dvh] flex-col bg-[#0b0c0b] text-white">
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
        ref={galleryRef}
        type="file"
        accept={photoEnabled && videoEnabled ? 'image/*,video/*' : photoEnabled ? 'image/*' : 'video/*'}
        multiple={photoEnabled && multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => void readGallery(event.target.files, event.currentTarget)}
      />
      <header className="flex items-center justify-between border-b border-white/10 px-4 pb-3 pt-[max(14px,env(safe-area-inset-top))]">
        <button type="button" onClick={onCancel} aria-label="Close media capture" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white active:bg-white/10">
          <X size={24} />
        </button>
        <div className="text-center">
          <div className="text-[17px] font-extrabold tracking-tight">Create</div>
          <div className="text-[10px] font-semibold text-white/45">Choose a capture format</div>
        </div>
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
              <div className="grid max-h-[62dvh] grid-cols-2 gap-3 overflow-x-hidden overflow-y-auto rounded-[28px] bg-white/5 p-3 scroll-p-3">
                {shots.map((src, index) => (
                  <div key={`${index}-${src.slice(-12)}`} className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Selected photo ${index + 1}`} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      aria-label={`Remove photo ${index + 1}`}
                      onClick={() => setShots((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink"
                    >
                      <X size={15} />
                    </button>
                    <span className="absolute bottom-2 left-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-white px-2 text-xs font-bold text-ink">
                      {index + 1}
                    </span>
                  </div>
                ))}
                {shots.length < maxPhotos && (
                  <button
                    type="button"
                    onClick={() => openCamera('photo')}
                    disabled={busy}
                    aria-label="Take another photo"
                    className="group flex aspect-[4/5] min-h-0 flex-col items-center justify-center rounded-[22px] border border-dashed border-white/25 bg-white/[0.06] text-white transition active:scale-[.98] active:bg-white/10 disabled:opacity-50"
                  >
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 transition group-active:scale-95">
                      {busy ? <Loader2 size={24} className="animate-spin" /> : <Plus size={28} />}
                    </span>
                    <span className="mt-3 text-sm font-extrabold">Add photo</span>
                    <span className="mt-1 text-[11px] font-semibold text-white/45">
                      {maxPhotos - shots.length} remaining
                    </span>
                  </button>
                )}
              </div>
              <div className="mt-3 text-center text-xs font-semibold text-white/55">{shots.length} of {maxPhotos} selected</div>
            </div>
          ) : (
            <div className="w-full max-w-md text-center">
              <span className="text-[10px] font-black uppercase tracking-[.18em] text-[#79d5b2]">New capture</span>
              <h1 className="mt-2 text-[26px] font-black tracking-[-.04em]">What are you sharing?</h1>
              <p className="mx-auto mt-2 max-w-[290px] text-sm font-medium leading-5 text-white/55">Capture something new or upload it from your gallery.</p>
              <div className={`mx-auto mt-7 grid max-w-sm gap-3 ${photoEnabled && videoEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {photoEnabled ? (
                  <button
                    type="button"
                    onClick={() => chooseMode('photo')}
                    disabled={busy}
                    className="group flex min-h-44 flex-col items-center justify-center rounded-[28px] bg-white px-4 text-[#10251f] shadow-[0_18px_46px_rgba(0,0,0,.22)] transition-transform active:scale-[.97] disabled:opacity-50"
                  >
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-[#e2f2e9] text-[#1f6b55] transition-transform group-active:scale-95">
                      {busy && mode === 'photo' ? <Loader2 size={27} className="animate-spin" /> : <Aperture size={28} />}
                    </span>
                    <strong className="mt-4 text-lg font-black">Photo</strong>
                    <span className="mt-1 text-[11px] font-semibold text-[#10251f]/55">Highest available quality</span>
                  </button>
                ) : null}
                {videoEnabled ? (
                  <button
                    type="button"
                    onClick={() => chooseMode('video')}
                    disabled={busy}
                    className="group flex min-h-44 flex-col items-center justify-center rounded-[28px] bg-[#79d5b2] px-4 text-[#10251f] shadow-[0_18px_46px_rgba(16,92,68,.2)] transition-transform active:scale-[.97] disabled:opacity-50"
                  >
                    <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-[#1f6b55] transition-transform group-active:scale-95">
                      {busy && mode === 'video' ? <Loader2 size={27} className="animate-spin" /> : <Film size={28} />}
                    </span>
                    <strong className="mt-4 text-lg font-black">Video</strong>
                    <span className="mt-1 text-[11px] font-semibold text-[#10251f]/55">Up to 60 FPS · {maxVideoSec}s</span>
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={openGallery}
                disabled={busy}
                className="mx-auto mt-3 inline-flex h-14 w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 text-sm font-extrabold text-white ring-1 ring-white/15 transition active:scale-[.985] active:bg-white/15 disabled:opacity-50"
              >
                <ImageIcon size={20} /> Upload from gallery
              </button>
              <p className="mt-5 text-[11px] font-semibold text-white/35">Availability depends on your camera hardware and device settings.</p>
            </div>
          )}
        </div>

        {error && <div role="alert" className="mx-5 mb-3 rounded-2xl bg-[#391f20] px-4 py-3 text-center text-sm font-bold text-[#ffb7b7]">{error}</div>}

        {shots.length ? (
        <div className="border-t border-white/10 bg-[#101110] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-3 text-white">
          <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => openCamera('photo')}
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/8 px-4 text-sm font-extrabold ring-1 ring-white/12 active:bg-white/15 disabled:opacity-50"
            >
              <Plus size={19} /> Camera
            </button>
            <button
              type="button"
              onClick={openGallery}
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-white/8 px-3 text-sm font-extrabold ring-1 ring-white/12 active:bg-white/15 disabled:opacity-50"
            >
              <ImageIcon size={18} /> Gallery
            </button>
            <button
              type="button"
              onClick={() => onCapture(shots)}
              disabled={busy}
              className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#79d5b2] px-4 text-sm font-extrabold text-[#10251f] active:scale-[.985] disabled:opacity-50"
            >
              <Check size={19} /> Next
            </button>
          </div>
        </div>
        ) : null}
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
