'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updatePassword } from 'firebase/auth';
import type { CountryCode } from 'libphonenumber-js';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { PhoneInput, isPhoneValid, toE164 } from '@/components/PhoneInput';
import { Splash } from '@/components/Splash';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import styles from '@/components/AuthFlow.module.css';

const ADMIN_EMAIL = 'avi2001raj@gmail.com';
const ADMIN_PASSWORD = 'Admin@login2026';
const LEGACY_ADMIN_PASSWORD = 'Admin@login2025';

function GoogleGlyph() {
  return (
    <svg width="23" height="23" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.3 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 19.7-8 19.7-20 0-1.3-.1-2.3-.1-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.1 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.3 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.1z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.4-4.6 2.3-7.2 2.3-5.3 0-9.7-3.4-11.3-8L6 32.7C9.4 38.6 16.1 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2.1 3.9-3.9 5.2l6.2 5.2C41.2 35 44 30 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  );
}

function Progress({ step = 1 }: { step?: number }) {
  return (
    <div className={styles.progressWrap} aria-label={`Step ${step} of 7`}>
      <div className={styles.progress}>{Array.from({ length: 7 }, (_, index) => <span key={index} className={index < step ? styles.active : ''} />)}</div>
      <div className={styles.progressLabel}>Step {step} <b>of</b> 7</div>
    </div>
  );
}

function isLocalhost() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
}

function isInvalidCredentialError(err: any) {
  const code = String(err?.code ?? '');
  return code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found';
}

export default function WelcomePage() {
  const router = useRouter();
  const { user, profile, loading, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<'register' | 'details' | 'login'>('register');
  const [busy, setBusy] = useState(false);
  const [profileTimedOut, setProfileTimedOut] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [devMode, setDevMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('IN');
  const [mobile, setMobile] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { setDevMode(isLocalhost()); }, []);
  useEffect(() => {
    if (!devMode || mode !== 'login' || email || password) return;
    setEmail(ADMIN_EMAIL);
    setPassword(ADMIN_PASSWORD);
  }, [devMode, email, mode, password]);

  useEffect(() => {
    if (!user || profile) { setProfileTimedOut(false); return; }
    const id = window.setTimeout(() => setProfileTimedOut(true), 7000);
    return () => window.clearTimeout(id);
  }, [user, profile]);

  useEffect(() => {
    if (loading || !user) return;
    const registrationInProgress = sessionStorage.getItem('canact:registration-screen');
    if (registrationInProgress || profile?.profileComplete === false) {
      router.replace('/onboard');
      return;
    }
    if (!profile && !profileTimedOut) return;
    if (!profile) {
      router.replace('/onboard');
      return;
    }
    if (profile?.profileComplete) router.replace('/');
  }, [user, profile, loading, profileTimedOut, router]);

  const google = async () => {
    setError('');
    setBusy(true);
    try { await signInWithGoogle(); }
    catch (err: any) {
      const message = err?.message ?? 'Could not continue with Google';
      setError(message);
      toast(message, 'error');
    } finally { setBusy(false); }
  };

  const emailLogin = async () => {
    if (!email.trim() || !password) { setError('Enter your email and password'); return; }
    setError('');
    setBusy(true);
    try {
      await signInWithEmail(email.trim(), password);
      if (!rememberMe) {
        // Firebase persistence is intentionally unchanged; this checkbox is a
        // UI preference until session-only persistence is added app-wide.
      }
    } catch (err: any) {
      const canRecoverAdmin = devMode && email.trim().toLowerCase() === ADMIN_EMAIL && password === ADMIN_PASSWORD && isInvalidCredentialError(err);
      if (!canRecoverAdmin) {
        const message = err?.message ?? 'Sign-in failed';
        setError(message);
        toast(message, 'error');
      } else {
        try {
          await signInWithEmail(ADMIN_EMAIL, LEGACY_ADMIN_PASSWORD);
          const currentUser = getFirebaseAuth().currentUser;
          if (currentUser) await updatePassword(currentUser, ADMIN_PASSWORD);
          toast('Admin password updated for local development', 'success');
        } catch {
          try { await signUpWithEmail(ADMIN_EMAIL, ADMIN_PASSWORD); }
          catch { setError('Reset the local admin password in Firebase Auth.'); }
        }
      }
    } finally { setBusy(false); }
  };

  const registerWithEmail = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) { setError('Enter a valid email address'); return; }
    if (!isPhoneValid(phoneCountry, mobile)) { setError('Enter a valid phone number'); return; }
    if (password.length < 8) { setError('Use at least 8 characters for your password'); return; }
    setError('');
    setBusy(true);
    const storedMobile = toE164(phoneCountry, mobile);
    try {
      sessionStorage.setItem('canact:registration-screen', 'name');
      sessionStorage.setItem('canact:registration-mobile', storedMobile);
      await signUpWithEmail(cleanEmail, password, { email: cleanEmail, mobile: storedMobile, profileComplete: false });
      router.replace('/onboard');
    } catch (err: any) {
      sessionStorage.removeItem('canact:registration-screen');
      const message = err?.code === 'auth/email-already-in-use'
        ? 'An account already exists for this email. Log in instead.'
        : err?.message ?? 'Could not create your account';
      setError(message);
      toast(message, 'error');
    } finally { setBusy(false); }
  };

  if (user) return <Splash message="Signing you in…" />;

  if (mode === 'register') {
    return (
      <main className={styles.welcomePage}>
        <div className={styles.welcomeArt}>
          <Image src="/canact-register-art.svg" alt="People connecting around Canact" width={900} height={1600} priority />
        </div>
        <section className={styles.welcomeContent}>
          <h1 className={styles.title}>Create your account</h1>
          <p className={styles.subtitle}>Start building genuine connections</p>
          <Progress />
          <button type="button" className={styles.primaryButton} onClick={() => { setError(''); setMode('details'); }}>
            <span>Get started</span><span className={styles.primaryIcon}><ArrowRight /></span>
          </button>
          {error ? <p className={styles.error}>{error}</p> : null}
          <button type="button" className={styles.textLink} onClick={() => { setError(''); setMode('login'); }}>
            Already have an account? <strong>Log in</strong>
          </button>
        </section>
      </main>
    );
  }

  if (mode === 'details') {
    return (
      <main className={styles.page}>
        <section className={`${styles.registerPage} ${styles.detailsPage}`}>
          <button type="button" className={styles.backButton} aria-label="Back" onClick={() => { setError(''); setMode('register'); }}><ArrowLeft size={22} /></button>
          <Image className={styles.registerBrand} src="/canact-brand.png" alt="Canact" width={1254} height={1254} priority />
          <p className={styles.eyebrow}>Let&apos;s get your basics</p>
          <Progress step={2} />
          <div className={styles.registerBody}>
            <h1 className={styles.title}>Your details</h1>
            <p className={styles.subtitle}>We&apos;ll use these to create and secure your account.</p>
            <div className={styles.registerFields}>
              <label className={styles.field}>
                <Mail aria-hidden="true" />
                <span className={styles.fieldText}><span>Email address</span><input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></span>
              </label>
              <div className={styles.phoneWrap}>
                <PhoneInput country={phoneCountry} onCountryChange={setPhoneCountry} value={mobile} onChange={setMobile} required error={mobile && !isPhoneValid(phoneCountry, mobile) ? 'Enter a valid phone number' : undefined} />
              </div>
              <label className={styles.field}>
                <LockKeyhole aria-hidden="true" />
                <span className={styles.fieldText}><span>Password</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void registerWithEmail(); }} /></span>
                <button type="button" className={styles.passwordToggle} aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button>
              </label>
            </div>
            {error ? <p className={styles.error}>{error}</p> : null}
          </div>
          <footer className={styles.registerFooter}>
            <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void registerWithEmail()}>
              <span>{busy ? 'Creating account…' : 'Continue'}</span><span className={styles.primaryIcon}><ArrowRight /></span>
            </button>
          </footer>
        </section>
      </main>
    );
  }

  return (
    <main className={`${styles.page} ${styles.loginPage}`}>
      <button type="button" className={styles.backButton} aria-label="Back to registration" onClick={() => { setError(''); setMode('register'); }}><ArrowLeft size={22} /></button>
      <Image className={styles.brandFull} src="/canact-brand.png" alt="Canact" width={1254} height={1254} priority />
      <section className={styles.loginCard}>
        <h1 className={styles.title}>Welcome back</h1>
        <p className={styles.subtitle}>Glad to see you again!</p>
        <label className={styles.field}>
          <Mail aria-hidden="true" />
          <span className={styles.fieldText}><span>Email address</span><input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></span>
        </label>
        <label className={styles.field}>
          <LockKeyhole aria-hidden="true" />
          <span className={styles.fieldText}><span>Password</span><input type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void emailLogin(); }} /></span>
          <button type="button" className={styles.passwordToggle} aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button>
        </label>
        <div className={styles.loginOptions}>
          <label><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember me</label>
          <button type="button" onClick={() => toast('Password reset is managed through your sign-in provider.', 'info')}>Forgot password?</button>
        </div>
        <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void emailLogin()}>
          <span>{busy ? 'Signing in…' : 'Log in'}</span><span className={styles.primaryIcon}><ArrowRight /></span>
        </button>
        {error ? <p className={styles.error}>{error}</p> : null}
        <div className={styles.separator}>or continue with</div>
        <button type="button" className={styles.googleButton} aria-label="Continue with Google" disabled={busy} onClick={google}><GoogleGlyph /></button>
        <div><button type="button" className={styles.textLink} onClick={() => { setError(''); setMode('register'); }}>New here? <strong>Create an account</strong></button></div>
        {devMode ? (
          <div className={styles.devPanel}>
            <p>Local development account</p>
            <div className={styles.devActions}>
              <button type="button" disabled={busy} onClick={() => void emailLogin()}>Sign in</button>
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await signUpWithEmail(email, password); } catch (err: any) { toast(err?.message ?? 'Sign-up failed', 'error'); } finally { setBusy(false); } }}>Create dev account</button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
