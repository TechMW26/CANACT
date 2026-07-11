'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CountryCode } from 'libphonenumber-js';
import {
  ArrowLeft, ArrowRight, CalendarDays, Camera, Check, LockKeyhole, Mail,
  MapPin, Phone, ShieldCheck, Sparkles, UserRound, UsersRound,
} from 'lucide-react';
import { CameraCapture } from '@/components/CameraCapture';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { PhoneInput, isPhoneValid, splitStoredPhone, toE164 } from '@/components/PhoneInput';
import { Splash } from '@/components/Splash';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { uploadMedia } from '@/lib/uploadMedia';
import styles from '@/components/AuthFlow.module.css';

type CountryCityApi = typeof import('country-state-city');
type Gender = 'female' | 'male' | 'nonbinary' | 'other';

const STEP_COPY = [
  { eyebrow: 'Let’s get your basics', title: 'Your details', subtitle: 'We’ll use these to create and secure your account.' },
  { eyebrow: 'Your identity', title: 'What should we call you?', subtitle: 'Your real name helps build trusted connections.' },
  { eyebrow: 'A little about you', title: 'How do you identify?', subtitle: 'This helps us personalize your experience and build more relevant connections.' },
  { eyebrow: 'Your special day', title: 'When’s your birthday?', subtitle: 'Your age helps us create a safer, more relevant experience.' },
  { eyebrow: 'Genuine connections', title: 'Verify with a selfie', subtitle: 'This helps keep Canact safe, genuine, and free from fake profiles.' },
  { eyebrow: 'Your community', title: 'Where are you based?', subtitle: 'Your location helps you discover relevant people and activity nearby.' },
] as const;

function Progress({ step }: { step: number }) {
  return (
    <div className={styles.progressWrap} aria-label={`Step ${step} of 7`}>
      <div className={styles.progress}>{Array.from({ length: 7 }, (_, index) => <span key={index} className={index < step ? styles.active : ''} />)}</div>
      <div className={styles.progressLabel}>Step {step} <b>of</b> 7</div>
    </div>
  );
}

function AuthField({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <label className={styles.field}><span aria-hidden="true">{icon}</span><span className={styles.fieldText}><span>{label}</span>{children}</span></label>;
}

export default function OnboardPage() {
  const router = useRouter();
  const { user, profile, loading, updateMyProfile, signOut } = useAuth();
  const hydrated = useRef(false);
  const [step, setStep] = useState(2);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('IN');
  const [mobile, setMobile] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [dob, setDob] = useState('');
  const [selfieData, setSelfieData] = useState('');
  const [countryCode, setCountryCode] = useState('IN');
  const [country, setCountry] = useState('India');
  const [city, setCity] = useState('');
  const [countryCityApi, setCountryCityApi] = useState<CountryCityApi | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/welcome');
    else if (profile?.profileComplete) router.replace('/');
  }, [loading, profile?.profileComplete, router, user]);

  useEffect(() => {
    let cancelled = false;
    import('country-state-city').then((module) => { if (!cancelled) setCountryCityApi(module); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user || !profile || hydrated.current) return;
    hydrated.current = true;
    const fallbackName = (profile.fullName || user.displayName || '').trim().split(/\s+/).filter(Boolean);
    setFirstName(profile.firstName || fallbackName[0] || '');
    setLastName(profile.lastName || (fallbackName.length > 1 ? fallbackName[fallbackName.length - 1] : ''));
    const parsedPhone = splitStoredPhone(profile.mobile, (profile.countryCode as CountryCode) || 'IN');
    setPhoneCountry(parsedPhone.country);
    setMobile(parsedPhone.national);
    setGender(profile.gender || '');
    setDob(profile.dateOfBirth || '');
    setCountryCode(profile.countryCode || 'IN');
    setCountry(profile.country || 'India');
    setCity(profile.city || '');
  }, [profile, user]);

  const countryOptions: ComboOption[] = useMemo(() => countryCityApi
    ? countryCityApi.Country.getAllCountries().map((item) => ({ value: item.isoCode, label: item.name, flag: item.isoCode }))
    : [{ value: countryCode, label: country || countryCode, flag: countryCode }], [country, countryCityApi, countryCode]);

  const cityOptions: ComboOption[] = useMemo(() => {
    if (!countryCityApi || !countryCode) return city ? [{ value: city, label: city }] : [];
    const names = new Set<string>();
    return (countryCityApi.City.getCitiesOfCountry(countryCode) || [])
      .filter((item) => !names.has(item.name) && !!names.add(item.name))
      .map((item) => ({ value: item.name, label: item.name }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [city, countryCityApi, countryCode]);

  const validate = () => {
    if (step === 2 && !isPhoneValid(phoneCountry, mobile)) return 'Enter a valid mobile number';
    if (step === 3 && !firstName.trim()) return 'First name is required';
    if (step === 4 && !gender) return 'Choose how you identify';
    if (step === 5 && !dob) return 'Date of birth is required';
    if (step === 6 && !selfieData && !profile?.photoURL && !user?.photoURL) return 'Take a selfie to continue';
    if (step === 7 && (!countryCode || !country || !city)) return 'Choose your country and city';
    return '';
  };

  const finish = async () => {
    const error = validate();
    if (error) { toast(error, 'error'); return; }
    if (!user || !profile) return;
    setBusy(true);
    try {
      let photoURL = profile.photoURL || user.photoURL || '';
      if (selfieData) photoURL = (await uploadMedia(selfieData, { kind: 'avatar', uid: user.uid })).url;
      const cleanFirst = firstName.trim();
      const cleanLast = lastName.trim();
      await updateMyProfile({
        email: user.email || profile.email,
        mobile: toE164(phoneCountry, mobile),
        firstName: cleanFirst,
        lastName: cleanLast || undefined,
        fullName: [cleanFirst, cleanLast].filter(Boolean).join(' '),
        gender: gender || undefined,
        dateOfBirth: dob,
        photoURL,
        countryCode,
        country,
        city,
        profileComplete: true,
      });
      toast('Welcome to Canact', 'success');
      router.replace('/');
    } catch (error: any) {
      toast(error?.message ?? 'Could not complete registration', 'error');
    } finally { setBusy(false); }
  };

  const next = () => {
    const error = validate();
    if (error) { toast(error, 'error'); return; }
    if (step === 7) void finish();
    else setStep((value) => Math.min(7, value + 1));
  };

  const back = () => {
    if (step > 2) setStep((value) => value - 1);
    else void signOut().then(() => router.replace('/welcome'));
  };

  if (loading || !user || !profile || profile.profileComplete) return <Splash message="Preparing your account…" />;

  const copy = STEP_COPY[step - 2];
  const selfieSrc = selfieData || profile.photoURL || user.photoURL || '';

  return (
    <main className={styles.page}>
      <section className={styles.registerPage}>
        <button type="button" className={styles.backButton} aria-label="Previous step" onClick={back}><ArrowLeft size={22} /></button>
        <Image className={styles.registerBrand} src="/canact-brand.png" alt="Canact" width={1254} height={1254} priority />
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <Progress step={step} />
        <div className={styles.registerBody}>
          <h1 className={styles.title}>{copy.title}</h1>
          <p className={styles.subtitle}>{copy.subtitle}</p>

          {step === 2 ? (
            <div className={styles.registerFields}>
              <AuthField icon={<Mail />} label="Email address"><input value={user.email || ''} readOnly aria-label="Email address" /></AuthField>
              <div className={styles.phoneWrap}>
                <PhoneInput country={phoneCountry} onCountryChange={setPhoneCountry} value={mobile} onChange={setMobile} required error={mobile && !isPhoneValid(phoneCountry, mobile) ? 'Enter a valid mobile number' : undefined} />
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className={styles.registerFields}>
              <AuthField icon={<UserRound />} label="First name"><input value={firstName} autoComplete="given-name" placeholder="First name" onChange={(event) => setFirstName(event.target.value)} /></AuthField>
              <AuthField icon={<UsersRound />} label="Last name"><input value={lastName} autoComplete="family-name" placeholder="Last name" onChange={(event) => setLastName(event.target.value)} /></AuthField>
            </div>
          ) : null}

          {step === 4 ? (
            <div className={styles.choiceList}>
              {([['female', 'Female'], ['male', 'Male'], ['nonbinary', 'Non-binary'], ['other', 'Prefer to self-describe']] as const).map(([value, label]) => (
                <button type="button" key={value} className={`${styles.choice} ${gender === value ? styles.selected : ''}`} onClick={() => setGender(value)}>
                  <span className={styles.choiceIcon}><UserRound /></span><span>{label}</span><span className={gender === value ? styles.choiceCheck : ''}>{gender === value ? <Check /> : null}</span>
                </button>
              ))}
            </div>
          ) : null}

          {step === 5 ? (
            <div className={styles.birthdayCard}>
              <CalendarDays />
              <input type="date" aria-label="Date of birth" value={dob} max={new Date().toISOString().slice(0, 10)} onChange={(event) => setDob(event.target.value)} />
              <p className={styles.privacyNote}><LockKeyhole /> Only your age and zodiac insight will be used here.</p>
            </div>
          ) : null}

          {step === 6 ? (
            <div className={styles.selfieCard}>
              <div className={styles.selfiePreview}>{selfieSrc ? <img src={selfieSrc} alt="Your selfie" /> : <Camera />}</div>
              <button type="button" className={styles.captureButton} onClick={() => setCameraOpen(true)}>{selfieSrc ? 'Retake selfie' : 'Open camera'}</button>
              <div className={styles.trustRow}><span><ShieldCheck /> Private</span><span><Sparkles /> Instant</span><span><Check /> Secure</span></div>
            </div>
          ) : null}

          {step === 7 ? (
            <div className={styles.locationCard}>
              <Combobox label="Country" value={countryCode} options={countryOptions} placeholder="Select country" onChange={(value, option) => { setCountryCode(value); setCountry(option?.label || ''); setCity(''); }} />
              <Combobox label="City" value={city} options={cityOptions} placeholder={countryCode ? 'Select city' : 'Select a country first'} disabled={!countryCode || !cityOptions.length} emptyText="No cities found" onChange={setCity} />
              <p className={styles.privacyNote}><MapPin /> Used to personalize nearby activity.</p>
            </div>
          ) : null}
        </div>
        <footer className={styles.registerFooter}>
          <button type="button" className={styles.primaryButton} disabled={busy} onClick={next}>
            <span>{busy ? 'Saving…' : step === 7 ? 'Finish setup' : step === 6 ? 'Use this selfie' : 'Continue'}</span><span className={styles.primaryIcon}><ArrowRight /></span>
          </button>
        </footer>
      </section>
      {cameraOpen ? <CameraCapture defaultFacing="user" allowVideo={false} allowPhoto initialMode="photo" onCancel={() => setCameraOpen(false)} onCapture={(urls) => { setSelfieData(urls[0] || ''); setCameraOpen(false); }} /> : null}
    </main>
  );
}
