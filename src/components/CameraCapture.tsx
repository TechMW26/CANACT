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
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [facing, setFacing] = useState<Facing>(defaultFacing);
  const [mode, setMode] = useState<Mode>('photo');
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
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
          audio: mode === 'video',
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
    if (!recording) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= maxVideoSec) {
          recorderRef.current?.stop();
          setRecording(false);
          return maxVideoSec;
        }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [recording, maxVideoSec]);

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
    if (!streamRef.current || !ready) return;
    chunksRef.current = [];
    const mr = new MediaRecorder(streamRef.current, { mimeType: pickMime() });
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'video/webm' });
      const r = new FileReader();
      r.onload = () => onCapture([r.result as string]);
      r.readAsDataURL(blob);
    };
    recorderRef.current = mr;
    mr.start(200);
    setSeconds(0);
    setRecording(true);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    setRecording(false);
  };

  const onShutter = () => {
    if (mode === 'photo') return capturePhoto();
    if (recording) return stopRecording();
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
      <div className="relative h-full w-full">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm">
            Starting camera…
          </div>
        )}
        {error && (
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

        <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/65 to-transparent" />

        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-4 safe-top">
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close camera"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur"
          >
            <X size={20} />
          </button>
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur">
            {recording
              ? `● ${formatTime(seconds)} / ${formatTime(maxVideoSec)}`
              : `${facing === 'user' ? 'Front' : 'Back'}${multiple && mode === 'photo' ? ` · ${shots.length}/${maxPhotos}` : ''}`}
          </span>
          <button
            type="button"
            onClick={() => !recording && setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            aria-label="Switch camera"
            disabled={recording}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 backdrop-blur disabled:opacity-40"
          >
            <SwitchCamera size={18} />
          </button>
        </div>

        {recording && (
          <div className="absolute left-0 right-0 top-16 z-10 px-4">
            <div className="h-1 overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${(seconds / maxVideoSec) * 100}%` }}
              />
            </div>
          </div>
        )}

        {allowVideo && !recording && (
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

        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between px-8 pb-8 safe-bottom">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Pick from gallery"
            disabled={recording}
            className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 backdrop-blur disabled:opacity-40"
          >
            <ImageIcon size={20} />
          </button>

          <button
            type="button"
            onClick={onShutter}
            disabled={!ready}
            aria-label={mode === 'video' ? (recording ? 'Stop recording' : 'Start recording') : 'Capture photo'}
            className="relative inline-flex h-20 w-20 items-center justify-center rounded-full bg-white/15 backdrop-blur disabled:opacity-50"
          >
            <span className={`absolute inset-2 rounded-full border-[3px] ${recording ? 'border-brand' : 'border-white/85'}`} />
            {mode === 'photo' ? (
              <span className="absolute inset-[14px] rounded-full bg-white" />
            ) : recording ? (
              <span className="absolute inset-[22px] rounded-md bg-brand" />
            ) : (
              <span className="absolute inset-[14px] rounded-full bg-brand" />
            )}
          </button>

          {multiple && mode === 'photo' && shots.length > 0 ? (
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
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
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
