'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Textarea } from '@/components/Input';
import { MusicPicker } from '@/components/MusicPicker';
import { ArrowLeft, Film, ImageIcon, Music, SwitchCamera, Trash2, X } from '@/components/icons';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { createReel } from '@/lib/services/reels';
import type { MusicTrack } from '@/lib/musicLibrary';

const MAX_DURATION = 60;

export default function ReelCreatePage() {
  const { user, profile } = useAuth();
  const router = useRouter();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [step, setStep] = useState<'capture' | 'compose'>('capture');
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [music, setMusic] = useState<MusicTrack | null>(null);
  const [showMusic, setShowMusic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (step !== 'capture') return;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: true,
        });
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      } catch (e: any) {
        toast(e?.message ?? 'Camera blocked', 'error');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [step, facing]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_DURATION) { stopRecording(); return MAX_DURATION; }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mr = new MediaRecorder(streamRef.current, { mimeType: pickMime() });
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'video/webm' });
      const reader = new FileReader();
      reader.onload = () => {
        setVideoUrl(reader.result as string);
        setStep('compose');
      };
      reader.readAsDataURL(blob);
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

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) return toast('Please pick a video', 'error');
    const reader = new FileReader();
    reader.onload = () => {
      setVideoUrl(reader.result as string);
      setStep('compose');
    };
    reader.readAsDataURL(file);
  };

  if (!user || !profile) return null;
  if (!mounted) return null;

  if (step === 'capture') {
    const ui = (
      <div className="fixed inset-0 z-[100] bg-black text-white">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`absolute inset-0 h-full w-full object-cover ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
        />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/55 to-transparent p-4">
          <button
            onClick={() => router.replace('/create')}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur"
          >
            <X size={18} />
          </button>
          <div className="rounded-full bg-black/45 px-3 py-1 text-xs font-bold backdrop-blur">
            {recording ? `● ${formatTime(seconds)}` : `Up to ${MAX_DURATION}s`}
          </div>
          <button
            onClick={() => setShowMusic(true)}
            className="inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs font-bold backdrop-blur"
          >
            <Music size={14} /> {music ? 'Music ✓' : 'Music'}
          </button>
        </div>

        {recording && (
          <div className="absolute left-0 right-0 top-14 px-4">
            <div className="h-1 overflow-hidden rounded-full bg-white/25">
              <div className="h-full bg-brand transition-all" style={{ width: `${(seconds / MAX_DURATION) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/55 to-transparent px-6 pb-10 pt-8">
          <button
            onClick={() => fileRef.current?.click()}
            aria-label="Upload"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur"
          >
            <ImageIcon size={20} />
          </button>
          <button
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? 'Stop' : 'Record'}
            className={`flex h-20 w-20 items-center justify-center rounded-full ring-4 ring-white/85 ${recording ? 'bg-brand' : 'bg-white'}`}
          >
            <span className={`block transition-all ${recording ? 'h-6 w-6 rounded-md bg-white' : 'h-14 w-14 rounded-full bg-brand'}`} />
          </button>
          <button
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            aria-label="Flip camera"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur"
          >
            <SwitchCamera size={20} />
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />

        <MusicPicker open={showMusic} onClose={() => setShowMusic(false)} onPick={setMusic} />
      </div>
    );
    return createPortal(ui, document.body);
  }

  return (
    <div className="mx-auto max-w-2xl pb-10">
      <header className="mb-4 flex items-center gap-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => { setVideoUrl(null); setStep('capture'); }}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line shadow-sm"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-xl font-black tracking-tight text-ink">Share a Reel</div>
          <div className="text-xs text-ink/55">Vertical short clip</div>
        </div>
      </header>

      <div className="rounded-[30px] bg-white/92 p-4 ring-1 ring-[#F1D7DC] shadow-[0_18px_36px_-26px_rgba(10,10,10,0.18)]">
        <div className="flex items-center gap-3">
          <Avatar src={profile.photoURL ?? null} name={profile.fullName} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-ink">{profile.fullName}</div>
            <div className="text-xs text-ink/55">Public reel</div>
          </div>
        </div>

        {videoUrl && (
          <div className="relative mx-auto mt-4 aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-[28px] bg-black">
            <video
              ref={previewRef}
              src={videoUrl}
              loop
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <button
          onClick={() => setShowMusic(true)}
          className="mt-3 inline-flex w-full items-center gap-2 rounded-full border border-line bg-candy px-4 py-2 text-sm font-bold text-ink"
        >
          <Music size={16} className="text-brand" />
          <span className="truncate">{music ? `${music.title} · ${music.artist}` : 'Add music'}</span>
          {music && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMusic(null); }}
              className="ml-auto rounded-full p-1 hover:bg-brand-light"
              aria-label="Remove music"
            >
              <Trash2 size={14} />
            </button>
          )}
        </button>

        <div className="mt-3">
          <Textarea
            label="Caption"
            placeholder="Say something about your reel…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
          />
        </div>

        <Button
          full
          size="lg"
          loading={busy}
          className="mt-4"
          onClick={async () => {
            if (!videoUrl) return toast('Record or upload a video first', 'error');
            setBusy(true);
            try {
              await createReel({
                uid: user.uid,
                authorName: profile.fullName,
                authorPhoto: profile.photoURL,
                videoUrl,
                caption: caption.trim() || undefined,
                music: music ? { id: music.id, title: music.title, artist: music.artist, url: music.url } : undefined,
              });
              router.replace('/reels');
            } catch (e: any) {
              toast(e?.message ?? 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Share Reel
        </Button>
      </div>

      <div className="mt-3 text-center text-xs text-ink/45">
        <Link href="/create" className="underline-offset-2 hover:underline">Pick a different flow</Link>
        <span className="mx-2">·</span>
        <span className="inline-flex items-center gap-1"><Film size={12} /> Reel draft</span>
      </div>

      <MusicPicker open={showMusic} onClose={() => setShowMusic(false)} onPick={setMusic} />
    </div>
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
