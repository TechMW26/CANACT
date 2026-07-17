'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { CameraCapture, isVideoUrl } from '@/components/CameraCapture';
import { Textarea } from '@/components/Input';
import { MusicPicker } from '@/components/MusicPicker';
import { FilterStrip } from '@/components/FilterStrip';
import {
  ArrowLeft,
  Film,
  Music,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
} from '@/components/icons';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { createReel } from '@/lib/services/reels';
import { uploadMedia } from '@/lib/uploadMedia';
import type { MusicTrack } from '@/lib/musicLibrary';
import { filterCss, MEDIA_FILTERS, type MediaFilterId } from '@/lib/mediaFilters';

const MAX_DURATION = 60;

type Step = 'capture' | 'preview' | 'compose';

export default function ReelCreatePage() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const router = useRouter();

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const composeRef = useRef<HTMLVideoElement | null>(null);

  const [step, setStep] = useState<Step>('capture');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [music, setMusic] = useState<MusicTrack | null>(null);
  const [showMusic, setShowMusic] = useState(false);
  const [filter, setFilter] = useState<MediaFilterId>('none');
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState(false);

  const retake = () => {
    setVideoUrl(null);
    setFilter('none');
    setMuted(false);
    setStep('capture');
  };

  if (!user || !profile) return null;

  // ────────────────── CAPTURE ──────────────────
  if (step === 'capture') {
    return (
      <CameraCapture
        defaultFacing="environment"
        allowPhoto={false}
        allowVideo
        initialMode="video"
        maxVideoSec={MAX_DURATION}
        onCancel={() => router.replace('/create')}
        onCapture={(urls) => {
          const next = urls.find(isVideoUrl) ?? urls[0];
          if (!next || !isVideoUrl(next)) {
            toast('Please record or pick a video', 'error');
            return;
          }
          setVideoUrl(next);
          setStep('preview');
        }}
      />
    );
  }

  // ────────────────── PREVIEW (filters / mute / retake) ──────────────────
  if (step === 'preview' && videoUrl) {
    const togglePlay = () => {
      const v = previewRef.current;
      if (!v) return;
      if (v.paused) v.play().catch(() => undefined);
      else v.pause();
    };
    const cycleFilter = (dir: 1 | -1) => {
      const ids = MEDIA_FILTERS.map((f) => f.id);
      const i = ids.indexOf(filter);
      const next = ids[(i + dir + ids.length) % ids.length];
      setFilter(next);
    };
    let touchX = 0;
    let touchY = 0;
    const onTouchStart = (e: React.TouchEvent) => {
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
    };
    const onTouchEnd = (e: React.TouchEvent) => {
      const dx = e.changedTouches[0].clientX - touchX;
      const dy = e.changedTouches[0].clientY - touchY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        cycleFilter(dx < 0 ? 1 : -1);
      }
    };
    const ui = (
      <div className="fixed inset-0 z-[100] bg-black text-white">
        <video
          ref={previewRef}
          src={videoUrl}
          autoPlay
          loop
          playsInline
          muted={muted}
          onClick={togglePlay}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="absolute inset-0 h-full w-full object-contain"
          style={{ filter: filterCss(filter) }}
        />

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-4 safe-top">
          <button
            onClick={retake}
            aria-label="Retake"
            className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-2 text-xs font-bold backdrop-blur"
          >
            <RotateCcw size={14} /> Retake
          </button>
          <div className="rounded-full bg-black/45 px-3 py-1 text-xs font-bold backdrop-blur">Tap video to pause</div>
          <button
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-black/45 backdrop-blur"
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>

        {/* Bottom controls */}
        <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent px-4 pb-6 pt-6 safe-bottom">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider">
              <Sparkles size={12} /> Filters
            </div>
            <button
              onClick={() => setShowMusic(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold backdrop-blur"
            >
              <Music size={14} /> {music ? 'Music ✓' : 'Add music'}
            </button>
          </div>
          <FilterStrip thumbUrl={videoUrl} isVideo selected={filter} onChange={setFilter} />
          <Button full size="lg" onClick={() => setStep('compose')}>Next</Button>
        </div>

        <MusicPicker open={showMusic} onClose={() => setShowMusic(false)} onPick={setMusic} />
      </div>
    );
    return createPortal(ui, document.body);
  }

  // ────────────────── COMPOSE (caption + share) ──────────────────
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <header className="mb-4 flex items-center gap-2 [&_svg]:block [&_svg]:shrink-0">
        <button
          type="button"
          aria-label="Back"
          onClick={() => setStep('preview')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-xl font-black tracking-tight text-ink">Share a Reel</div>
          <div className="text-xs text-ink/55">Vertical short clip</div>
        </div>
      </header>

      <div className="rounded-[30px] bg-white/92 p-4 ring-1 ring-[#E4E7E2]">
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
              ref={composeRef}
              src={videoUrl}
              loop
              autoPlay
              playsInline
              muted={muted}
              controls
              controlsList="nodownload noremoteplayback"
              className="h-full w-full object-contain"
              style={{ filter: filterCss(filter) }}
            />
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="absolute left-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <button
              type="button"
              onClick={() => setStep('preview')}
              className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur"
            >
              <Sparkles size={11} /> Edit
            </button>
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
              // Process the recorded/picked video on-device, then upload the
              // final blob to Vercel Blob. Only the public URL is stored in RTDB.
            const { url: hostedUrl, posterUrl, lqip } = await uploadMedia(videoUrl, { kind: 'reel', uid: user.uid });
            await createReel({
              uid: user.uid,
              authorName: profile.fullName,
              authorPhoto: profile.photoURL,
              videoUrl: hostedUrl,
              posterUrl: posterUrl,
              lqip,
                caption: caption.trim() || undefined,
                lat: coords?.lat,
                lng: coords?.lng,
                filter: filter === 'none' ? undefined : filter,
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
