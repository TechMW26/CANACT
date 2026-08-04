'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CountryCode } from 'libphonenumber-js';
import {
  ArrowLeft, ArrowRight, Check, Eye, LockKeyhole, Mail, Phone, ShieldCheck,
  Sparkles, UserRound, UsersRound,
} from 'lucide-react';
import { SelfieVerifier } from '@/components/SelfieVerifier';
import { PhoneInput, isPhoneValid, splitStoredPhone, toE164 } from '@/components/PhoneInput';
import { Splash } from '@/components/Splash';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import styles from '@/components/AuthFlow.module.css';

type Gender = 'female' | 'male';
type RegistrationScreen = 'details' | 'name' | 'gender' | 'birthday' | 'selfie' | 'complete';

const SCREEN_ORDER: RegistrationScreen[] = ['details', 'name', 'gender', 'birthday', 'selfie', 'complete'];
const TOTAL_STEPS = 6;
const PROGRESS_STEP: Record<RegistrationScreen, number> = {
  details: 2,
  name: 3,
  gender: 4,
  birthday: 4,
  selfie: 5,
  complete: 6,
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = Array.from({ length: 100 }, (_, index) => new Date().getFullYear() - 13 - index);

function RegistrationProgress({ screen }: { screen: RegistrationScreen }) {
  const step = PROGRESS_STEP[screen];
  return (
    <div className={styles.progressWrap} aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
      <div className={styles.progress}>{Array.from({ length: TOTAL_STEPS }, (_, index) => <span key={index} className={index < step ? styles.active : ''} />)}</div>
      <div className={styles.progressLabel}>Step {step} <b>of</b> {TOTAL_STEPS}</div>
    </div>
  );
}

function AuthField({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span aria-hidden="true">{icon}</span><span className={styles.fieldText}><span>{label}</span>{children}</span></label>;
}

function RegistrationArt({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.registerOrbit} ${compact ? styles.registerOrbitCompact : ''}`} aria-hidden="true">
      <Image src="/canact-register-art.svg" alt="" width={900} height={1600} priority />
    </div>
  );
}

function BrandArt() {
  return <Image className={styles.registerBrand} src="/canact-brand.png" alt="Canact" width={1254} height={1254} priority />;
}

function isOldEnough(date: string) {
  const birthday = new Date(`${date}T12:00:00`);
  if (Number.isNaN(birthday.getTime())) return false;
  const threshold = new Date();
  threshold.setFullYear(threshold.getFullYear() - 13);
  return birthday <= threshold;
}

export default function OnboardPage() {
  const router = useRouter();
  const { user, profile, loading, updateMyProfile, signOut } = useAuth();
  const hydrated = useRef(false);
  const [screen, setScreen] = useState<RegistrationScreen>(() => {
    if (typeof window === 'undefined') return 'details';
    const saved = sessionStorage.getItem('canact:registration-screen') as RegistrationScreen | null;
    return saved && SCREEN_ORDER.includes(saved) ? saved : 'details';
  });
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('IN');
  const [mobile, setMobile] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [selfieData, setSelfieData] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/welcome');
    else if (profile?.profileComplete) router.replace('/');
  }, [loading, profile?.profileComplete, router, user]);

  useEffect(() => { sessionStorage.setItem('canact:registration-screen', screen); }, [screen]);

  useEffect(() => {
    if (!user || !profile || hydrated.current) return;
    hydrated.current = true;
    // Only pre-fill if the user already saved a name in a previous partial registration.
    // Never derive names from Google display name or other sources — let the user fill fresh.
    setFirstName(profile.firstName || '');
    setLastName(profile.lastName || '');
    const draftMobile = sessionStorage.getItem('canact:registration-mobile') || '';
    const parsedPhone = splitStoredPhone(profile.mobile || draftMobile, (profile.countryCode as CountryCode) || 'IN');
    setPhoneCountry(parsedPhone.country);
    setMobile(parsedPhone.national);
    if (profile.gender === 'female' || profile.gender === 'male') setGender(profile.gender);
    if (profile.dateOfBirth) {
      const [savedYear, savedMonth, savedDay] = profile.dateOfBirth.split('-');
      setYear(savedYear || '');
      setMonth(savedMonth || '');
      setDay(savedDay || '');
    }
  }, [profile, user]);

  const dob = year && month && day ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : '';
  const daysInMonth = useMemo(() => year && month ? new Date(Number(year), Number(month), 0).getDate() : 31, [month, year]);
  const selfieVerified = !!profile?.selfieVerifiedAt;
  const selfieReady = !!selfieData || selfieVerified;

  useEffect(() => {
    if (day && Number(day) > daysInMonth) setDay(String(daysInMonth));
  }, [day, daysInMonth]);

  const validationError = () => {
    if (screen === 'details' && !isPhoneValid(phoneCountry, mobile)) return 'Enter a valid mobile number';
    if (screen === 'name' && !firstName.trim()) return 'First name is required';
    if (screen === 'gender' && !gender) return 'Choose how you identify';
    if (screen === 'birthday' && (!dob || !isOldEnough(dob))) return 'Enter a valid birthday (you must be at least 13)';
    if (screen === 'selfie' && !selfieReady) return 'Take a verification selfie to continue';
    return '';
  };

  const goNext = async () => {
    const error = validationError();
    if (error) { toast(error, 'error'); return; }
    if (!user || !profile) return;
    setBusy(true);
    try {
      if (screen === 'details') {
        const storedMobile = toE164(phoneCountry, mobile);
        await updateMyProfile({ mobile: storedMobile });
        sessionStorage.setItem('canact:registration-mobile', storedMobile);
      } else if (screen === 'name') {
        const cleanFirst = firstName.trim();
        const cleanLast = lastName.trim();
        await updateMyProfile({ firstName: cleanFirst, lastName: cleanLast || undefined, fullName: [cleanFirst, cleanLast].filter(Boolean).join(' ') });
      } else if (screen === 'gender') {
        await updateMyProfile({ gender: gender || undefined });
      } else if (screen === 'birthday') {
        await updateMyProfile({ dateOfBirth: dob });
      } else if (screen === 'selfie' && selfieData) {
        await updateMyProfile({
          selfieVerifiedAt: Date.now(),
          selfieVerificationMethod: 'blink-liveness-v1',
        });
        setSelfieData('');
      } else if (screen === 'complete') {
        await updateMyProfile({ profileComplete: true });
        sessionStorage.removeItem('canact:registration-screen');
        sessionStorage.removeItem('canact:registration-mobile');
        toast('Welcome to Canact', 'success');
        router.replace('/');
        return;
      }
      const index = SCREEN_ORDER.indexOf(screen);
      setScreen(SCREEN_ORDER[Math.min(index + 1, SCREEN_ORDER.length - 1)]);
    } catch (error: any) {
      toast(error?.message ?? 'Could not save this step', 'error');
    } finally { setBusy(false); }
  };

  const goBack = async () => {
    const index = SCREEN_ORDER.indexOf(screen);
    if (index > 0) { setScreen(SCREEN_ORDER[index - 1]); return; }
    sessionStorage.removeItem('canact:registration-screen');
    sessionStorage.removeItem('canact:registration-mobile');
    await signOut();
    router.replace('/welcome');
  };

  if (loading || !user || !profile || profile.profileComplete) return <Splash message="Preparing your account…" />;

  return (
    <main className={styles.page}>
      <section className={`${styles.registerPage} ${styles[`registerScreen_${screen}`]}`}>
        <button type="button" className={styles.backButton} aria-label="Previous step" onClick={() => void goBack()}><ArrowLeft size={22} /></button>

        {screen === 'details' ? (
          <>
            <BrandArt />
            <p className={styles.eyebrow}>Let&apos;s get your basics</p>
            <RegistrationProgress screen={screen} />
            <div className={styles.registerBody}>
              <h1 className={styles.title}>Your details</h1>
              <p className={styles.subtitle}>We&apos;ll use these to create and secure your account.</p>
              <div className={styles.registerFields}>
                <div className={styles.phoneWrap}><PhoneInput country={phoneCountry} onCountryChange={setPhoneCountry} value={mobile} onChange={setMobile} required error={mobile && !isPhoneValid(phoneCountry, mobile) ? 'Enter a valid mobile number' : undefined} /></div>
              </div>
            </div>
          </>
        ) : null}

        {screen === 'name' ? (
          <>
            <RegistrationArt />
            <div className={styles.registerBody}>
              <h1 className={styles.title}>What should we call you?</h1>
              <p className={styles.subtitle}>Your real name helps build trusted connections.</p>
              <div className={styles.registerFields}>
                <AuthField icon={<UserRound />} label="First name"><input value={firstName} autoComplete="given-name" placeholder="First name" onChange={(event) => setFirstName(event.target.value)} /></AuthField>
                <AuthField icon={<UserRound />} label="Last name"><input value={lastName} autoComplete="family-name" placeholder="Last name" onChange={(event) => setLastName(event.target.value)} /></AuthField>
              </div>
              <RegistrationProgress screen={screen} />
            </div>
          </>
        ) : null}

        {screen === 'gender' ? (
          <>
            <RegistrationArt />
            <div className={styles.registerBody}>
              <h1 className={styles.title}>How do you identify?</h1>
              <p className={styles.subtitle}>This helps us personalize your experience<br />and build more relevant connections.</p>
              <div className={styles.choiceList}>
                {([['female', 'Female'], ['male', 'Male']] as const).map(([value, label]) => (
                  <button type="button" key={value} className={`${styles.choice} ${gender === value ? styles.selected : ''}`} aria-pressed={gender === value} onClick={() => setGender(value)}>
                    <span className={styles.choiceIcon}><UserRound /></span><span>{label}</span><span className={gender === value ? styles.choiceCheck : styles.choiceEmpty}>{gender === value ? <Check /> : null}</span>
                  </button>
                ))}
              </div>
              <RegistrationProgress screen={screen} />
            </div>
          </>
        ) : null}

        {screen === 'birthday' ? (
          <>
            <RegistrationArt />
            <div className={styles.registerBody}>
              <h1 className={styles.title}>When&apos;s your birthday?</h1>
              <p className={styles.subtitle}>Your age helps us create a safer,<br />more relevant experience.</p>
              <div className={styles.birthdayWheel}>
                <label><span>Day</span><select aria-label="Birth day" value={day} onChange={(event) => setDay(event.target.value)}><option value="">Day</option>{Array.from({ length: daysInMonth }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
                <label><span>Month</span><select aria-label="Birth month" value={month} onChange={(event) => setMonth(event.target.value)}><option value="">Month</option>{MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
                <label><span>Year</span><select aria-label="Birth year" value={year} onChange={(event) => setYear(event.target.value)}><option value="">Year</option>{YEARS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              </div>
              <p className={styles.privacyNote}><LockKeyhole /> Only your age will be used here — never shared.</p>
              <RegistrationProgress screen={screen} />
            </div>
          </>
        ) : null}

        {screen === 'selfie' ? (
          <>
            <RegistrationArt compact />
            <div className={styles.registerBody}>
              <h1 className={styles.title}>Verify it&apos;s really you</h1>
              <p className={styles.subtitle}>Take a live photo to verify a real person is creating this profile.<br />You will choose your public profile photo separately.</p>
              <button type="button" className={styles.selfieScan} onClick={() => setCameraOpen(true)} aria-label={selfieReady ? 'Retake verification' : 'Start verification'}>
                {selfieData ? <img src={selfieData} alt="Verification selfie preview" /> : selfieVerified ? <><ShieldCheck /><span>Identity verified</span></> : <><UserRound /><span>Tap to verify</span></>}
                <i className={styles.scanCornerA} /><i className={styles.scanCornerB} /><i className={styles.scanCornerC} /><i className={styles.scanCornerD} />
              </button>
              <div className={styles.trustPills}>
                <span><Eye size={14} /> Live camera capture</span>
                <span><ShieldCheck size={14} /> Not used as your profile photo</span>
                <span><Sparkles size={14} /> Blink &amp; liveness check</span>
              </div>
              <RegistrationProgress screen={screen} />
            </div>
          </>
        ) : null}

        {screen === 'complete' ? (
          <>
            <BrandArt />
            <div className={styles.completeGraphic} aria-hidden="true">
              <div className={styles.completeCheck}><Check /></div>
              <span><Mail /> Email added</span><span><Phone /> Phone secured</span><span><ShieldCheck /> Identity verified</span><span><UsersRound /> Safer, genuine profile</span>
            </div>
            <div className={styles.registerBody}>
              <h1 className={styles.title}>You&apos;re all set</h1>
              <p className={styles.subtitle}>Your profile is ready for trusted connections.</p>
              <RegistrationProgress screen={screen} />
              <button type="button" className={styles.reviewButton} onClick={() => setScreen('details')}>Review details</button>
            </div>
          </>
        ) : null}

        <footer className={styles.registerFooter}>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void goNext()}>
            <span>{busy ? 'Saving…' : screen === 'complete' ? 'Continue' : screen === 'selfie' && !selfieReady ? 'Verify identity' : 'Continue'}</span><span className={styles.primaryIcon}><ArrowRight /></span>
          </button>
        </footer>
      </section>
      {cameraOpen ? <SelfieVerifier onCancel={() => setCameraOpen(false)} onCapture={(dataUrl) => { setSelfieData(dataUrl); setCameraOpen(false); }} /> : null}
    </main>
  );
}
