'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Aperture, Film, ImageIcon, SwitchCamera, X } from './icons';

type Facing = 'user' | 'environment';
type Mode = 'photo' | 'video';

export function CameraCapture({
  defaultFacing = 'environment',
  multiple = false,
  maxPhotos = 1,
  allowVideo = true,
  maxVideoSec = 60,
  onCancel,
  onCapture,
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const nativeVideoRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>(defaultFacing);
  const [mode, setMode] = useState<Mode>('photo');
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (mode !== 'photo') {
      // Video mode hands off to native camera; no live stream needed.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setReady(true);
      setError(null);
      return;
    }
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          setError('Camera not supported on this device.');
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1440 }, height: { ideal: 1920 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setReady(true);
      } catch (e: any) {
        setError(e?.message ?? 'Could not access the camera.');
      }
    })();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [facing, mode]);

  useEffect(() => {
    // No timer when using native recorder.
  }, []);

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !ready) return;
    const canvas = document.createElement('canvas');
    const w = video.videoWidth || 1080;
    const h = video.videoHeight || 1440;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (facing === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL('image/jpeg', 0.88);
    const next = multiple ? [...shots, url].slice(0, maxPhotos) : [url];
    setShots(next);
    if (!multiple || next.length >= maxPhotos) {
      onCapture(next);
    }
  };

  const startRecording = () => {
    // Hand off to native camera app for reliable mp4 capture.
    nativeVideoRef.current?.click();
  };

  const stopRecording = () => {
    // No-op: native recorder owns the recording lifecycle.
  };

  const onShutter = () => {
    if (mode === 'photo') return capturePhoto();
    return startRecording();
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const list = Array.from(files).slice(0, mode === 'video' ? 1 : maxPhotos);
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
    onCapture(urls);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black text-white">
      <input
        ref={fileRef}
        type="file"
        accept={mode === 'video' ? 'video/*' : 'image/*'}
        multiple={multiple && mode === 'photo'}
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      <input
        ref={nativeVideoRef}
        type="file"
        accept="video/*"
        capture={facing === 'user' ? 'user' : 'environment'}
        className="hidden"
        onChange={(e) => onPickFiles(e.target.files)}
      />
      <div className="relative h-full w-full">
        {mode === 'photo' ? (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-7 bg-gradient-to-b from-[#1a0d10] via-black to-[#1a0d10] px-6 text-center safe-top safe-bottom">
            <div className="space-y-2">
              <div className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-brand/20 ring-1 ring-brand/40">
                <Film size={36} />
              </div>
              <h2 className="text-xl font-extrabold">Add a video</h2>
              <p className="text-sm text-white/65">Up to {maxVideoSec}s. We&rsquo;ll let you trim, filter and add music after.</p>
            </div>

            <div className="flex w-full max-w-sm flex-col gap-3">
              <button
                type="button"
                onClick={() => nativeVideoRef.current?.click()}
                className="flex items-center justify-center gap-3 rounded-2xl bg-brand px-5 py-4 text-base font-bold shadow-[0_18px_36px_-18px_rgba(200,16,46,0.55)] active:scale-[0.98] transition"
              >
                <Aperture size={20} /> Record with camera
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center justify-center gap-3 rounded-2xl bg-white/10 px-5 py-4 text-base font-bold backdrop-blur ring-1 ring-white/20 active:scale-[0.98] transition"
              >
                <ImageIcon size={20} /> Choose from gallery
              </button>
            </div>
          </div>
        )}
        {!ready && !error && mode === 'photo' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm">
            Starting camera…
          </div>
        )}
        {error && mode === 'photo' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
            <div className="text-sm text-white/85">{error}</div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-white px-4 py-2 text-sm font-bold text-ink"
            >
              Choose from gallery
            </button>
          </div>
        )}

        {mode === 'photo' && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/65 to-transparent" />
          </>
        )}

        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-4 safe-top">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close camera"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur"
          >
            <X size={20} />
          </button>
          {mode === 'photo' ? (
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
              {`${facing === 'user' ? 'Front' : 'Back'}${multiple ? ` · ${shots.length}/${maxPhotos}` : ''}`}
            </span>
          ) : <span />}
          {mode === 'photo' ? (
            <button
              type="button"
              onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
              aria-label="Switch camera"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur disabled:opacity-40"
            >
              <SwitchCamera size={18} />
            </button>
          ) : <span className="h-10 w-10" />}
        </div>

        {allowVideo && (
          <div className="absolute bottom-32 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/45 p-1 backdrop-blur">
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
        )}

        {mode === 'photo' && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-8 pb-8 safe-bottom">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Pick from gallery"
              className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur disabled:opacity-40"
            >
              <ImageIcon size={20} />
            </button>

            <button
              type="button"
              onClick={onShutter}
              disabled={!ready}
              aria-label="Capture photo"
              className="relative inline-flex h-20 w-20 items-center justify-center rounded-full bg-white/15 backdrop-blur disabled:opacity-50"
            >
              <span className="absolute inset-2 rounded-full border-[3px] border-white/85" />
              <span className="absolute inset-[14px] rounded-full bg-white" />
            </button>

            {multiple && shots.length > 0 ? (
              <button
                type="button"
                onClick={() => onCapture(shots)}
                className="rounded-full bg-brand px-4 py-3 text-sm font-bold"
              >
                Done · {shots.length}
              </button>
            ) : (
              <span className="h-12 w-12" />
            )}
          </div>
        )}

        {multiple && mode === 'photo' && shots.length > 0 && (
          <div className="absolute bottom-44 left-0 right-0 z-10 flex gap-2 overflow-x-auto px-6 pb-2 no-scrollbar">
            {shots.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" className="h-16 w-16 rounded-xl border border-white/40 object-cover" />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function pickMime() {
  return '';
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export function isVideoUrl(url: string | undefined | null) {
  if (!url) return false;
  if (url.startsWith('data:video/')) return true;
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}
