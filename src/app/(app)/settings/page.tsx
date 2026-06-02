'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth';
import { ConfirmDialog } from '@/components/Modal';
import { toast } from '@/components/Toaster';
import { enableWebPush, pushSupported } from '@/lib/services/push';

export default function SettingsPage() {
  const { user, profile, signOut, updateMyProfile, deleteAccount } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushState, setPushState] = useState<'unknown' | 'granted' | 'denied' | 'default' | 'unsupported'>('unknown');

  useEffect(() => {
    if (!pushSupported()) { setPushState('unsupported'); return; }
    setPushState(Notification.permission as any);
  }, []);

  async function turnOnPush() {
    if (!user) return;
    setPushBusy(true);
    try {
      const r = await enableWebPush(user.uid);
      if (r.ok) {
        setPushState('granted');
        toast('Notifications enabled', 'success');
      } else {
        toast(`Could not enable: ${r.reason}`, 'error');
        setPushState((Notification.permission as any) || 'denied');
      }
    } finally { setPushBusy(false); }
  }

  if (!user || !profile) return null;
  return (
    <div className="space-y-3 pt-4">
      <Card>
        <h3 className="font-bold">Notifications</h3>
        <label className="mt-3 flex items-center justify-between">
          <span>Sound for help &amp; reactions</span>
          <input type="checkbox" className="h-5 w-5 accent-[#C8102E]" checked={!!profile.notificationSound} onChange={(e) => updateMyProfile({ notificationSound: e.target.checked })} />
        </label>
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-sm font-extrabold text-ink">Push notifications</div>
          <p className="mt-1 text-xs text-ink/60">
            Get alerts for messages, help responses and meet ratings — even when the app is closed.
            On iOS you must first add Canact to your home screen.
          </p>
          <div className="mt-3">
            {pushState === 'granted' && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">Enabled</span>}
            {pushState === 'denied' && <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand">Blocked in browser settings</span>}
            {pushState === 'unsupported' && <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-bold text-ink/60">Not supported on this device</span>}
            {(pushState === 'default' || pushState === 'unknown') && (
              <Button onClick={turnOnPush} disabled={pushBusy}>{pushBusy ? 'Enabling…' : 'Turn on notifications'}</Button>
            )}
          </div>
        </div>
      </Card>
      <Card>
        <h3 className="font-bold">Account</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => { await signOut(); router.replace('/welcome'); }}>Sign out</Button>
          <Button variant="danger" onClick={() => setOpen(true)}>Delete profile</Button>
        </div>
      </Card>
      <Card>
        <h3 className="font-bold">About</h3>
        <p className="text-sm text-muted">Canact v1.0 — community-first, mobile-first.</p>
      </Card>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title="Delete profile?" message="Your account and data will be permanently removed." confirmLabel="Delete" danger
        onConfirm={async () => {
          try {
            await deleteAccount();
            router.replace('/welcome');
          } catch (e: any) { toast(e?.message ?? 'Could not delete', 'error'); }
        }}
      />
    </div>
  );
}
