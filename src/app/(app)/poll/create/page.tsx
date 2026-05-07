'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { createPoll } from '@/lib/services/poll';
import { notifyNearbyFriends } from '@/lib/services/sendPush';
import { toast } from '@/components/Toaster';

const HOURS = [1, 4, 8, 12, 24, 48];

export default function PollCreatePage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { coords } = useGeo();
  const [q, setQ] = useState('');
  const [openEnded, setOpenEnded] = useState(false);
  const [options, setOptions] = useState(['', '']);
  const [hours, setHours] = useState(12);
  const [busy, setBusy] = useState(false);

  if (!user || !profile) return null;
  return (
    <div className="pt-4">
      <Card>
        <h2 className="text-xl font-bold">Create a poll</h2>
        <div className="mt-3 space-y-3">
          <Textarea label="Question" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask your community…" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={openEnded} onChange={(e) => setOpenEnded(e.target.checked)} />
            <span>Open-ended (no preset options — just gather replies in comments)</span>
          </label>
          {!openEnded && (
            <div className="space-y-2">
              <span className="text-sm font-semibold">Options</span>
              {options.map((o, i) => (
                <div className="flex gap-2" key={i}>
                  <Input value={o} placeholder={`Option ${i + 1}`} onChange={(e) => {
                    const c = options.slice(); c[i] = e.target.value; setOptions(c);
                  }} />
                  {options.length > 2 && (
                    <button type="button" className="rounded-full px-3 border border-line" onClick={() => setOptions(options.filter((_, j) => j !== i))}>×</button>
                  )}
                </div>
              ))}
              {options.length < 6 && <Button size="sm" variant="outline" onClick={() => setOptions([...options, ''])}>+ Add option</Button>}
            </div>
          )}
          <Select label="Closes in" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{h} hours</option>)}
          </Select>
        </div>
        <Button full size="lg" loading={busy} className="mt-4" onClick={async () => {
          if (!q.trim()) return toast('Add a question', 'error');
          if (!openEnded && options.filter(Boolean).length < 2) return toast('Add at least two options', 'error');
          setBusy(true);
          try {
            const created = await createPoll({
              uid: user.uid,
              authorName: profile.fullName,
              question: q.trim(),
              options: openEnded ? [] : options.filter(Boolean),
              openEnded,
              endsAt: Date.now() + hours * 3600 * 1000,
              lat: coords?.lat, lng: coords?.lng,
            });
            if (typeof coords?.lat === 'number' && typeof coords?.lng === 'number' && created?.id) {
              notifyNearbyFriends({
                lat: coords.lat,
                lng: coords.lng,
                title: `${profile.fullName} started a poll nearby`,
                body: q.trim().slice(0, 120),
                url: `/feed?poll=${created.id}`,
                tag: `poll:${created.id}`,
              });
            }
            router.replace('/feed');
          } catch (e: any) { toast(e?.message ?? 'Failed', 'error'); }
          finally { setBusy(false); }
        }}>Publish poll</Button>
      </Card>
    </div>
  );
}
