'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { CameraCapture, isVideoUrl } from '@/components/CameraCapture';
import { VideoPreview } from '@/components/VideoPreview';
import { ArrowLeft, Clock, Eye, Timer } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { startRateMe } from '@/lib/services/rateme';
import { toast } from '@/components/Toaster';

const HOURS = [1, 2, 4, 8, 12, 24];

export default function RateMeStartPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<'capture' | 'compose'>('capture');
  const [photo, setPhoto] = useState<string | null>(null);
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);

  if (!user || !profile) return null;

  if (step === 'capture') {
    return (
      <CameraCapture
        defaultFacing="user"
        allowVideo
        maxVideoSec={15}
        onCancel={() => router.replace('/create')}
        onCapture={(urls) => {
          if (!urls[0]) return;
          setPhoto(urls[0]);
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
          <div className="text-xl font-black tracking-tight text-ink">Start a Rate Me</div>
          <div className="text-xs text-ink/55">A new selfie works best · auto-ends after the window</div>
        </div>
      </header>

      <div className="overflow-hidden rounded-[30px] bg-white/92 ring-1 ring-[#F1D7DC] shadow-[0_18px_36px_-26px_rgba(10,10,10,0.18)]">
        {photo ? (
          isVideoUrl(photo) ? (
            <VideoPreview src={photo} className="h-80 w-full" fit="contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-80 w-full object-cover" />
          )
        ) : null}

        <div className="p-4">
          <div className="flex items-center gap-3">
            <Avatar src={profile.photoURL ?? null} name={profile.fullName} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-bold text-ink">{profile.fullName}</div>
              <div className="inline-flex items-center gap-1 text-xs text-ink/55">
                <Eye size={12} /> Anyone nearby can react
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStep('capture')}
              className="rounded-full bg-brand-light px-3 py-1.5 text-xs font-bold text-brand"
            >
              Retake
            </button>
          </div>

          <div className="mt-4">
            <div className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-ink">
              <Timer size={14} /> Live for
            </div>
            <div className="flex flex-wrap gap-2">
              {HOURS.map((h) => {
                const active = hours === h;
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHours(h)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-2 text-sm font-semibold border transition ${active ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line hover:border-brand/50'}`}
                  >
                    <Clock size={12} /> {h}h
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            full
            size="lg"
            loading={busy}
            className="mt-5"
            onClick={async () => {
              if (!photo) return toast('Take a selfie to start', 'error');
              setBusy(true);
              try {
                await startRateMe({
                  uid: user.uid,
                  authorName: profile.fullName,
                  photoURL: photo,
                  hours,
                });
                router.replace('/feed');
              } catch (e: any) {
                toast(e?.message ?? 'Failed', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            Go live
          </Button>
        </div>
      </div>

      <div className="mt-3 text-center text-xs text-ink/45">
        <Link href="/create" className="underline-offset-2 hover:underline">Pick a different flow</Link>
      </div>
    </div>
  );
}
