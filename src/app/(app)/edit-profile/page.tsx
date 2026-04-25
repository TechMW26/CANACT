'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Country, City } from 'country-state-city';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { PhoneInput, isPhoneValid, toE164 } from '@/components/PhoneInput';
import type { CountryCode } from 'libphonenumber-js';
import { Avatar } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';
import { Camera, Lock, Trash2, UserIcon, MapPin, Phone, Sparkles } from '@/components/icons';

const MAX_PHOTO_SIDE = 512;
const MAX_BIO = 300;

/** Resize an image File into a square data URL no larger than MAX_PHOTO_SIDE.
 * RTDB has tight per-key size limits, so we never store the original. */
async function resizeImage(file: File): Promise<string> {
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const u = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); res(i); };
    i.onerror = (e) => { URL.revokeObjectURL(u); rej(e); };
    i.src = u;
  });
  const side = Math.min(img.width, img.height);
  const sx = (img.width - side) / 2;
  const sy = (img.height - side) / 2;
  const target = Math.min(MAX_PHOTO_SIDE, side);
  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export default function EditProfilePage() {
  const { profile, updateMyProfile } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState(profile?.photoURL ?? '');
  const [firstName, setFirstName] = useState(profile?.firstName ?? '');
  const [lastName, setLastName] = useState(profile?.lastName ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(
    (profile?.countryCode as CountryCode) || 'IN',
  );
  const [mobile, setMobile] = useState(() => {
    if (!profile?.mobile) return '';
    const raw = String(profile.mobile).replace(/[^0-9+]/g, '');
    return raw.replace(/^\+?\d{1,3}/, '');
  });
  const [countryCode, setCountryCode] = useState(profile?.countryCode ?? 'IN');
  const [country, setCountry] = useState(profile?.country ?? 'India');
  const [city, setCity] = useState(profile?.city ?? '');
  const [busy, setBusy] = useState(false);

  // Hydrate when profile arrives later
  useEffect(() => {
    if (!profile) return;
    if (!photo && profile.photoURL) setPhoto(profile.photoURL);
  }, [profile, photo]);

  const countryOptions: ComboOption[] = useMemo(
    () => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name, flag: c.isoCode })),
    [],
  );
  const cityOptions: ComboOption[] = useMemo(() => {
    if (!countryCode) return [];
    const cities = City.getCitiesOfCountry(countryCode) ?? [];
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

  if (!profile) return null;
  const locked = !!profile.profileVerified;

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Please select an image', 'error');
    try {
      const dataUrl = await resizeImage(f);
      setPhoto(dataUrl);
    } catch {
      toast('Could not read image', 'error');
    }
  };

  const onSave = async () => {
    if (mobile && !isPhoneValid(phoneCountry, mobile)) {
      return toast('Mobile number is invalid for the selected country', 'error');
    }
    setBusy(true);
    try {
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || profile.fullName;
      await updateMyProfile({
        photoURL: photo || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        fullName,
        bio: bio || undefined,
        mobile: mobile ? toE164(phoneCountry, mobile) : undefined,
        country: country || undefined,
        countryCode: countryCode || undefined,
        city: city || undefined,
      });
      toast('Profile updated', 'success');
      router.back();
    } catch (e: any) {
      toast(e?.message ?? 'Failed to save', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-10">
      {/* Photo */}
      <Card className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="relative">
          <span key={photo} className="block">
            <Avatar src={photo} name={profile.fullName} size={96} />
          </span>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Change photo"
            className="absolute -bottom-1 -right-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white shadow-[0_8px_18px_-8px_rgba(200,16,46,0.55)] ring-4 ring-white"
          >
            <Camera size={16} />
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-lg font-extrabold text-ink">{profile.fullName}</h2>
          <p className="mt-0.5 text-sm text-muted">JPG or PNG. Auto-cropped to square, resized to 512px.</p>
          <div className="mt-3 inline-flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Camera size={14} className="mr-1" /> Change photo
            </Button>
            {photo ? (
              <Button size="sm" variant="ghost" onClick={() => setPhoto('')}>
                <Trash2 size={14} className="mr-1" /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Identity */}
      <Card>
        <SectionHeading icon={<UserIcon size={14} />}>Identity</SectionHeading>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={locked} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={locked} />
        </div>
        {locked ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
            <Lock size={12} /> Name is locked after DigiLocker verification.
          </div>
        ) : null}
      </Card>

      {/* About */}
      <Card>
        <SectionHeading icon={<Sparkles size={14} />}>About</SectionHeading>
        <Textarea
          className="mt-3"
          label={`Bio (${bio.length}/${MAX_BIO})`}
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
          placeholder="A few words about you…"
        />
      </Card>

      {/* Contact */}
      <Card>
        <SectionHeading icon={<Phone size={14} />}>Contact</SectionHeading>
        <div className="mt-3 space-y-3">
          <PhoneInput
            label="Mobile number"
            country={phoneCountry}
            onCountryChange={setPhoneCountry}
            value={mobile}
            onChange={setMobile}
          />
          <Input label="Email" value={profile.email ?? ''} disabled hint="Linked to your Google account" />
        </div>
      </Card>

      {/* Location */}
      <Card>
        <SectionHeading icon={<MapPin size={14} />}>Location</SectionHeading>
        <div className="mt-3 space-y-3">
          <Combobox
            label="Country"
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
            value={city}
            options={cityOptions}
            placeholder={countryCode ? 'Select city' : 'Select a country first'}
            disabled={!countryCode || cityOptions.length === 0}
            emptyText={countryCode ? 'No cities found' : 'Select a country first'}
            onChange={(v) => setCity(v)}
          />
          {locked ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <Lock size={12} /> Address is locked after DigiLocker verification.
            </div>
          ) : null}
        </div>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-3 z-10 mx-auto max-w-2xl">
        <div className="flex gap-2 rounded-2xl bg-white/95 p-2 shadow-[0_18px_44px_-22px_rgba(10,10,10,0.32)] ring-1 ring-line backdrop-blur">
          <Button variant="ghost" full size="lg" onClick={() => router.back()}>Cancel</Button>
          <Button full size="lg" loading={busy} onClick={onSave}>Save changes</Button>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-brand-light px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-brand">
      {icon}
      {children}
    </div>
  );
}
