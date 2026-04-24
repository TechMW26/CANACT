'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { startRateMe } from '@/lib/services/rateme';
import { toast } from '@/components/Toaster';

const HOURS = [1, 2, 4, 8, 12, 24];

export default function RateMeStartPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [photo, setPhoto] = useState<string | undefined>(profile?.photoURL);
  const [hours, setHours] = useState(4);
  const [busy, setBusy] = useState(false);

  if (!user || !profile) return null;
  return (
    <Card>
      <h2 className="text-xl font-bold">Start a Rate Me</h2>
      <p className="text-xs text-muted mt-1">A new selfie works best. Session ends after the chosen window.</p>
      <label className="block mt-3">
        <span className="mb-1 block text-sm font-semibold">Photo</span>
        <input type="file" accept="image/*" capture="user" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          setPhoto(await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); }));
        }} className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand file:text-white file:px-4 file:py-2 file:font-semibold" />
      </label>
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt="" className="mt-3 w-full max-h-96 object-cover rounded-xl" />
      )}
      <div className="mt-3">
        <Select label="Window" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {HOURS.map((h) => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}
        </Select>
      </div>
      <Button full size="lg" loading={busy} className="mt-4" onClick={async () => {
        if (!photo) return toast('Take a photo to start', 'error');
        setBusy(true);
        try {
          await startRateMe({ uid: user.uid, authorName: profile.fullName, photoURL: photo, hours });
          router.replace('/feed');
        } catch (e: any) { toast(e?.message ?? 'Failed', 'error'); }
        finally { setBusy(false); }
      }}>Go live</Button>
    </Card>
  );
}
