'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Country, City } from 'country-state-city';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { PhoneInput, isPhoneValid, toE164 } from '@/components/PhoneInput';
import { Combobox, type ComboOption } from '@/components/Combobox';
import type { CountryCode } from 'libphonenumber-js';
import { BrandMark } from '@/components/Brand';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';

export default function OnboardPage() {
  const router = useRouter();
  const { user, profile, loading, updateMyProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const [mobile, setMobile] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>('IN');
  const [dob, setDob] = useState('');
  const [countryCode, setCountryCode] = useState<string>('IN');
  const [country, setCountry] = useState('India');
  const [city, setCity] = useState('');
  const [gender, setGender] = useState<'female' | 'male' | 'nonbinary' | 'other' | ''>('');

  const phoneValid = useMemo(() => isPhoneValid(phoneCountry, mobile), [phoneCountry, mobile]);

  const countryOptions: ComboOption[] = useMemo(
    () => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name, flag: c.isoCode })),
    [],
  );

  const cityOptions: ComboOption[] = useMemo(() => {
    if (!countryCode) return [];
    const cities = City.getCitiesOfCountry(countryCode) ?? [];
    // De-dupe city names within a country (some appear multiple times across states).
    const seen = new Set<string>();
    const out: ComboOption[] = [];
    for (const c of cities) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push({ value: c.name, label: c.name });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [countryCode]);

  // Hydrate from existing profile (e.g. partially filled).
  useEffect(() => {
    if (!profile) return;
    if (profile.mobile) {
      // Stored as E.164 (+91...). Strip leading '+' and dial code if present.
      const raw = String(profile.mobile).replace(/[^0-9+]/g, '');
      setMobile(raw.replace(/^\+?\d{1,3}/, ''));
    }
    if (profile.dateOfBirth) setDob(profile.dateOfBirth);
    if (profile.countryCode) {
      setCountryCode(profile.countryCode);
      const c = Country.getCountryByCode(profile.countryCode);
      if (c) setCountry(c.name);
      else if (profile.country) setCountry(profile.country);
    } else if (profile.country) {
      const match = Country.getAllCountries().find((c) => c.name.toLowerCase() === profile.country!.toLowerCase());
      if (match) { setCountryCode(match.isoCode); setCountry(match.name); }
      else setCountry(profile.country);
    }
    if (profile.city) setCity(profile.city);
    if (profile.gender) setGender(profile.gender);
  }, [profile]);

  // Guards
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/welcome');
    else if (profile?.profileComplete) router.replace('/feed');
  }, [user, profile, loading, router]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  // Profile may not have been seeded yet (RTDB latency / first-time sign-in).
  // Fall back to Google profile data so the form is usable immediately.
  const displayFirst = profile?.firstName || profile?.fullName?.split(' ')[0]
    || user.displayName?.split(' ')[0] || 'there';

  return (
    <div className="min-h-screen flex items-start md:items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3"><BrandMark size={72} /></div>
          <h1 className="text-2xl font-extrabold text-ink">Welcome, {displayFirst}!</h1>
          <p className="mt-1 text-sm text-muted">Just a few details to finish setting up your profile.</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!isPhoneValid(phoneCountry, mobile)) return toast('Please enter a valid mobile number', 'error');
            if (!country.trim() || !countryCode) return toast('Country is required', 'error');
            if (!city.trim()) return toast('City is required', 'error');
            if (!dob) return toast('Date of birth is required', 'error');

            setBusy(true);
            try {
              await updateMyProfile({
                mobile: toE164(phoneCountry, mobile),
                dateOfBirth: dob,
                country: country.trim(),
                countryCode,
                city: city.trim(),
                gender: gender || undefined,
                profileComplete: true,
              });
              toast('Welcome to Canact!', 'success');
              router.replace('/feed');
            } catch (err: any) {
              toast(err?.message ?? 'Could not save profile', 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          <PhoneInput
            country={phoneCountry}
            onCountryChange={setPhoneCountry}
            value={mobile}
            onChange={setMobile}
            required
            error={mobile && !phoneValid ? 'Enter a valid number for the selected country' : undefined}
          />
          <Input
            label="Date of birth"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
          <Combobox
            label="Country"
            required
            value={countryCode}
            options={countryOptions}
            placeholder="Select country"
            onChange={(v, opt) => {
              setCountryCode(v);
              setCountry(opt?.label ?? '');
              setCity('');
            }}
          />
          <Combobox
            label="City"
            required
            value={city}
            options={cityOptions}
            placeholder={countryCode ? 'Select city' : 'Select a country first'}
            disabled={!countryCode || cityOptions.length === 0}
            emptyText={countryCode ? 'No cities found' : 'Select a country first'}
            onChange={(v) => setCity(v)}
          />
          <Select label="Gender (optional)" value={gender} onChange={(e) => setGender(e.target.value as any)}>
            <option value="">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="nonbinary">Non-binary</option>
            <option value="other">Other</option>
          </Select>

          <Button type="submit" full size="lg" loading={busy} className="mt-2">Continue</Button>

          <button
            type="button"
            onClick={async () => { await signOut(); router.replace('/welcome'); }}
            className="mt-3 block w-full text-center text-xs text-ink/55 hover:text-brand"
          >
            Use a different Google account
          </button>
        </form>
      </div>
    </div>
  );
}
