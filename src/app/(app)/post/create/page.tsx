'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Textarea } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { createWhaPost } from '@/lib/services/wha';
import { toast } from '@/components/Toaster';

export default function PostCreatePage() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const router = useRouter();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []).slice(0, 3);
    const out: string[] = [];
    for (const f of list) {
      out.push(await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string); r.onerror = rej;
        r.readAsDataURL(f);
      }));
    }
    setFiles(out);
  };

  if (!user || !profile) return null;
  return (
    <Card>
      <h2 className="text-xl font-bold">Share what's happening</h2>
      <p className="text-xs text-muted mt-1">Add up to 3 photos. Posts auto-expire in 24 hours.</p>
      <div className="mt-3 space-y-3">
        <Textarea label="Caption (optional)" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold">Photos</span>
          <input type="file" accept="image/*" multiple capture="environment" onChange={onPick}
            className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:text-white file:px-4 file:py-2 file:font-semibold" />
        </label>
        {files.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {files.map((u, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="" className="w-full h-24 object-cover rounded-xl" />
            ))}
          </div>
        )}
      </div>
      <Button full size="lg" loading={busy} className="mt-4" onClick={async () => {
        if (!text.trim() && files.length === 0) return toast('Add a photo or some text', 'error');
        setBusy(true);
        try {
          await createWhaPost({
            uid: user.uid,
            authorName: profile.fullName,
            authorPhoto: profile.photoURL,
            text: text.trim(),
            mediaUrls: files,
            lat: coords?.lat, lng: coords?.lng,
          });
          router.replace('/feed');
        } catch (e: any) { toast(e?.message ?? 'Failed', 'error'); }
        finally { setBusy(false); }
      }}>Post</Button>
    </Card>
  );
}
