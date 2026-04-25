'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { BrandMark } from '@/components/Brand';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';

export default function OnboardPage() {
  const router = useRouter();
  const { user, profile, loading, updateMyProfile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const [mobile, setMobile] = useState('');
  const [dob, setDob] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('India');
  const [gender, setGender] = useState<'female' | 'male' | 'nonbinary' | 'other' | ''>('');

  // Hydrate from existing profile (e.g. partially filled).
  useEffect(() => {
    if (!profile) return;
    if (profile.mobile) setMobile(profile.mobile);
    if (profile.dateOfBirth) setDob(profile.dateOfBirth);
    if (profile.city) setCity(profile.city);
    if (profile.country) setCountry(profile.country);
    if (profile.gender) setGender(profile.gender);
  }, [profile]);

  // Guards
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/welcome');
    else if (profile?.profileComplete) router.replace('/feed');
  }, [user, profile, loading, router]);

  if (!user || !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-start md:items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3"><BrandMark size={72} /></div>
          <h1 className="text-2xl font-extrabold text-ink">Welcome, {profile.firstName || profile.fullName.split(' ')[0]}!</h1>
          <p className="mt-1 text-sm text-muted">Just a few details to finish setting up your profile.</p>
        </div>

        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const phone = mobile.replace(/[^0-9]/g, '');
            if (phone.length < 7) return toast('Please enter a valid mobile number', 'error');
            if (!city.trim()) return toast('City is required', 'error');
            if (!dob) return toast('Date of birth is required', 'error');

            setBusy(true);
            try {
              await updateMyProfile({
                mobile: phone,
                dateOfBirth: dob,
                city: city.trim(),
                country: country.trim() || undefined,
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
          <Input
            label="Mobile number"
            inputMode="tel"
            autoComplete="tel"
            placeholder="e.g. 9876543210"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            required
          />
          <Input
            label="Date of birth"
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} required />
            <Input label="Country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
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
