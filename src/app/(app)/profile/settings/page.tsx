'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { toast } from '@/components/Toaster';
import {
  ArrowLeft, CheckCircle2, Lock, Sparkles, ShieldAlert, Eye, Pencil, Star,
} from '@/components/icons';
import type { UserProfile } from '@/lib/types';

export default function ProfileSettingsPage() {
  const { user } = useAuth();
  const [u, setU] = useState<UserProfile | null>(null);
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [requestId, setRequestId] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!user) return;
    return onValue(ref(db, `users/${user.uid}`), (s) => setU(s.val()));
  }, [user?.uid]);

  if (!user) return null;
  const isVerified = !!u?.profileVerified;

  const sendOtp = async () => {
    if (!aadhaarNumber.trim()) { toast('Enter your Aadhaar number to continue.', 'error'); return; }
    setSendingOtp(true);
    try {
      const res = await fetch('/api/verify/digilocker/send-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ aadhaarNumber, uid: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setRequestId(data.requestId ?? '');
      setOtpSent(true);
      toast(data?.message ?? 'OTP sent', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not send OTP', 'error');
    } finally { setSendingOtp(false); }
  };

  const completeVerification = async () => {
    if (!otp.trim() || !requestId) { toast('Enter the OTP first.', 'error'); return; }
    setVerifying(true);
    try {
      const res = await fetch('/api/verify/digilocker/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ otp, requestId, uid: user.uid }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setOtp(''); setOtpSent(false); setRequestId(''); setAadhaarNumber('');
      toast('Profile verified.', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not verify profile', 'error');
    } finally { setVerifying(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link href="/profile" prefetch aria-label="Back" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white ring-1 ring-line text-ink hover:bg-brand-light/40">
          <ArrowLeft size={18} />
        </Link>
        <h2 className="text-lg font-extrabold tracking-tight">Profile settings</h2>
      </div>

      <Card>
        <h3 className="font-bold">Quick actions</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/edit-profile" prefetch>
            <Button size="sm" variant="outline" icon={<Pencil size={14} />}>Edit profile</Button>
          </Link>
          <Link href="/rateme/start" prefetch>
            <Button size="sm" variant="subtle" icon={<Star size={14} />}>Start Rate Me</Button>
          </Link>
          <Link href="/underground" prefetch>
            <Button size="sm" variant="ghost" icon={<Eye size={14} />}>Underground</Button>
          </Link>
        </div>
      </Card>

      <Card className="overflow-hidden border border-[#EFD9DD] bg-white shadow-[0_18px_44px_-26px_rgba(10,10,10,0.22)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-brand-light px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
              <Sparkles size={12} /> Verify Profile
            </div>
            <h3 className="mt-3 text-xl font-black tracking-tight text-ink">DigiLocker identity lock</h3>
            <p className="mt-1 text-sm text-ink/65">
              Verify via OTP and Canact will auto-lock your name, DOB, and address so others can trust the profile.
            </p>
          </div>
          {isVerified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">
              <CheckCircle2 size={12} /> Verified
            </span>
          ) : (
            <ShieldAlert size={20} className="shrink-0 text-brand" />
          )}
        </div>

        {isVerified ? (
          <div className="mt-4 rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <div className="flex items-center gap-2 font-bold"><CheckCircle2 size={16} /> Verified via DigiLocker</div>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <LockedField label="Name" value={u?.fullName ?? ''} />
              <LockedField label="DOB" value={u?.dateOfBirth || 'Not available'} />
              <LockedField label="Address" value={u?.address || 'Not available'} className="md:col-span-2" />
            </div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
              <Lock size={13} /> These fields are locked after verification
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-3xl border border-[#F2DADF] bg-[linear-gradient(135deg,rgba(255,248,248,1),rgba(255,216,221,0.38))] p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-ink/55">Step 1</div>
              <Input
                label="Aadhaar number"
                value={aadhaarNumber}
                onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="Enter 12-digit Aadhaar"
                className="mt-2"
                inputMode="numeric"
              />
              <Button size="sm" className="mt-3" loading={sendingOtp} onClick={sendOtp}>Send OTP</Button>
            </div>
            <div className="rounded-3xl border border-[#F2DADF] bg-white p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-ink/55">Step 2</div>
              <Input
                label="OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter OTP"
                className="mt-2"
                inputMode="numeric"
                disabled={!otpSent}
              />
              <Button size="sm" className="mt-3" variant="outline" loading={verifying} onClick={completeVerification} disabled={!otpSent}>Verify with DigiLocker</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="font-bold">More</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/settings" prefetch>
            <Button size="sm" variant="outline">App settings</Button>
          </Link>
        </div>
      </Card>
    </div>
  );
}

function LockedField({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={`rounded-2xl border border-emerald-200 bg-white px-3 py-3 ${className}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}
