'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { Button } from '@/components/Button';
import { Select, Textarea } from '@/components/Input';
import { createHelp } from '@/lib/services/help';
import { HelpAudience, HelpChannel, HelpType } from '@/lib/types';
import { toast } from '@/components/Toaster';
import { ShieldAlert, AlertTriangle, CircleHelp } from '@/components/icons';

const VICINITIES = [15, 50, 250, 1000, 5000, 20000];

const TYPE_META: Record<HelpType, { label: string; desc: string; bg: string; text: string; Icon: typeof ShieldAlert }> = {
  red:    { label: 'Red',    desc: 'Emergency · needs help now',     bg: 'bg-red2',    text: 'text-white', Icon: ShieldAlert },
  orange: { label: 'Orange', desc: 'Urgent · within the hour',        bg: 'bg-orange2', text: 'text-white', Icon: AlertTriangle },
  yellow: { label: 'Yellow', desc: 'Casual · whenever someone can',   bg: 'bg-yellow2', text: 'text-ink',   Icon: CircleHelp },
};

export default function HelpCreatePage() {
  const sp = useSearchParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { coords, error: geoError } = useGeo();
  const initialType = (sp.get('type') as HelpType) ?? 'yellow';
  const [type, setType] = useState<HelpType>(initialType);
  const [text, setText] = useState('');
  const [audience, setAudience] = useState<HelpAudience>('public');
  const [channel, setChannel] = useState<HelpChannel>('chat');
  const [vicinity, setVicinity] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user || !profile) return null;

  const meta = TYPE_META[type];
  const Icon = meta.Icon;

  async function submit() {
    setError(null);
    if (!text.trim()) { setError('Please describe what you need.'); return; }
    if (text.trim().length < 5) { setError('Add a bit more detail (at least 5 characters).'); return; }
    setBusy(true);
    try {
      await createHelp({
        uid: user!.uid,
        authorName: profile!.fullName,
        authorPhoto: profile!.photoURL,
        authorRating: profile!.rating ?? 0,
        type,
        text: text.trim(),
        audience,
        channel,
        vicinityMeters: vicinity,
        lat: coords?.lat,
        lng: coords?.lng,
      });
      toast('Help request sent', 'success');
      router.replace('/help');
    } catch (e: any) {
      const msg = e?.message ?? 'Something went wrong. Please try again.';
      setError(msg);
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 px-4 pt-4">
        <h2 className="text-xl font-bold">Request Help</h2>
        <p className="text-xs text-muted mt-1">Pick urgency, audience, and how nearby people should respond.</p>

        {/* Type chooser — segmented with descriptions */}
        <div className="mt-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-ink/60">Urgency</div>
          <div className="grid grid-cols-3 gap-2">
            {(['red', 'orange', 'yellow'] as const).map((t) => {
              const m = TYPE_META[t];
              const I = m.Icon;
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-2xl border-2 p-3 flex flex-col items-center gap-1 transition ${active ? 'border-ink' : 'border-transparent opacity-70 hover:opacity-100'} ${m.bg} ${m.text}`}
                >
                  <I size={20} strokeWidth={2.2} />
                  <span className="font-bold text-sm">{m.label}</span>
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-muted">{meta.desc}</div>
        </div>

        {/* Description */}
        <div className="mt-4">
          <Textarea
            label="What do you need?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder={
              type === 'red'   ? 'Briefly describe your emergency. Be specific so people can help fast.' :
              type === 'orange'? 'What do you need help with in the next hour?' :
                                 'A short description of what you need.'
            }
          />
          <div className="text-[11px] text-muted text-right mt-1">{text.length}/500</div>
        </div>

        {/* Audience + channel */}
        <div className="mt-2 grid grid-cols-2 gap-3">
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

        <div className="mt-3">
          <Select label="Vicinity" value={vicinity} onChange={(e) => setVicinity(Number(e.target.value))}>
            {VICINITIES.map((v) => <option key={v} value={v}>{v >= 1000 ? `${v / 1000} km` : `${v} m`}</option>)}
          </Select>
        </div>

        {geoError && (
          <div className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            Location unavailable — your request will go out without a precise location.
          </div>
        )}

        {error && (
          <div className="mt-3 text-sm text-red2 bg-red2/10 border border-red2/30 rounded-xl px-3 py-2 flex items-start gap-2">
            <Icon size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}

        <Button full size="lg" loading={busy} className="mt-4" onClick={submit}>
          Send help request
        </Button>
    </div>
  );
}
