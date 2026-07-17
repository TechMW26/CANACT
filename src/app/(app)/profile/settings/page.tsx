'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { toast } from '@/components/Toaster';
import {
  ArrowLeft, CheckCircle2, ChevronRight, Eye, Loader2, Lock, Pencil, Sparkles, Star,
} from '@/components/icons';
import type { UserProfile } from '@/lib/types';
import styles from './Settings.module.css';

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [aadhaar, setAadhaar] = useState('');
  const [requestId, setRequestId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState<'otp' | 'verify' | null>(null);

  useEffect(() => {
    if (!user) return;
    return onValue(ref(db, `users/${user.uid}`), (s) => setProfile(s.val()));
  }, [user?.uid]);

  if (!user || !profile) return null;

  const isVerified = !!profile.profileVerified;

  const sendOtp = async () => {
    if (!aadhaar.trim()) return toast('Enter your Aadhaar number.', 'error');
    setBusy('otp');
    try {
      const res = await fetch('/api/verify/digilocker/send-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aadhaarNumber: aadhaar, uid: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRequestId(data.requestId ?? '');
      setOtpSent(true);
      toast(data?.message ?? 'OTP sent', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not send OTP', 'error');
    } finally { setBusy(null); }
  };

  const verify = async () => {
    if (!otp.trim() || !requestId) return toast('Enter the OTP.', 'error');
    setBusy('verify');
    try {
      const res = await fetch('/api/verify/digilocker/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otp, requestId, uid: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setOtp(''); setOtpSent(false); setRequestId(''); setAadhaar('');
      toast('Profile verified.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not verify', 'error');
    } finally { setBusy(null); }
  };

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <Link href="/profile" prefetch className={styles.backBtn} aria-label="Back">
          <ArrowLeft size={22} />
        </Link>
        <div className={styles.headerTitle}>
          <h1>Profile settings</h1>
          {profile.city ? <span>{profile.city}</span> : null}
        </div>
        <Avatar src={profile.photoURL} name={profile.fullName} size={40} className={styles.headerAvatar} />
      </div>

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

      {/* DigiLocker Identity Lock */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Identity verification</span>
        <div className={styles.digiCard}>
          <div className={styles.digiBadge}>
            <Sparkles size={11} /> Verify Profile
          </div>
          <h2 className={styles.digiTitle}>DigiLocker identity lock</h2>
          <p className={styles.digiDesc}>
            Verify via OTP and Canact will lock your name, DOB, and address — so others know they can trust this profile.
          </p>

          {isVerified ? (
            <div className={styles.verifiedPanel}>
              <div className={styles.verifiedBadge}>
                <CheckCircle2 size={12} /> Verified via DigiLocker
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
          ) : (
            <div className={styles.steps}>
              <div className={styles.step}>
                <span className={styles.stepNum}>Step 1</span>
                <input
                  className={styles.stepInput}
                  value={aadhaar}
                  onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, '').slice(0, 12))}
                  placeholder="12-digit Aadhaar"
                  inputMode="numeric"
                />
                <button
                  className={`${styles.stepBtn} ${styles.stepBtnPrimary}`}
                  onClick={sendOtp}
                  disabled={busy !== null}
                >
                  {busy === 'otp' ? <Loader2 size={14} className="animate-spin" /> : null}
                  Send OTP
                </button>
              </div>
              <div className={styles.step}>
                <span className={styles.stepNum}>Step 2</span>
                <input
                  className={styles.stepInput}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter OTP"
                  inputMode="numeric"
                  disabled={!otpSent}
                />
                <button
                  className={`${styles.stepBtn} ${styles.stepBtnOutline}`}
                  onClick={verify}
                  disabled={!otpSent || busy !== null}
                >
                  {busy === 'verify' ? <Loader2 size={14} className="animate-spin" /> : null}
                  Verify via DigiLocker
                </button>
              </div>
            </div>
          )}
        </div>
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
