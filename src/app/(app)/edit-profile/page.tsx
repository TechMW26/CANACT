'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';

export default function EditProfilePage() {
  const { profile, updateMyProfile } = useAuth();
  const router = useRouter();
  const [photo, setPhoto] = useState(profile?.photoURL ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [country, setCountry] = useState(profile?.country ?? '');
  const [busy, setBusy] = useState(false);
  if (!profile) return null;
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    setPhoto(await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f); }));
  };
  return (
    <Card>
      <div className="flex flex-col items-center gap-2">
        <Avatar src={photo} name={profile.fullName} size={96} />
        <input type="file" accept="image/*" onChange={onPick} className="text-xs file:mr-2 file:rounded-full file:border-0 file:bg-brand-light file:text-brand file:px-3 file:py-1 file:font-semibold" />
      </div>
      <div className="mt-4 space-y-3">
        <Input label="Photo URL (or pick a file above)" value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="https://…" />
        <Textarea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={300} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
      </div>
      <Button full size="lg" loading={busy} className="mt-4" onClick={async () => {
        setBusy(true);
        try { await updateMyProfile({ photoURL: photo, bio, city, country }); router.back(); }
        catch (e: any) { toast(e?.message ?? 'Failed', 'error'); }
        finally { setBusy(false); }
      }}>Save</Button>
    </Card>
  );
}
