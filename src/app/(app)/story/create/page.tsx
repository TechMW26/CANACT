'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CameraCapture, isVideoUrl } from '@/components/CameraCapture';
import { StoryEditor } from '@/components/StoryEditor';
import { Button } from '@/components/Button';
import { Textarea } from '@/components/Input';
import { ArrowLeft } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { upsertStory } from '@/lib/services/stories';
import { toast } from '@/components/Toaster';

export default function StoryCreatePage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [shot, setShot] = useState<string | null>(null);
  const [videoCaption, setVideoCaption] = useState('');
  const [busy, setBusy] = useState(false);

  if (!user || !profile) return null;

  if (!shot) {
    return (
      <CameraCapture
        defaultFacing="environment"
        allowVideo
        maxVideoSec={30}
        onCancel={() => router.replace('/feed')}
        onCapture={(urls) => urls[0] && setShot(urls[0])}
      />
    );
  }

  if (isVideoUrl(shot)) {
    return (
      <div className="mx-auto max-w-md pb-10">
        <header className="mb-3 flex items-center gap-2">
          <button
            type="button"
            aria-label="Back"
            onClick={() => setShot(null)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line shadow-sm"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="text-xl font-black tracking-tight text-ink">Share story</div>
            <div className="text-xs text-ink/55">Video · disappears in 24h</div>
          </div>
        </header>

        <div className="overflow-hidden rounded-[28px] bg-black shadow-[0_18px_36px_-26px_rgba(10,10,10,0.32)]">
          <video src={shot} className="aspect-[9/16] w-full object-cover" autoPlay loop playsInline controls />
        </div>

        <div className="mt-3">
          <Textarea
            label="Caption (optional)"
            placeholder="Say something\u2026"
            value={videoCaption}
            onChange={(e) => setVideoCaption(e.target.value)}
            maxLength={300}
          />
        </div>

        <Button
          full
          size="lg"
          loading={busy}
          className="mt-3"
          onClick={async () => {
            setBusy(true);
            try {
              await upsertStory({
                uid: user.uid,
                authorName: profile.fullName,
                authorPhoto: profile.photoURL,
                mediaUrl: shot,
                caption: videoCaption.trim() || undefined,
                overlays: [],
              });
              toast('Story shared', 'success');
              router.replace('/feed');
            } catch (e: any) {
              toast(e?.message ?? 'Could not share story', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          Share story
        </Button>
      </div>
    );
  }

  return (
    <StoryEditor
      imageUrl={shot}
      onCancel={() => setShot(null)}
      onShare={async (overlays, caption) => {
        try {
          await upsertStory({
            uid: user.uid,
            authorName: profile.fullName,
            authorPhoto: profile.photoURL,
            mediaUrl: shot,
            caption,
            overlays,
          });
          toast('Story shared', 'success');
          router.replace('/feed');
        } catch (e: any) {
          toast(e?.message ?? 'Could not share story', 'error');
        }
      }}
    />
  );
}
