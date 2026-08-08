'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useAuth } from '@/lib/auth';
import { db, getFirebaseAuth } from '@/lib/firebase';
import { toast } from '@/components/Toaster';
import {
  Camera, CheckCircle2, ChevronRight, Eye, Loader2, Lock, Pencil, ShieldCheck, Sparkles, Star,
} from '@/components/icons';
import type { UserProfile } from '@/lib/types';
import styles from './Settings.module.css';

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [documentType, setDocumentType] = useState('aadhaar');
  const [documentFront, setDocumentFront] = useState<File | null>(null);
  const [documentBack, setDocumentBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onValue(ref(db, `users/${user.uid}`), (s) => setProfile(s.val()));
  }, [user?.uid]);

  if (!user || !profile) return null;

  const isVerified = !!profile.profileVerified;
  const verificationStatus = profile.verificationStatus;
  const cooldownUntil = Number(profile.verificationCooldownUntil || 0);
  const cooldownActive = verificationStatus === 'rejected' && cooldownUntil > Date.now();

  const submitVerification = async () => {
    if (!documentFront) return toast('Upload the front of your identity document.', 'error');
    if (!selfie) return toast('Add a clear verification selfie.', 'error');
    setBusy(true);
    try {
      const idToken = await getFirebaseAuth().currentUser?.getIdToken();
      if (!idToken) throw new Error('Please sign in again.');
      const body = new FormData();
      body.set('documentType', documentType);
      body.set('documentFront', documentFront);
      if (documentBack) body.set('documentBack', documentBack);
      body.set('selfie', selfie);
      const res = await fetch('/api/verify/manual/submit', {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}` },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setDocumentFront(null); setDocumentBack(null); setSelfie(null);
      toast('Verification request submitted for review.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not submit verification', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className={styles.page}>
      {/* Quick Actions */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Quick actions</span>
        <div className={styles.quickActions}>
          <Link href="/edit-profile" prefetch className={styles.quickAction}>
            <span className={`${styles.quickActionIcon} ${styles.edit}`}><Pencil size={18} /></span>
            <span className={styles.quickActionLabel}>Edit profile</span>
          </Link>
          <Link href="/rateme/start" prefetch className={styles.quickAction}>
            <span className={`${styles.quickActionIcon} ${styles.rateme}`}><Star size={18} /></span>
            <span className={styles.quickActionLabel}>Rate Me</span>
          </Link>
          <Link href="/underground" prefetch className={styles.quickAction}>
            <span className={`${styles.quickActionIcon} ${styles.underground}`}><Eye size={18} /></span>
            <span className={styles.quickActionLabel}>Underground</span>
          </Link>
        </div>
      </div>

      {/* Manual identity verification */}
      <div id="identity-verification" className={styles.section}>
        <span className={styles.sectionLabel}>Identity verification</span>
          <h2 className={styles.digiTitle}>Verify your identity</h2>
          <p className={styles.digiDesc}>
            Upload an identity document and a fresh selfie. An authorised Canact reviewer will approve or reject the request from the secure admin dashboard.
          </p>

          {isVerified ? (
            <div className={styles.verifiedPanel}>
              <div className={styles.verifiedBadge}>
                <CheckCircle2 size={12} /> Manually verified
              </div>
              <div className={styles.verifiedFields}>
                <div className={styles.verifiedField}>
                  <span className={styles.verifiedFieldLabel}>Full name</span>
                  <p className={styles.verifiedFieldValue}>{profile.fullName || '—'}</p>
                </div>
                <div className={styles.verifiedField}>
                  <span className={styles.verifiedFieldLabel}>Date of birth</span>
                  <p className={styles.verifiedFieldValue}>{profile.dateOfBirth || 'Not available'}</p>
                </div>
                <div className={`${styles.verifiedField} ${styles.full}`}>
                  <span className={styles.verifiedFieldLabel}>Address</span>
                  <p className={styles.verifiedFieldValue}>{profile.address || 'Not available'}</p>
                </div>
              </div>
              <div className={styles.verifiedLock}>
                <Lock size={11} /> These fields are permanently locked
              </div>
            </div>
          ) : verificationStatus === 'pending' ? (
            <div className={styles.reviewState}>
              <span className={styles.reviewStateIcon}><Loader2 size={20} /></span>
              <div>
                <strong>Review in progress</strong>
                <p>Your documents are safely queued for an administrator. Reviews typically take up to 24 hours. We will notify you after the review.</p>
              </div>
            </div>
          ) : cooldownActive ? (
            <div className={`${styles.reviewState} ${styles.reviewRejected}`}>
              <span className={styles.reviewStateIcon}>!</span>
              <div>
                <strong>Request not approved</strong>
                <p>{profile.verificationRejectionReason || 'The submitted documents could not be verified.'}</p>
                <small>You can reapply on {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(cooldownUntil))}.</small>
              </div>
            </div>
          ) : (
            <div className={styles.manualForm}>
              {verificationStatus === 'rejected' ? <div className={styles.reapplyNotice}>The cooldown is complete. You can submit a new request.</div> : null}
              <label className={styles.fieldLabel}>
                Identity document
                <select className={styles.selectInput} value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
                  <option value="aadhaar">Aadhaar card</option>
                  <option value="passport">Passport</option>
                  <option value="driving_licence">Driving licence</option>
                  <option value="voter_id">Voter ID</option>
                  <option value="other">Other government ID</option>
                </select>
              </label>
              <div className={styles.uploadGrid}>
                <UploadField label="Document front" hint="Required · image or PDF" file={documentFront} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={setDocumentFront} />
                <UploadField label="Document back" hint="Optional · image or PDF" file={documentBack} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={setDocumentBack} />
              </div>
              <UploadField label="Verification selfie" hint="Required · clear, recent photo" file={selfie} accept="image/jpeg,image/png,image/webp" capture="user" onChange={setSelfie} icon={<Camera size={18} />} />
              <p className={styles.selfieNotice}>This selfie is used only for verification and will not replace your profile photo.</p>
              <button className={`${styles.stepBtn} ${styles.stepBtnPrimary} ${styles.submitBtn}`} onClick={submitVerification} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={15} />}
                {busy ? 'Uploading securely…' : 'Submit for review'}
              </button>
            </div>
          )}
      </div>

      {/* More */}
      <div className={styles.section}>
        <Link href="/settings" prefetch className={styles.moreLink}>
          <span>App settings</span>
          <ChevronRight size={16} />
        </Link>
      </div>
    </div>
  );
}

function UploadField({ label, hint, file, accept, capture, onChange, icon }: {
  label: string;
  hint: string;
  file: File | null;
  accept: string;
  capture?: 'user' | 'environment';
  onChange: (file: File | null) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className={`${styles.uploadField} ${file ? styles.uploadFieldReady : ''}`}>
      <input type="file" accept={accept} capture={capture} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />
      <span className={styles.uploadIcon}>{file ? <CheckCircle2 size={18} /> : icon ?? <Sparkles size={18} />}</span>
      <strong>{file ? file.name : label}</strong>
      <small>{file ? `${Math.max(.1, file.size / (1024 * 1024)).toFixed(1)} MB` : hint}</small>
    </label>
  );
}
