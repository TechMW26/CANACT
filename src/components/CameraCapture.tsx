'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Aperture, Film, ImageIcon, X } from './icons';

type Mode = 'photo' | 'video';

export function CameraCapture({
  multiple = false,
  maxPhotos = 1,
  allowVideo = true,
  maxVideoSec = 60,
  onCancel,
  onCapture,
  /** Kept for API compatibility — not used now that capture is delegated to native camera. */
  defaultFacing: _defaultFacing,
}: {
  defaultFacing?: 'user' | 'environment';
  multiple?: boolean;
  maxPhotos?: number;
  allowVideo?: boolean;
  maxVideoSec?: number;
  onCancel: () => void;
  /** Returns data URLs. Video items will be `data:video/...` so consumers can detect type. */
  onCapture: (dataUrls: string[]) => void;
}) {
  const photoCameraRef = useRef<HTMLInputElement | null>(null);
  const photoFileRef = useRef<HTMLInputElement | null>(null);
  const videoCameraRef = useRef<HTMLInputElement | null>(null);
  const videoFileRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<Mode>('photo');
  const [shots, setShots] = useState<string[]>([]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files).slice(0, mode === 'video' ? 1 : (multiple ? Math.max(maxPhotos - shots.length, 1) : 1));
    const urls: string[] = [];
    for (const f of list) {
      const url = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      urls.push(url);
    }
    if (mode === 'video') {
      onCapture(urls);
      return;
    }
    if (!multiple || maxPhotos === 1) {
      onCapture(urls);
      return;
    }
    const next = [...shots, ...urls].slice(0, maxPhotos);
    setShots(next);
    if (next.length >= maxPhotos) onCapture(next);
  };

  const removeShot = (idx: number) => {
    setShots((curr) => curr.filter((_, i) => i !== idx));
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-gradient-to-b from-[#1a0d10] via-black to-[#1a0d10] text-white">
      {/* Photo: native camera */}
      <input
        ref={photoCameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      {/* Photo: gallery */}
      <input
        ref={photoFileRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      {/* Video: native camera */}
      <input
        ref={videoCameraRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      {/* Video: gallery */}
      <input
        ref={videoFileRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />

      <div className="relative flex h-full w-full flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 px-4 pt-4 safe-top">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur"
          >
            <X size={20} />
          </button>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur">
            {mode === 'photo'
              ? (multiple ? `${shots.length}/${maxPhotos} photos` : 'New photo')
              : `Up to ${maxVideoSec}s`}
          </span>
          <span className="h-10 w-10" />
        </div>

        {/* Mode toggle */}
        {allowVideo && (
          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-1 rounded-full bg-white/10 p-1 backdrop-blur">
              {(['photo', 'video'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider transition ${
                    mode === m ? 'bg-white text-ink' : 'text-white/85'
                  }`}
                >
                  {m === 'photo' ? <Aperture size={12} /> : <Film size={12} />} {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Centered actions */}
        <div className="flex flex-1 flex-col items-center justify-center gap-7 px-6 text-center">
          <div className="space-y-2">
            <div className="mx-auto inline-flex h-20 w-20 items-center justify-center rounded-full bg-brand/20 ring-1 ring-brand/40">
              {mode === 'photo' ? <Aperture size={36} /> : <Film size={36} />}
            </div>
            <h2 className="text-xl font-extrabold">
              {mode === 'photo'
                ? (multiple && maxPhotos > 1 ? `Add up to ${maxPhotos} photos` : 'Add a photo')
                : 'Add a video'}
            </h2>
            <p className="text-sm text-white/65">
              {mode === 'photo'
                ? 'Take a fresh shot or pick one from your gallery.'
                : `Up to ${maxVideoSec}s. We'll let you trim, filter and add music after.`}
            </p>
          </div>

          <div className="flex w-full max-w-sm flex-col gap-3">
            <button
              type="button"
              onClick={() => (mode === 'photo' ? photoCameraRef.current?.click() : videoCameraRef.current?.click())}
              className="flex items-center justify-center gap-3 rounded-2xl bg-brand px-5 py-4 text-base font-bold shadow-[0_18px_36px_-18px_rgba(200,16,46,0.55)] active:scale-[0.98] transition"
            >
              {mode === 'photo' ? <Aperture size={20} /> : <Film size={20} />}
              {mode === 'photo' ? 'Take photo' : 'Record video'}
            </button>
            <button
              type="button"
              onClick={() => (mode === 'photo' ? photoFileRef.current?.click() : videoFileRef.current?.click())}
              className="flex items-center justify-center gap-3 rounded-2xl bg-white/10 px-5 py-4 text-base font-bold backdrop-blur ring-1 ring-white/20 active:scale-[0.98] transition"
            >
              <ImageIcon size={20} /> Choose from gallery
            </button>
          </div>
        </div>

        {/* Multi-photo tray */}
        {mode === 'photo' && multiple && shots.length > 0 && (
          <div className="px-4 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              {shots.map((src, i) => (
                <div key={i} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-white/30">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeShot(i)}
                    aria-label="Remove"
                    className="absolute right-0.5 top-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Done bar for multi */}
        {mode === 'photo' && multiple && shots.length > 0 && (
          <div className="px-4 pb-6 safe-bottom">
            <button
              type="button"
              onClick={() => onCapture(shots)}
              className="w-full rounded-2xl bg-brand px-5 py-3.5 text-base font-bold shadow-[0_18px_36px_-18px_rgba(200,16,46,0.55)]"
            >
              Done · {shots.length}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function isVideoUrl(url: string | undefined | null) {
  if (!url) return false;
  if (url.startsWith('data:video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}

