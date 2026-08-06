'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Combobox, type ComboOption } from '@/components/Combobox';
import { PhoneInput, isPhoneValid, splitStoredPhone, toE164 } from '@/components/PhoneInput';
import type { CountryCode } from 'libphonenumber-js';
import { Avatar } from '@/components/Avatar';
import { SelfieVerifier } from '@/components/SelfieVerifier';
import { useAuth } from '@/lib/auth';
import { toast } from '@/components/Toaster';
import { uploadMedia } from '@/lib/uploadMedia';
import { Camera, Lock, Trash2 } from '@/components/icons';

const MAX_BIO = 300;
type CountryCityApi = typeof import('country-state-city');

export default function EditProfilePage() {
  const { user, profile, updateMyProfile } = useAuth();
  const router = useRouter();
  const coverFileRef = useRef<HTMLInputElement>(null);
  const displayName = (profile?.fullName || user?.displayName || user?.email?.split('@')[0] || '').trim();
  const displayNameParts = displayName.split(/\s+/).filter(Boolean);
  const fallbackFirstName = displayNameParts[0] || '';
  const fallbackLastName = displayNameParts.length > 1 ? displayNameParts[displayNameParts.length - 1] : '';
  const initialPhone = splitStoredPhone(profile?.mobile, (profile?.countryCode as CountryCode) || 'IN');
  const [photo, setPhoto] = useState(profile?.photoURL ?? user?.photoURL ?? '');
  const [coverPhoto, setCoverPhoto] = useState(profile?.coverPhoto ?? '');
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [firstName, setFirstName] = useState(profile?.firstName ?? fallbackFirstName);
  const [lastName, setLastName] = useState(profile?.lastName ?? fallbackLastName);
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(initialPhone.country);
  const [mobile, setMobile] = useState(initialPhone.national);
  const [countryCode, setCountryCode] = useState(profile?.countryCode ?? 'IN');
  const [country, setCountry] = useState(profile?.country ?? 'India');
  const [city, setCity] = useState(profile?.city ?? '');
  const [busy, setBusy] = useState(false);
  const [countryCityApi, setCountryCityApi] = useState<CountryCityApi | null>(null);

  useEffect(() => {
    let cancelled = false;
    import('country-state-city')
      .then((module) => { if (!cancelled) setCountryCityApi(module); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Hydrate when profile arrives later
  useEffect(() => {
    if (!profile) return;
    if (!photo) setPhoto(profile.photoURL || user?.photoURL || '');
    if (!coverPhoto) setCoverPhoto(profile.coverPhoto || '');
    if (!firstName) setFirstName(profile.firstName || fallbackFirstName);
    if (!lastName) setLastName(profile.lastName || fallbackLastName);
    if (!bio && profile.bio) setBio(profile.bio);
    if (!countryCode && profile.countryCode) setCountryCode(profile.countryCode);
    if (!country && profile.country) setCountry(profile.country);
    if (!city && profile.city) setCity(profile.city);
    if (!mobile && profile.mobile) {
      const parsed = splitStoredPhone(profile.mobile, (profile.countryCode as CountryCode) || 'IN');
      setPhoneCountry(parsed.country);
      setMobile(parsed.national);
    }
  }, [bio, city, country, countryCode, fallbackFirstName, fallbackLastName, firstName, lastName, mobile, photo, profile, user?.photoURL]);

  const countryOptions: ComboOption[] = useMemo(
    () => countryCityApi
      ? countryCityApi.Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name, flag: c.isoCode }))
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
    for (const c of cities) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      out.push({ value: c.name, label: c.name });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, [city, countryCityApi, countryCode]);

  if (!profile) return null;
  const locked = !!profile.profileVerified;

  const saveVerifiedSelfie = async (dataUrl: string) => {
    if (!profile) return;
    const previousUrl = photo;
    setPhotoBusy(true);
    try {
      const { url } = await uploadMedia(dataUrl, { kind: 'avatar', uid: profile.uid });
      await updateMyProfile({ photoURL: url });
      setPhoto(url);
      if (previousUrl && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try {
          navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls: [previousUrl] });
        } catch { /* ignore */ }
      }
      setSelfieOpen(false);
      toast('Profile photo updated', 'success');
    } catch (err: any) {
      toast(err?.message ?? 'Could not upload image', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onCoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Please select an image', 'error');
    const previousUrl = coverPhoto;
    setCoverBusy(true);
    try {
      const blob = new Blob([f], { type: f.type });
      const { url } = await uploadMedia(blob, { kind: 'cover', uid: profile.uid });
      await updateMyProfile({ coverPhoto: url });
      setCoverPhoto(url);
      if (previousUrl && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try { navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls: [previousUrl] }); } catch { /* ignore */ }
      }
      toast('Cover photo updated', 'success');
    } catch (err: any) {
      toast(err?.message ?? 'Could not upload cover', 'error');
    } finally {
      setCoverBusy(false);
      if (coverFileRef.current) coverFileRef.current.value = '';
    }
  };

  const removeCover = async () => {
    const previousUrl = coverPhoto;
    setCoverPhoto('');
    setCoverBusy(true);
    try {
      await updateMyProfile({ coverPhoto: '' });
      if (previousUrl && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try { navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls: [previousUrl] }); } catch { /* ignore */ }
      }
      toast('Cover photo removed', 'success');
    } catch (err: any) {
      setCoverPhoto(previousUrl);
      toast(err?.message ?? 'Could not remove cover', 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  const removePhoto = async () => {
    const previousUrl = photo;
    setPhoto('');
    setPhotoBusy(true);
    try {
      await updateMyProfile({ photoURL: '' });
      if (previousUrl && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try { navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls: [previousUrl] }); } catch { /* ignore */ }
      }
      toast('Profile photo removed', 'success');
    } catch (err: any) {
      setPhoto(previousUrl);
      toast(err?.message ?? 'Could not remove photo', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const onSave = async () => {
    if (mobile && !isPhoneValid(phoneCountry, mobile)) {
      return toast('Mobile number is invalid for the selected country', 'error');
    }
    setBusy(true);
    try {
      const fullName = [firstName, lastName].filter(Boolean).join(' ').trim() || profile.fullName || displayName || 'Canact user';
      await updateMyProfile({
        photoURL: photo,
        coverPhoto: coverPhoto || undefined,
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
    <div className="mx-auto max-w-2xl space-y-4 px-4 pb-10" style={{ paddingTop: 'calc(var(--canact-header-top-inset, 0px) + var(--canact-header-offset, 0px) + 92px)' }}>
      {/* Photo */}
      <Card className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="relative">
          <span key={photo} className="block">
            <Avatar src={photo} name={profile.fullName || displayName || 'Canact user'} size={96} />
          </span>
          <button
            type="button"
            onClick={() => setSelfieOpen(true)}
            aria-label="Change photo"
            className="absolute -bottom-1 -right-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white ring-4 ring-white"
          >
            <Camera size={16} />
          </button>
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-lg font-extrabold text-ink">{profile.fullName || displayName || 'Canact user'}</h2>
          <p className="mt-0.5 text-sm text-muted">Take a live selfie so your profile photo represents you.</p>
          <div className="mt-3 inline-flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" variant="outline" onClick={() => setSelfieOpen(true)} loading={photoBusy}>
              <Camera size={14} className="mr-1" /> Take new selfie
            </Button>
            {photo ? (
              <Button size="sm" variant="ghost" onClick={removePhoto} loading={photoBusy}>
                <Trash2 size={14} className="mr-1" /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Cover Photo */}
      <Card className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <div className="relative h-24 w-full overflow-hidden rounded-xl bg-[radial-gradient(circle_at_20%_10%,#9fd0b3,transparent_35%),linear-gradient(135deg,#164d3e,#68a48d)] sm:w-40">
          {coverPhoto ? <img src={coverPhoto} alt="" className="h-full w-full object-cover" /> : null}
          <button
            type="button"
            onClick={() => coverFileRef.current?.click()}
            aria-label="Change cover"
            className="absolute bottom-2 right-2 inline-flex h-8 items-center gap-1 rounded-full bg-white px-2.5 text-xs font-semibold text-ink"
          >
            <Camera size={13} /> Change
          </button>
          <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={onCoverPick} />
        </div>
        <div className="flex-1 text-center sm:text-left">
          <h2 className="text-lg font-extrabold text-ink">Cover photo</h2>
          <p className="mt-0.5 text-sm text-muted">Appears at the top of your profile.</p>
          <div className="mt-3 inline-flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button size="sm" variant="outline" onClick={() => coverFileRef.current?.click()} loading={coverBusy}>
              <Camera size={14} className="mr-1" /> Change cover
            </Button>
            {coverPhoto ? (
              <Button size="sm" variant="ghost" onClick={removeCover} loading={coverBusy}>
                <Trash2 size={14} className="mr-1" /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </Card>

      {/* Identity */}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={locked} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={locked} />
        </div>
        {locked ? (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
            <Lock size={12} /> Name is locked after identity verification.
          </div>
        ) : null}
      </Card>

      {/* About */}
      <Card>
        <Textarea
          className=""
          label={`Bio (${bio.length}/${MAX_BIO})`}
          value={bio}
          onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
          placeholder="A few words about you…"
        />
      </Card>

      {/* Contact */}
      <Card>
        <div className="space-y-3">
          <PhoneInput
            label="Mobile number"
            country={phoneCountry}
            onCountryChange={setPhoneCountry}
            value={mobile}
            onChange={setMobile}
          />
          <Input label="Email" value={profile.email ?? user?.email ?? ''} disabled hint="Linked to your Google account" />
        </div>
      </Card>

      {/* Location */}
      <Card>
        <div className="space-y-3">
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
              <Lock size={12} /> Address is locked after identity verification.
            </div>
          ) : null}
        </div>
      </Card>

      {/* Save bar */}
      <div className="sticky bottom-3 z-10 mx-auto max-w-2xl">
        <div className="flex gap-2 rounded-2xl bg-white p-2 ring-1 ring-line">
          <Button variant="ghost" full size="lg" onClick={() => router.back()}>Cancel</Button>
          <Button full size="lg" loading={busy} onClick={onSave}>Save changes</Button>
        </div>
      </div>
      {selfieOpen ? <SelfieVerifier onCancel={() => setSelfieOpen(false)} onCapture={(dataUrl) => { void saveVerifiedSelfie(dataUrl); }} /> : null}
    </div>
  );
}
