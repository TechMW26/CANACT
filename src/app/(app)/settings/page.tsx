'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { useAuth } from '@/lib/auth';
import { ConfirmDialog } from '@/components/Modal';
import { toast } from '@/components/Toaster';
import { enableWebPush, pushSupported, webPushErrorMessage, webPushInstallRequired } from '@/lib/services/push';
import { GlassSwitch } from '@/components/GlassSwitch';
import {
  isNativeContactSyncAvailable,
  parseVCardContacts,
  readAllDeviceContacts,
  syncContactRecords,
} from '@/lib/services/contactSync';

export default function SettingsPage() {
  const { user, profile, signOut, updateMyProfile, deleteAccount } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [contactsBusy, setContactsBusy] = useState(false);
  const contactFileRef = useRef<HTMLInputElement | null>(null);
  const [pushState, setPushState] = useState<'unknown' | 'granted' | 'denied' | 'default' | 'unsupported' | 'install-required'>('unknown');

  useEffect(() => {
    if (webPushInstallRequired()) { setPushState('install-required'); return; }
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
        toast(webPushErrorMessage(r.reason), 'error');
        setPushState((Notification.permission as any) || 'denied');
      }
    } finally { setPushBusy(false); }
  }

  async function syncContacts() {
    if (!isNativeContactSyncAvailable()) { contactFileRef.current?.click(); return; }
    setContactsBusy(true);
    try {
      const result = await syncContactRecords(await readAllDeviceContacts(), profile?.countryCode);
      toast(`${result.synced} contacts synced · ${result.matched} already on Canact`, 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not sync contacts', 'error');
    } finally {
      setContactsBusy(false);
    }
  }

  async function importContacts(file?: File) {
    if (!file) return;
    setContactsBusy(true);
    try {
      const contacts = parseVCardContacts(await file.text());
      if (!contacts.length) throw new Error('No contacts were found in that file.');
      const result = await syncContactRecords(contacts, profile?.countryCode);
      toast(`${result.synced} contacts synced · ${result.matched} already on Canact`, 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not sync contacts', 'error');
    } finally {
      setContactsBusy(false);
      if (contactFileRef.current) contactFileRef.current.value = '';
    }
  }

  if (!user || !profile) return null;
  return (
    <div className="space-y-3 px-4 pt-4">
      <Card>
        <h3 className="font-bold">Notifications</h3>
        <div className="mt-3 flex items-center justify-between">
          <span>Sound for help &amp; reactions</span>
          <GlassSwitch
            checked={!!profile.notificationSound}
            label="Sound for help and reactions"
            onChange={(checked) => updateMyProfile({ notificationSound: checked })}
          />
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-sm font-extrabold text-ink">Push notifications</div>
          <p className="mt-1 text-xs text-ink/60">
            Get alerts for messages, help responses and meet ratings — even when the app is closed.
            On iPhone and iPad, install Canact on the Home Screen first.
          </p>
          <div className="mt-3">
            {pushState === 'granted' && <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">Enabled</span>}
            {pushState === 'denied' && <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-bold text-brand">Blocked in browser settings</span>}
            {pushState === 'unsupported' && <span className="rounded-full bg-ink/10 px-3 py-1 text-xs font-bold text-ink/60">Not supported on this device</span>}
            {pushState === 'install-required' && (
              <div className="rounded-2xl bg-brand-light/70 px-4 py-3 text-sm text-brand-dark">
                <div className="font-extrabold">Install Canact to enable iOS notifications</div>
                <p className="mt-1 text-xs leading-5">In Safari, tap Share, choose Add to Home Screen, then open Canact from its new icon and return here.</p>
              </div>
            )}
            {(pushState === 'default' || pushState === 'unknown') && (
              <Button onClick={turnOnPush} disabled={pushBusy}>{pushBusy ? 'Enabling…' : 'Turn on notifications'}</Button>
            )}
          </div>
        </div>
      </Card>
      <Card>
        <h3 className="font-bold">Contact discovery</h3>
        <p className="mt-1 text-xs text-ink/60">
          Sync your address book to find people you know. Contact names are not stored; phone and email identifiers are protected before matching.
        </p>
        <div className="mt-3">
          <Button onClick={syncContacts} disabled={contactsBusy}>{contactsBusy ? 'Syncing…' : 'Sync address book'}</Button>
        </div>
        <input
          ref={contactFileRef}
          type="file"
          accept=".vcf,.vcard,text/vcard"
          className="sr-only"
          aria-label="Import full address book"
          onChange={(event) => void importContacts(event.target.files?.[0])}
        />
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
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold text-brand">
          <Link href="/terms" className="rounded-full bg-brand-light px-3 py-2">Terms of Service</Link>
          <Link href="/privacy" className="rounded-full bg-brand-light px-3 py-2">Privacy Policy</Link>
        </div>
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
