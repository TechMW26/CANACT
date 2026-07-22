'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { CameraCapture } from '@/components/CameraCapture';
import { Textarea } from '@/components/Input';
import { VideoPreview } from '@/components/VideoPreview';
import { ArrowLeft, Camera, Check, Expand, Loader2, MapPin, Plus, X } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { createWhaPost } from '@/lib/services/wha';
import { notifyNearbyFriends } from '@/lib/services/sendPush';
import { dataUrlToBlob, prepareMedia, uploadMedia, type PreparedMedia } from '@/lib/uploadMedia';
import { toast } from '@/components/Toaster';

const MAX_PHOTOS = 10;

type DraftShot = {
  id: string;
  src: string;
  isVideo: boolean;
  poster?: string;
  prepared?: PreparedMedia;
};

export default function PostCreatePage() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const router = useRouter();
  const [step, setStep] = useState<'capture' | 'edit' | 'compose'>('capture');
  const [shots, setShots] = useState<DraftShot[]>([]);
  const [selectedShot, setSelectedShot] = useState(0);
  const [fit, setFit] = useState<'cover' | 'contain'>('cover');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const shotsRef = useRef<DraftShot[]>([]);

  useEffect(() => { shotsRef.current = shots; }, [shots]);
  useEffect(() => () => { shotsRef.current.forEach(revokeDraftShot); }, []);

  const processCapturedUrls = async (urls: string[]) => {
    if (!urls.length) return;
    setPreparing(true);
    try {
      const drafts: DraftShot[] = [];
      for (const source of urls) {
        const blob = await dataUrlToBlob(source);
        const prepared = await prepareMedia(blob, { maxWidth: 1080, maxHeight: 1350, quality: 0.82 });
        const previewUrl = URL.createObjectURL(prepared.blob);
        drafts.push({
          id: `${Date.now()}-${drafts.length}-${Math.random().toString(36).slice(2)}`,
          src: previewUrl,
          isVideo: prepared.mime.startsWith('video/'),
          poster: prepared.posterDataUrl,
          prepared,
        });
      }
      setShots((current) => {
        const combined = [...current, ...drafts];
        const next = combined.slice(0, MAX_PHOTOS);
        combined.slice(MAX_PHOTOS).forEach(revokeDraftShot);
        return next;
      });
      setSelectedShot(0);
      setStep('edit');
    } catch (error: any) {
      toast(error?.message ?? 'Could not process media', 'error');
    } finally {
      setPreparing(false);
    }
  };

  if (!user || !profile) return null;

  if (step === 'capture') {
    return (
      <CameraCapture
        defaultFacing="environment"
        multiple
        maxPhotos={MAX_PHOTOS}
        onCancel={() => router.replace('/create')}
        onCapture={(urls) => {
          void processCapturedUrls(urls);
        }}
      />
    );
  }

  if (step === 'edit' && typeof document !== 'undefined') {
    const active = shots[Math.min(selectedShot, Math.max(0, shots.length - 1))];
    return createPortal(
      <div className="fixed inset-0 z-[2147482000] flex min-h-[100dvh] flex-col bg-[#0b0c0b] text-white">
        <header className="flex items-center justify-between border-b border-white/10 px-3 pb-3 pt-[max(14px,env(safe-area-inset-top))]">
          <button type="button" aria-label="Back to camera" onClick={() => setStep('capture')} className="inline-flex h-11 w-11 items-center justify-center rounded-full active:bg-white/10">
            <ArrowLeft size={24} />
          </button>
          <div className="text-[17px] font-extrabold">New post</div>
          <button type="button" disabled={!shots.length || preparing} onClick={() => setStep('compose')} className="min-w-11 text-right text-sm font-extrabold text-[#79d5b2] disabled:opacity-40">Next</button>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
            {active ? active.isVideo ? (
              <VideoPreview src={active.src} poster={active.poster} className="h-full w-full" fit={fit} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.src} alt="Post preview" className={`h-full w-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`} />
            ) : (
              <div className="inline-flex items-center gap-2 text-sm font-bold text-white/55"><Loader2 size={18} className="animate-spin" /> Preparing media</div>
            )}
            {active && (
              <button type="button" onClick={() => setFit((current) => current === 'cover' ? 'contain' : 'cover')} aria-label={fit === 'cover' ? 'Show full media' : 'Fill frame'} className="absolute bottom-4 left-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-xl ring-1 ring-white/15">
                <Expand size={19} />
              </button>
            )}
          </div>

          <div className="border-t border-white/10 bg-[#101110] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-extrabold">Edit your media</div>
                <div className="text-xs text-white/50">Preview, crop and arrange before sharing</div>
              </div>
              <button type="button" onClick={() => setStep('capture')} className="inline-flex h-10 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-bold ring-1 ring-white/10"><Plus size={15} /> Add</button>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
              {shots.map((shot, index) => (
                <button
                  key={shot.id}
                  type="button"
                  aria-pressed={selectedShot === index}
                  onClick={() => setSelectedShot(index)}
                  className={`relative h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-white/5 transition-opacity ${selectedShot === index ? 'opacity-100' : 'opacity-60'}`}
                >
                  {shot.isVideo ? <VideoPreview src={shot.src} poster={shot.poster} className="h-full w-full" fit="cover" /> : <img src={shot.src} alt="" className="h-full w-full object-cover" />}
                  <span className="absolute bottom-1 right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black/70 px-1 text-[10px] font-bold">{index + 1}</span>
                </button>
              ))}
            </div>
            <button type="button" disabled={!shots.length || preparing} onClick={() => setStep('compose')} className="mt-4 inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-sm font-extrabold text-[#10251f] disabled:opacity-45">
              <Check size={18} /> Next
            </button>
          </div>
        </main>
      </div>,
      document.body,
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-4 grid grid-cols-[44px_1fr_44px] items-center gap-2 [&_svg]:block [&_svg]:shrink-0">
        <button
          type="button"
          aria-label="Back to camera"
          onClick={() => setStep('edit')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="text-center">
          <div className="text-lg font-black tracking-tight text-ink">New post</div>
          <div className="text-xs text-ink/55">Share to Canact</div>
        </div>
        <span />
      </header>

      <div className="rounded-[30px] bg-white/92 p-4 ring-1 ring-[#E4E7E2]">
        <div className="flex items-start gap-3">
          <Avatar src={profile.photoURL ?? null} name={profile.fullName} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold text-ink">{profile.fullName}</div>
            <div className="inline-flex items-center gap-1 text-xs text-ink/55">
              <MapPin size={12} /> {coords ? 'Sharing near your location' : 'Location off'}
            </div>
          </div>
          {shots[0] && (
            <button type="button" onClick={() => setStep('edit')} aria-label="Edit selected media" className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-black">
              {shots[0].isVideo ? <VideoPreview src={shots[0].src} poster={shots[0].poster} className="h-full w-full" fit="cover" /> : <img src={shots[0].src} alt="" className="h-full w-full object-cover" />}
            </button>
          )}
        </div>

        <div className="mt-3 -mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2 no-scrollbar">
          {shots.map((shot, i) => (
            <div key={shot.id} className="relative shrink-0 snap-start">
              {shot.isVideo ? (
                <VideoPreview src={shot.src} poster={shot.poster} className="h-40 w-32 rounded-2xl" fit="cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot.src} alt="" className="h-40 w-32 rounded-2xl object-cover" />
              )}
              <button
                type="button"
                onClick={() => setShots((current) => {
                  const removed = current[i];
                  if (removed) revokeDraftShot(removed);
                  return current.filter((_, idx) => idx !== i);
                })}
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
          {preparing && (
            <div className="flex h-40 w-32 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl bg-brand-light/60 text-xs font-bold text-brand">
              <Loader2 size={18} className="animate-spin" />
              Processing
            </div>
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
          loading={busy || preparing}
          className="mt-4"
          onClick={async () => {
            if (preparing) return;
            if (!text.trim() && shots.length === 0) return toast('Add a photo or caption', 'error');
            setBusy(true);
            try {
              // Upload all shots to Vercel Blob in parallel (Instagram-style:
              // chunked concurrent uploads). Each shot is independently
              // uploaded; failures are surfaced collectively.
              const results = await Promise.all(
                shots.map((shot) =>
                  uploadMedia(shot.prepared ?? shot.src, {
                    kind: 'post',
                    uid: user.uid,
                    maxWidth: 1080,
                    maxHeight: 1350,
                    quality: 0.82,
                  }),
                ),
              );
              const hostedUrls = results.map((r) => r.url);
              const hostedPosters = results.map((r, i) => {
                const isVideo = r.prepared.mime.startsWith('video/');
                return isVideo ? (r.posterUrl ?? '') : r.url;
              });
            const hostedLqips = results.map((r) => r.lqip ?? '');
            const created = await createWhaPost({
              uid: user.uid,
              authorName: profile.fullName,
              authorPhoto: profile.photoURL,
              text: text.trim(),
              mediaUrls: hostedUrls,
              mediaPosters: hostedPosters.some(Boolean) ? hostedPosters : undefined,
              mediaLqips: hostedLqips.some(Boolean) ? hostedLqips : undefined,
                lat: coords?.lat,
                lng: coords?.lng,
              });
              // Tap nearby friends on the shoulder — fire-and-forget so a
              // push outage never blocks the create flow. Server-side
              // filters by friend.lastLocation against friend.notifPrefs.
              if (typeof coords?.lat === 'number' && typeof coords?.lng === 'number') {
                const thumb = hostedPosters.find(Boolean) || hostedUrls[0];
                const preview = (text.trim() || 'shared a new post').slice(0, 120);
                notifyNearbyFriends({
                  lat: coords.lat,
                  lng: coords.lng,
                  title: `${profile.fullName} posted nearby`,
                  body: preview,
                  url: `/post/${created.id}`,
                  image: thumb || undefined,
                  tag: `post:${created.id}`,
                });
              }
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

function revokeDraftShot(shot: DraftShot) {
  if (shot.src.startsWith('blob:')) URL.revokeObjectURL(shot.src);
}
