'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CountryCode } from 'libphonenumber-js';
import { ArrowLeft, ArrowRight, MessageCircle, Monitor } from 'lucide-react';
import { PhoneInput, isPhoneValid, splitStoredPhone, toE164 } from '@/components/PhoneInput';
import { Splash } from '@/components/Splash';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import styles from '@/components/AuthFlow.module.css';

const OTP_SEND_MESSAGE = 'We could not send a code right now. Please try again shortly.';
const OTP_VERIFY_MESSAGE = 'That code did not work. Request a new code and try again.';

function Progress({ step = 1 }: { step?: number }) {
  return (
    <div className={styles.progressWrap} aria-label={`Step ${step} of 7`}>
      <div className={styles.progress}>{Array.from({ length: 7 }, (_, index) => <span key={index} className={index < step ? styles.active : ''} />)}</div>
      <div className={styles.progressLabel}>Step {step} <b>of</b> 7</div>
    </div>
  );
}

export default function WelcomePage() {
  const router = useRouter();
  const { user, profile, loading, requestOTP, signInLocally, confirmOTP, pendingOTP, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [profileTimedOut, setProfileTimedOut] = useState(false);
  const [localPhoneLogin, setLocalPhoneLogin] = useState(false);

  // Phone input state
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('IN');
  const [phoneDigits, setPhoneDigits] = useState('');

  // OTP state
  const [otpSent, setOtpSent] = useState(false);
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setLocalPhoneLogin(['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname));
  }, []);

  // Restore an unexpired verification after navigation/reload. The Firebase
  // verification ID is kept in sessionStorage, never the code itself.
  useEffect(() => {
    if (localPhoneLogin) {
      setOtpSent(false);
      return;
    }
    const session = pendingOTP('signin');
    if (!session) return;
    const restored = splitStoredPhone(session.phone);
    setPhoneCountry(restored.country);
    setPhoneDigits(restored.national);
    setOtpSent(true);
    const elapsedSeconds = Math.floor((Date.now() - (session.expiresAt - 5 * 60 * 1000)) / 1000);
    setResendCooldown(Math.max(0, 30 - elapsedSeconds));
  }, [localPhoneLogin, pendingOTP]);

  // Timer for resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Redirect if already logged in
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (profile?.profileComplete) {
      router.replace('/');
      return;
    }
    const timeout = setTimeout(() => setProfileTimedOut(true), 3000);
    if (profile) {
      clearTimeout(timeout);
      router.replace('/onboard');
    }
    return () => clearTimeout(timeout);
  }, [loading, profile, router, user]);

  if (loading || user) {
    if (loading) return <Splash message="Loading…" />;
    if (profile?.profileComplete) return <Splash message="Welcome back" />;
    if (profileTimedOut) {
      return (
        <main className={styles.page}>
          <Splash message="Setting up your account…" />
          <div className="mt-4 text-center">
            <button type="button" onClick={() => router.replace('/onboard')} className="text-brand underline font-bold">
              Taking too long? Tap here
            </button>
          </div>
        </main>
      );
    }
    return <Splash message="Setting up your account…" />;
  }

  const fullPhone = toE164(phoneCountry, phoneDigits);
  const phoneValid = isPhoneValid(phoneCountry, phoneDigits);

  // ── Send OTP ──
  const handleSendOTP = async () => {
    if (!phoneValid) return toast('Enter a valid phone number', 'error');
    setBusy(true);
    try {
      if (localPhoneLogin) {
        const result = await signInLocally(fullPhone);
        if (!result.ok) {
          toast(result.error || 'Local phone login is unavailable.', 'error');
          return;
        }
        toast(result.isNewUser ? 'Local account created' : 'Welcome back', 'success');
        router.replace(result.nextPath ?? (result.isNewUser ? '/onboard' : '/'));
        return;
      }
      const result = await requestOTP(fullPhone);
      if (!result.ok) {
        toast(result.error || OTP_SEND_MESSAGE, 'error');
        return;
      }
      setOtpSent(true);
      setResendCooldown(30);
      setOtpError('');
      setTimeout(() => otpRefs.current[0]?.focus(), 200);
    } catch {
      toast(OTP_SEND_MESSAGE, 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── Resend OTP ──
  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setOtpDigits(['', '', '', '', '', '']);
    setOtpError('');
    setBusy(true);
    try {
      const result = await requestOTP(fullPhone, true);
      if (!result.ok) {
        toast(result.error || OTP_SEND_MESSAGE, 'error');
        return;
      }
      setResendCooldown(30);
      setTimeout(() => otpRefs.current[0]?.focus(), 200);
    } catch {
      toast(OTP_SEND_MESSAGE, 'error');
    } finally {
      setBusy(false);
    }
  };

  // ── OTP input handling ──
  const handleOtpInput = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otpDigits];
    next[index] = value.slice(-1);
    setOtpDigits(next);
    setOtpError('');

    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
    if (value && index === 5) {
      const code = [...next.slice(0, 5), value].join('');
      if (code.length === 6) handleVerify(code);
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  // ── Verify OTP ──
  const handleVerify = async (code?: string) => {
    const finalCode = code || otpDigits.join('');
    if (finalCode.length !== 6) return;
    setBusy(true);
    setOtpError('');
    try {
      const result = await confirmOTP(finalCode);
      if (!result.ok) {
        setOtpError(OTP_VERIFY_MESSAGE);
        setOtpDigits(['', '', '', '', '', '']);
        setTimeout(() => otpRefs.current[0]?.focus(), 300);
        return;
      }
      toast(result.isNewUser ? 'Number verified — let’s create your profile' : 'Welcome back', 'success');
      router.replace(result.nextPath ?? (result.isNewUser ? '/onboard' : '/'));
    } catch {
      setOtpError(OTP_VERIFY_MESSAGE);
      setOtpDigits(['', '', '', '', '', '']);
    } finally {
      setBusy(false);
    }
  };

  const handleBack = () => {
    setOtpSent(false);
    setOtpDigits(['', '', '', '', '', '']);
    setOtpError('');
    setResendCooldown(0);
  };

  // ── OTP INPUT SCREEN ──
  if (otpSent) {
    return (
      <main className={styles.page}>
        <section className={styles.registerPage}>
          <button type="button" className={styles.backButton} aria-label="Change phone number" onClick={handleBack}>
            <ArrowLeft size={22} />
          </button>

          <div className={styles.authCenter}>
            <Image className={styles.registerBrand} src="/canact-brand.png" alt="Canact" width={1254} height={1254} priority />

            <div className={styles.registerBody}>
            <h1 className={styles.title}>Enter verification code</h1>
            <p className={styles.subtitle}>
              Sent via SMS to {fullPhone}
            </p>

            <div className={styles.otpGrid}>
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpInput(i, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(i, e)}
                  disabled={busy}
                  className={styles.otpInput}
                  data-filled={digit ? 'true' : undefined}
                  data-error={otpError ? 'true' : undefined}
                />
              ))}
            </div>

            {otpError && (
              <p className={styles.otpError}>{otpError}</p>
            )}

            <p className={styles.otpResend}>
              {resendCooldown > 0 ? (
                <>Resend code in {resendCooldown}s</>
              ) : (
                <button type="button" onClick={handleResend} style={{ color: '#1f6b55', fontWeight: 700 }}>
                  Resend code
                </button>
              )}
            </p>

            <button
              type="button"
              className={styles.primaryButton}
              disabled={busy || otpDigits.join('').length !== 6}
              onClick={() => handleVerify()}
            >
              <span>{busy ? 'Verifying…' : 'Verify'}</span>
              <span className={styles.primaryIcon}><ArrowRight /></span>
            </button>
            </div>
          </div>
        </section>
      </main>
    );
  }

  // ── PHONE INPUT SCREEN ──
  return (
    <main className={styles.page}>
      <section className={styles.registerPage}>
        {user && (
          <button type="button" onClick={async () => { await signOut(); router.replace('/welcome'); }} style={{ position: 'absolute', top: 20, right: 38, color: '#1f6b55', fontSize: 14, fontWeight: 700 }}>
            Sign out
          </button>
        )}

        <div className={styles.authCenter}>
          <Image className={styles.registerBrand} src="/canact-brand.png" alt="Canact" width={1254} height={1254} priority />

          <div className={styles.registerBody}>
          <h1 className={styles.title}>Continue with Canact</h1>
          <p className={styles.subtitle}>Enter your phone to sign in or create your account.</p>

          <div className={styles.registerFields}>
            <div className={styles.phoneWrap}>
              <PhoneInput
                country={phoneCountry}
                onCountryChange={setPhoneCountry}
                value={phoneDigits}
                onChange={setPhoneDigits}
                required
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginTop: 8, color: 'rgba(17,40,34,0.5)', fontSize: 13 }}>
              {localPhoneLogin ? <Monitor size={14} /> : <MessageCircle size={14} />}
              <span>{localPhoneLogin ? 'Local development login — no OTP will be sent.' : 'A verification code will be sent via SMS.'}</span>
            </div>

            <div id="recaptcha-container" className={styles.recaptcha} />
          </div>

          <button
            type="button"
            className={styles.primaryButton}
            disabled={busy || !phoneValid}
            onClick={handleSendOTP}
          >
            <span>{busy ? (localPhoneLogin ? 'Signing in…' : 'Sending…') : (localPhoneLogin ? 'Continue' : 'Get OTP')}</span>
            <span className={styles.primaryIcon}><ArrowRight /></span>
          </button>

          <Progress step={1} />
          </div>
        </div>
      </section>

    </main>
  );
}
