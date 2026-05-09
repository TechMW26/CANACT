'use client';
import { useEffect, useMemo, useState } from 'react';
import type { CountryCode } from 'libphonenumber-js';
import { Button } from '@/components/Button';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { Input, Select } from '@/components/Input';
import { PhoneInput, isPhoneValid, splitStoredPhone, toE164 } from '@/components/PhoneInput';
import { Sheet } from '@/components/Sheet';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';

type StepId = 'name' | 'phone' | 'dob' | 'country' | 'city' | 'gender';
type CountryCityApi = typeof import('country-state-city');

const STEPS: { id: StepId; title: string }[] = [
  { id: 'name', title: 'Name' },
  { id: 'phone', title: 'Phone' },
  { id: 'dob', title: 'Birth date' },
  { id: 'country', title: 'Country' },
  { id: 'city', title: 'City' },
  { id: 'gender', title: 'Gender' },
];

export function ProfileCompletionPrompt() {
  const { user, profile, updateMyProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobile, setMobile] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('IN');
  const [dob, setDob] = useState('');
  const [countryCode, setCountryCode] = useState('IN');
  const [country, setCountry] = useState('India');
  const [city, setCity] = useState('');
  const [gender, setGender] = useState<'female' | 'male' | 'nonbinary' | 'other' | ''>('');
  const [countryCityApi, setCountryCityApi] = useState<CountryCityApi | null>(null);

  const incomplete = !!profile && profile.profileComplete === false;
  const lockedIdentity = !!profile?.profileVerified;
  const step = STEPS[stepIndex];
  const phoneValid = useMemo(() => isPhoneValid(phoneCountry, mobile), [phoneCountry, mobile]);
  useEffect(() => {
    if (!incomplete) return;
    let cancelled = false;
    import('country-state-city')
      .then((module) => { if (!cancelled) setCountryCityApi(module); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [incomplete]);

  const countryOptions: ComboOption[] = useMemo(
    () => countryCityApi
      ? countryCityApi.Country.getAllCountries().map((item) => ({ value: item.isoCode, label: item.name, flag: item.isoCode }))
      : countryCode && country
        ? [{ value: countryCode, label: country, flag: countryCode }]
        : [],
    [country, countryCityApi, countryCode],
  );
  const cityOptions: ComboOption[] = useMemo(() => {
    if (!countryCityApi || !countryCode) return city ? [{ value: city, label: city }] : [];
    const cities = countryCityApi.City.getCitiesOfCountry(countryCode) ?? [];
    const seen = new Set<string>();
    const out: ComboOption[] = [];
    for (const item of cities) {
      if (seen.has(item.name)) continue;
      seen.add(item.name);
      out.push({ value: item.name, label: item.name });
    }
    out.sort((left, right) => left.label.localeCompare(right.label));
    return out;
  }, [city, countryCityApi, countryCode]);

  useEffect(() => {
    const baseName = (profile?.fullName || user?.displayName || user?.email?.split('@')[0] || '').trim();
    const nameParts = baseName.split(/\s+/).filter(Boolean);
    setFirstName(profile?.firstName || nameParts[0] || '');
    setLastName(profile?.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''));
    const parsed = splitStoredPhone(profile?.mobile, (profile?.countryCode as CountryCode) || 'IN');
    setPhoneCountry(parsed.country);
    setMobile(parsed.national);
    setDob(profile?.dateOfBirth || '');
    if (profile?.countryCode) {
      setCountryCode(profile.countryCode);
      setCountry(countryCityApi?.Country.getCountryByCode(profile.countryCode)?.name || profile.country || '');
    } else if (profile?.country) {
      const match = countryCityApi?.Country.getAllCountries().find((item) => item.name.toLowerCase() === profile.country!.toLowerCase());
      setCountryCode(match?.isoCode || '');
      setCountry(match?.name || profile.country);
    }
    setCity(profile?.city || '');
    setGender(profile?.gender || '');
  }, [countryCityApi, profile, user?.displayName, user?.email]);

  useEffect(() => {
    if (!incomplete) setOpen(false);
  }, [incomplete]);

  if (!incomplete) return null;

  const validateCurrentStep = () => {
    if (step.id === 'name' && !lockedIdentity && !firstName.trim()) return 'First name is required';
    if (step.id === 'phone' && !phoneValid) return 'Enter a valid mobile number';
    if (step.id === 'dob' && !dob) return 'Date of birth is required';
    if (step.id === 'country' && (!country.trim() || !countryCode)) return 'Country is required';
    if (step.id === 'city' && !city.trim()) return 'City is required';
    return '';
  };

  const next = () => {
    const error = validateCurrentStep();
    if (error) { toast(error, 'error'); return; }
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const finish = async () => {
    const error = validateCurrentStep();
    if (error) { toast(error, 'error'); return; }
    setBusy(true);
    try {
      const cleanFirst = firstName.trim();
      const cleanLast = lastName.trim();
      const fullName = [cleanFirst, cleanLast].filter(Boolean).join(' ').trim() || profile?.fullName || 'Canact user';
      await updateMyProfile({
        firstName: lockedIdentity ? undefined : cleanFirst || undefined,
        lastName: lockedIdentity ? undefined : cleanLast || undefined,
        fullName: lockedIdentity ? undefined : fullName,
        mobile: toE164(phoneCountry, mobile),
        dateOfBirth: dob,
        country: country.trim(),
        countryCode,
        city: city.trim(),
        gender: gender || undefined,
        profileComplete: true,
      });
      toast('Profile completed', 'success');
      setOpen(false);
    } catch (err: any) {
      toast(err?.message ?? 'Could not complete profile', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-x-4 bottom-[calc(var(--canact-floating-bottom-clearance)+10px)] z-[85] mx-auto max-w-md rounded-[24px] border border-[#F1D7DC] bg-white/95 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-extrabold text-ink">Complete your profile</div>
            <div className="mt-0.5 truncate text-xs font-semibold text-ink/50">Finish the basics to unlock your full profile.</div>
          </div>
          <Button size="sm" onClick={() => { setStepIndex(0); setOpen(true); }}>Complete</Button>
        </div>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title="Complete profile">
        <div className="pb-4">
          <div className="mb-4 flex items-center gap-2">
            {STEPS.map((item, index) => (
              <span key={item.id} className={`h-1.5 flex-1 rounded-full ${index <= stepIndex ? 'bg-brand' : 'bg-ink/10'}`} />
            ))}
          </div>
          <div className="mb-5">
            <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-brand">{stepIndex + 1} of {STEPS.length}</div>
            <h3 className="mt-1 text-2xl font-black text-ink">{step.title}</h3>
          </div>

          {step.id === 'name' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={lockedIdentity} autoFocus />
              <Input label="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} disabled={lockedIdentity} />
            </div>
          ) : null}

          {step.id === 'phone' ? (
            <PhoneInput
              country={phoneCountry}
              onCountryChange={setPhoneCountry}
              value={mobile}
              onChange={setMobile}
              required
              error={mobile && !phoneValid ? 'Enter a valid number for the selected country' : undefined}
            />
          ) : null}

          {step.id === 'dob' ? (
            <Input label="Date of birth" type="date" value={dob} onChange={(event) => setDob(event.target.value)} required autoFocus />
          ) : null}

          {step.id === 'country' ? (
            <Combobox
              label="Country"
              required
              value={countryCode}
              options={countryOptions}
              placeholder="Select country"
              onChange={(value, option) => {
                setCountryCode(value);
                setCountry(option?.label ?? '');
                setCity('');
              }}
            />
          ) : null}

          {step.id === 'city' ? (
            <Combobox
              label="City"
              required
              value={city}
              options={cityOptions}
              placeholder={countryCode ? 'Select city' : 'Select a country first'}
              disabled={!countryCode || cityOptions.length === 0}
              emptyText={countryCode ? 'No cities found' : 'Select a country first'}
              onChange={(value) => setCity(value)}
            />
          ) : null}

          {step.id === 'gender' ? (
            <Select label="Gender (optional)" value={gender} onChange={(event) => setGender(event.target.value as any)} autoFocus>
              <option value="">Prefer not to say</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="nonbinary">Non-binary</option>
              <option value="other">Other</option>
            </Select>
          ) : null}

          <div className="mt-6 flex gap-2">
            <Button variant="ghost" full size="lg" disabled={stepIndex === 0 || busy} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>Back</Button>
            {stepIndex === STEPS.length - 1 ? (
              <Button full size="lg" loading={busy} onClick={finish}>Finish</Button>
            ) : (
              <Button full size="lg" onClick={next}>Next</Button>
            )}
          </div>
        </div>
      </Sheet>
    </>
  );
}
