'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, ref } from 'firebase/database';
import { CloudUpload, Users, X } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import {
  isNativeContactSyncAvailable,
  isWebContactPickerAvailable,
  parseVCardContacts,
  readAllDeviceContacts,
  readWebContacts,
  syncContactRecords,
  type ContactSyncRecord,
} from '@/lib/services/contactSync';
import { recordOnboardingSignal } from '@/lib/services/onboarding';
import { toast } from '@/components/Toaster';
import styles from './ContactPermissionBootstrapper.module.css';

const WEB_PROMPT_INTERVAL = 7 * 24 * 60 * 60 * 1000;

export default function ContactPermissionBootstrapper() {
  const { user, profile } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webPickerAvailable, setWebPickerAvailable] = useState(false);

  useEffect(() => setWebPickerAvailable(isWebContactPickerAvailable()), []);

  useEffect(() => {
    if (!user?.uid || profile?.profileComplete === false) return;
    let cancelled = false;
    let timer = 0;

    const start = async () => {
      const existing = await get(ref(db, `contactSyncs/${user.uid}`)).catch(() => null);
      if (cancelled || existing?.exists()) return;

      if (isNativeContactSyncAvailable()) {
        const askedKey = `canact:contacts:native-asked:${user.uid}:v1`;
        if (localStorage.getItem(askedKey)) return;
        localStorage.setItem(askedKey, String(Date.now()));
        try {
          const contacts = await readAllDeviceContacts();
          if (!contacts.length || cancelled) return;
          const result = await syncContactRecords(contacts, profile?.countryCode);
          await recordOnboardingSignal(user.uid, 'sync-contacts').catch(() => {});
          if (!cancelled) toast(`${result.synced} contacts synced · ${result.matched} people found`, 'success');
        } catch (error: any) {
          if (!cancelled && error?.name !== 'AbortError') toast(error?.message || 'Could not sync contacts', 'error');
        }
        return;
      }

      const promptKey = `canact:contacts:web-prompt:${user.uid}:v1`;
      const lastPrompt = Number(localStorage.getItem(promptKey) || 0);
      if (Date.now() - lastPrompt < WEB_PROMPT_INTERVAL) return;
      const showWhenClear = () => {
        if (cancelled) return;
        if (document.querySelector('[aria-modal="true"]')) {
          timer = window.setTimeout(showWhenClear, 1800);
          return;
        }
        setOpen(true);
      };
      showWhenClear();
    };

    timer = window.setTimeout(() => void start(), 1400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [profile?.countryCode, profile?.profileComplete, user?.uid]);

  const finishSync = async (contacts: ContactSyncRecord[]) => {
    if (!user || !contacts.length) throw new Error('No contacts were selected.');
    const result = await syncContactRecords(contacts, profile?.countryCode);
    await recordOnboardingSignal(user.uid, 'sync-contacts').catch(() => {});
    localStorage.setItem(`canact:contacts:web-prompt:${user.uid}:v1`, String(Date.now()));
    setOpen(false);
    toast(`${result.synced} contacts synced · ${result.matched} people found`, 'success');
  };

  const selectContacts = async () => {
    if (!webPickerAvailable) { fileRef.current?.click(); return; }
    setBusy(true);
    try { await finishSync(await readWebContacts()); }
    catch (error: any) { if (error?.name !== 'AbortError') toast(error?.message || 'Could not sync contacts', 'error'); }
    finally { setBusy(false); }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const contacts = parseVCardContacts(await file.text());
      if (!contacts.length) throw new Error('No contacts were found in that file.');
      await finishSync(contacts);
    } catch (error: any) { toast(error?.message || 'Could not import contacts', 'error'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const dismiss = () => {
    if (user) localStorage.setItem(`canact:contacts:web-prompt:${user.uid}:v1`, String(Date.now()));
    setOpen(false);
  };

  return (
    <>
      {open && typeof document !== 'undefined' ? createPortal(
        <div className={`${styles.backdrop} canact-popup-backdrop`}>
          <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="contact-permission-title">
            <button type="button" className={styles.close} onClick={dismiss} aria-label="Not now"><X size={19} /></button>
            <span className={styles.icon}><Users size={26} /></span>
            <span className={styles.eyebrow}>PEOPLE YOU MAY KNOW</span>
            <h2 id="contact-permission-title">Find your people on Canact</h2>
            <p>Sync your address book to find existing Canact accounts. Contact names are not uploaded, and phone numbers and emails are protected before matching.</p>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void selectContacts()}>
              <CloudUpload size={19} /> {busy ? 'Syncing…' : webPickerAvailable ? 'Choose contacts' : 'Import address book'}
            </button>
            {webPickerAvailable ? <button type="button" className={styles.secondary} disabled={busy} onClick={() => fileRef.current?.click()}>Import a .vcf file instead</button> : null}
            <button type="button" className={styles.later} disabled={busy} onClick={dismiss}>Not now</button>
          </section>
        </div>,
        document.body,
      ) : null}
      <input ref={fileRef} className={styles.file} type="file" accept=".vcf,.vcard,text/vcard" aria-label="Import address book" onChange={(event) => void importFile(event.target.files?.[0])} />
    </>
  );
}
