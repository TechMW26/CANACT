'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { CameraCapture, isVideoUrl } from '@/components/CameraCapture';
import { Textarea } from '@/components/Input';
import { ArrowLeft, Camera, MapPin, Plus, X } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { createWhaPost } from '@/lib/services/wha';
import { toast } from '@/components/Toaster';

const MAX_PHOTOS = 10;

export default function PostCreatePage() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const router = useRouter();
  const [step, setStep] = useState<'capture' | 'compose'>('capture');
  const [shots, setShots] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user || !profile) return null;

  if (step === 'capture') {
    return (
      <CameraCapture
        defaultFacing="environment"
        multiple
        maxPhotos={MAX_PHOTOS}
        onCancel={() => router.replace('/create')}
        onCapture={(urls) => {
          setShots(urls);
          setStep('compose');
        }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-center gap-2">
        <button
          type="button"
          aria-label="Back to camera"
          onClick={() => setStep('capture')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line shadow-sm"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <div className="text-xl font-black tracking-tight text-ink">Share what's happening</div>
          <div className="text-xs text-ink/55">Auto-disappears in 24 hours</div>
        </div>
      </header>

      <div className="rounded-[30px] bg-white/92 p-4 ring-1 ring-[#F1D7DC] shadow-[0_18px_36px_-26px_rgba(10,10,10,0.18)]">
        <div className="flex items-center gap-3">
          <Avatar src={profile.photoURL ?? null} name={profile.fullName} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-ink">{profile.fullName}</div>
            <div className="inline-flex items-center gap-1 text-xs text-ink/55">
              <MapPin size={12} /> {coords ? 'Sharing near your location' : 'Location off'}
            </div>
          </div>
        </div>

        <div className="mt-3 -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2 no-scrollbar">
          {shots.map((src, i) => (
            <div key={i} className="relative shrink-0 snap-start">
              {isVideoUrl(src) ? (
                <video src={src} className="h-40 w-32 rounded-2xl bg-black object-cover" muted playsInline loop autoPlay />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="h-40 w-32 rounded-2xl object-cover" />
              )}
              <button
                type="button"
                onClick={() => setShots((curr) => curr.filter((_, idx) => idx !== i))}
                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                aria-label="Remove media"
              >
                <X size={12} />
              </button>
              <span className="absolute bottom-1 left-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
                {i + 1}/{shots.length}
              </span>
            </div>
          ))}
          {shots.length < MAX_PHOTOS && (
            <button
              type="button"
              onClick={() => setStep('capture')}
              className="flex h-40 w-32 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[#E8C8CE] text-xs font-semibold text-ink/55 transition hover:bg-brand-light/40 hover:text-brand"
            >
              <Plus size={18} />
              Add more
            </button>
          )}
        </div>

        <div className="mt-4">
          <Textarea
            label="Caption"
            placeholder="Say something about it…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
          />
        </div>

        <Button
          full
          size="lg"
          loading={busy}
          className="mt-4"
          onClick={async () => {
            if (!text.trim() && shots.length === 0) return toast('Add a photo or caption', 'error');
            setBusy(true);
            try {
              await createWhaPost({
                uid: user.uid,
                authorName: profile.fullName,
                authorPhoto: profile.photoURL,
                text: text.trim(),
                mediaUrls: shots,
                lat: coords?.lat,
                lng: coords?.lng,
              });
              router.replace('/feed');
            } catch (e: any) {
              toast(e?.message ?? 'Failed', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Post
        </Button>
      </div>

      <div className="mt-3 text-center text-xs text-ink/45">
        <Link href="/create" className="underline-offset-2 hover:underline">Pick a different flow</Link>
        <span className="mx-2">·</span>
        <span className="inline-flex items-center gap-1"><Camera size={12} /> {shots.length}/{MAX_PHOTOS}</span>
      </div>
    </div>
  );
}
