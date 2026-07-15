'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ref, update } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import {
  ONBOARDING_MAX_POINTS, ONBOARDING_TASKS, currentOnboardingTask,
  recordOnboardingSignal, saveContactSync, type OnboardingTaskId,
} from '@/lib/services/onboarding';
import { toast } from './Toaster';
import styles from './OnboardingTaskGuide.module.css';

type ContactRecord = { name?: string[]; tel?: string[]; email?: string[] };
type ContactsNavigator = Navigator & { contacts?: { select: (properties: string[], options: { multiple: boolean }) => Promise<ContactRecord[]> } };

const ROUTE_TASKS: Array<[string, OnboardingTaskId]> = [
  ['/feed', 'visit-feed'], ['/help', 'learn-help'], ['/leaderboard', 'view-leaderboard'],
];

export function OnboardingTaskGuide() {
  const { user, profile } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const sentRef = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const progress = profile?.onboarding?.version === 1 ? profile.onboarding : null;
  const task = useMemo(() => currentOnboardingTask(progress as any), [progress]);
  const completedCount = ONBOARDING_TASKS.filter((item) => progress?.completed?.[item.id]).length;

  const signal = async (id: OnboardingTaskId) => {
    if (!user || sentRef.current.has(id)) return;
    sentRef.current.add(id);
    try { await recordOnboardingSignal(user.uid, id); }
    catch (error) { sentRef.current.delete(id); throw error; }
  };

  useEffect(() => {
    if (!user || !progress) return;
    if (profile?.profileComplete) void signal('complete-profile');
    if (profile?.photoURL) void signal('face-identity');
    if (profile?.profileVerified) void signal('verify-identity');
    const routeTask = ROUTE_TASKS.find(([route]) => pathname === route || pathname?.startsWith(`${route}/`));
    if (routeTask) void signal(routeTask[1]);
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') void signal('enable-notifications');
  }, [pathname, profile?.photoURL, profile?.profileComplete, profile?.profileVerified, progress, user?.uid]);

  if (!user || !progress || !task) return null;

  const performAction = async () => {
    if (task.id === 'welcome-tour') {
      setBusy(true);
      try { await signal(task.id); toast(`Tour complete · +${task.points} points`, 'success'); }
      finally { setBusy(false); }
      return;
    }
    if (task.id === 'sync-contacts') {
      const contactsApi = (navigator as ContactsNavigator).contacts;
      if (!contactsApi?.select) { fileRef.current?.click(); return; }
      setBusy(true);
      try {
        const contacts = await contactsApi.select(['name', 'tel', 'email'], { multiple: true });
        if (!contacts.length) return;
        await saveContactSync(user.uid, contacts);
        toast(`${contacts.length} contact${contacts.length === 1 ? '' : 's'} synced`, 'success');
      } catch (error: any) { if (error?.name !== 'AbortError') toast('Could not sync contacts', 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (task.id === 'enable-notifications') {
      setBusy(true);
      try {
        let granted = false;
        const cap = (window as any).Capacitor;
        if (cap?.isNativePlatform?.()) {
          const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
          const result = await FirebaseMessaging.requestPermissions();
          granted = result.receive === 'granted';
        } else if (typeof Notification !== 'undefined') granted = (await Notification.requestPermission()) === 'granted';
        if (!granted) throw new Error('Notification permission was not granted');
        await signal(task.id);
        toast('Notifications enabled', 'success');
      } catch (error: any) { toast(error?.message || 'Could not enable notifications', 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (task.id === 'enable-location') {
      setBusy(true);
      try {
        const position = await requestLocation();
        await update(ref(db, `users/${user.uid}/lastLocation`), { lat: position.lat, lng: position.lng, at: Date.now() });
        await signal(task.id);
        toast('Nearby discovery enabled', 'success');
      } catch (error: any) { toast(error?.message || 'Location permission is required', 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (task.href) router.push(task.href);
  };

  const onContactFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const contacts = parseVCard(await file.text());
      if (!contacts.length) throw new Error('No contacts were found in that file');
      await saveContactSync(user.uid, contacts);
      toast(`${contacts.length} contacts synced`, 'success');
    } catch (error: any) { toast(error?.message || 'Could not import contacts', 'error'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <aside className={styles.guide} aria-live="polite" aria-label="Canact onboarding task">
      <div className={styles.progress}><span style={{ width: `${(completedCount / ONBOARDING_TASKS.length) * 100}%` }} /></div>
      <div className={styles.body}>
        <div className={styles.step}>{completedCount + 1}/{ONBOARDING_TASKS.length}</div>
        <div className={styles.copy}>
          <strong>{task.title}</strong><p>{task.description}</p>
          <div className={styles.meta}>+{task.points} points · {progress.points}/{ONBOARDING_MAX_POINTS}</div>
        </div>
        <button type="button" className={styles.action} disabled={busy} onClick={() => void performAction()}>{busy ? 'Working…' : actionLabel(task.id)}</button>
      </div>
      <input ref={fileRef} className={styles.file} type="file" accept=".vcf,.vcard,text/vcard" aria-label="Import contacts file" onChange={(event) => void onContactFile(event.target.files?.[0])} />
    </aside>
  );
}

function actionLabel(id: OnboardingTaskId) {
  if (id === 'welcome-tour') return 'Got it';
  if (id === 'sync-contacts') return 'Sync';
  if (id === 'enable-notifications' || id === 'enable-location') return 'Allow';
  if (id === 'verify-identity') return 'Verify';
  return 'Open';
}

async function requestLocation() {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const permission = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') throw new Error('Location permission was not granted');
    const result = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
    return { lat: result.coords.latitude, lng: result.coords.longitude };
  }
  if (!navigator.geolocation) throw new Error('Location is not supported on this device');
  return new Promise<{ lat: number; lng: number }>((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
    reject,
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 },
  ));
}

function parseVCard(source: string): ContactRecord[] {
  return source.split(/END:VCARD/i).map((block) => {
    const name = block.match(/(?:^|\n)FN[^:]*:([^\r\n]+)/i)?.[1]?.trim();
    const tel = block.match(/(?:^|\n)TEL[^:]*:([^\r\n]+)/i)?.[1]?.trim();
    const email = block.match(/(?:^|\n)EMAIL[^:]*:([^\r\n]+)/i)?.[1]?.trim();
    return { name: name ? [name] : undefined, tel: tel ? [tel] : undefined, email: email ? [email] : undefined };
  }).filter((contact) => contact.name || contact.tel || contact.email);
}
