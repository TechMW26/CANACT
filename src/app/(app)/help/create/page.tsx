'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Card } from '@/components/Card';
import { createHelp } from '@/lib/services/help';
import { HelpAudience, HelpChannel, HelpType } from '@/lib/types';
import { toast } from '@/components/Toaster';

const VICINITIES = [15, 50, 250, 1000, 5000, 20000];

export default function HelpCreatePage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const [type, setType] = useState<HelpType>((sp.get('type') as HelpType) ?? 'yellow');
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<HelpAudience>('public');
  const [channel, setChannel] = useState<HelpChannel>('chat');
  const [vicinity, setVicinity] = useState(1000);
  const [busy, setBusy] = useState(false);

  if (!user || !profile) return null;
  return (
    <Card>
      <h2 className="text-xl font-bold">Request Help</h2>
      <p className="text-xs text-muted mt-1">Pick urgency, audience, and how nearby people should respond.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(['red', 'orange', 'yellow'] as const).map((t) => (
          <button key={t} onClick={() => setType(t)}
            className={`h-12 rounded-full font-bold border ${type === t ? 'border-ink' : 'border-line'} ${t === 'red' ? 'bg-red2 text-white' : t === 'orange' ? 'bg-orange2 text-white' : 'bg-yellow2 text-ink'}`}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-3">
        <Textarea label="What do you need?" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={type === 'red' ? 'Describe your emergency briefly. Help is on the way.' : 'A short description'} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Audience" value={audience} onChange={(e) => setAudience(e.target.value as HelpAudience)}>
            <option value="public">Public</option>
            <option value="favourites">Favourites</option>
            <option value="contacts">Contacts</option>
          </Select>
          <Select label="Channel" value={channel} onChange={(e) => setChannel(e.target.value as HelpChannel)}>
            <option value="chat">Chat</option>
            <option value="call">Call</option>
            <option value="inPerson">In Person</option>
          </Select>
        </div>
        <Select label="Vicinity" value={vicinity} onChange={(e) => setVicinity(Number(e.target.value))}>
          {VICINITIES.map((v) => <option key={v} value={v}>{v >= 1000 ? `${v / 1000} km` : `${v} m`}</option>)}
        </Select>
      </div>
      <Button full size="lg" loading={busy} className="mt-4" onClick={async () => {
        if (!text.trim()) return toast('Add a short description', 'error');
        setBusy(true);
        try {
          await createHelp({
            uid: user.uid,
            authorName: profile.fullName,
            authorPhoto: profile.photoURL,
            authorRating: profile.rating ?? 0,
            type, text: text.trim(),
            audience, channel,
            vicinityMeters: vicinity,
            lat: coords?.lat, lng: coords?.lng,
          });
          router.replace('/help');
        } catch (e: any) { toast(e?.message ?? 'Failed', 'error'); }
        finally { setBusy(false); }
      }}>Send help request</Button>
    </Card>
  );
}
