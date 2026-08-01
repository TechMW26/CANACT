'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CountryCode } from 'libphonenumber-js';
import { useAuth } from '@/lib/auth';
import { lockPageScroll } from '@/lib/scrollLock';
import { isPhoneValid, PhoneInput, splitStoredPhone, toE164 } from './PhoneInput';
import { ArrowRight, MessageCircle, ShieldCheck } from './icons';

type Stage = 'phone' | 'otp';

export function MandatoryPhoneSheet() {
  const { user, profile, requestPhoneLinkOTP, confirmPhoneLinkOTP, phoneLinkStatus, pendingOTP } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [stage, setStage] = useState<Stage>('phone');
  const [country, setCountry] = useState<CountryCode>('IN');
  const [national, setNational] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ownershipNotice, setOwnershipNotice] = useState('');
  const otpRef = useRef<HTMLInputElement>(null);
  const visible = !!user && !!profile && profile.profileComplete !== false && !user.phoneNumber;
  const fullPhone = useMemo(() => toE164(country, national), [country, national]);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!visible) return;
    const session = pendingOTP('link');
    if (!session) return;
    const restored = splitStoredPhone(session.phone);
    setCountry(restored.country);
    setNational(restored.national);
    setStage('otp');
  }, [pendingOTP, visible]);

  useEffect(() => {
    if (!visible) return;
    const unlock = lockPageScroll();
    const blockEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') event.preventDefault();
    };
    window.addEventListener('keydown', blockEscape, true);
    return () => {
      window.removeEventListener('keydown', blockEscape, true);
      unlock();
    };
  }, [visible]);

  useEffect(() => {
    if (stage !== 'otp') return;
    const frame = requestAnimationFrame(() => otpRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [stage]);

  if (!mounted || !visible) return null;

  async function requestCode(forceNew = false) {
    if (busy) return;
    if (!isPhoneValid(country, national)) {
      setError('Enter a valid mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    setOwnershipNotice('');
    const ownership = await phoneLinkStatus(fullPhone);
    if (ownership === 'other') {
      setOwnershipNotice('This number is already in use. Confirming the code will sign you into its existing account.');
    } else if (ownership === 'current') {
      setOwnershipNotice('This number is already verified on your account.');
    }
    const result = await requestPhoneLinkOTP(fullPhone, forceNew).catch(() => ({
      ok: false as const,
      error: 'We could not contact Firebase. Please try again shortly.',
    }));
    setBusy(false);
    if (!result.ok) {
      setError(result.error || 'We could not send a code right now. Please try again shortly.');
      return;
    }
    setOtp('');
    setStage('otp');
  }

  async function verifyCode() {
    if (busy || otp.length !== 6) return;
    setBusy(true);
    setError('');
    const result = await confirmPhoneLinkOTP(otp).catch(() => ({ ok: false }));
    setBusy(false);
    if (!result.ok) setError('That code did not work. Check it or request a new code.');
  }

  return createPortal(
    <div className="fixed inset-0 z-[2147483200] flex items-end justify-center" role="presentation">
      <div className="absolute inset-0 bg-[#082d24]/35 backdrop-blur-md" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="phone-link-title"
        aria-describedby="phone-link-description"
        className="relative w-full max-w-[540px] rounded-t-[34px] bg-[#faf8f2] px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-18px_60px_rgba(5,45,35,0.2)] sm:mb-4 sm:rounded-[34px] sm:px-7"
      >
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-[#123d33]/15" />
        <div className="mb-5 flex items-start gap-4">
          <div>
            <h2 id="phone-link-title" className="text-[26px] font-extrabold leading-tight text-[#0d3028]">
              Add your mobile number
            </h2>
            <p id="phone-link-description" className="mt-1 text-sm leading-5 text-[#53655f]">
              Required to secure your account and let you sign in with this number next time.
            </p>
          </div>
        </div>

        {stage === 'phone' ? (
          <div className="space-y-4">
            <PhoneInput
              country={country}
              onCountryChange={(next) => { setCountry(next); setError(''); }}
              value={national}
              onChange={(next) => { setNational(next); setError(''); }}
              label="Mobile number"
              error={error}
              required
            />
            <div className="flex items-center gap-2 text-xs font-medium text-[#66766f]">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              We will send a one-time verification code.
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void requestCode()}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#176f57] px-5 text-base font-bold text-white transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? 'Sending code…' : 'Verify my number'}
              {!busy && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="phone-link-code" className="text-sm font-semibold text-[#0d3028]">Verification code</label>
              <input
                ref={otpRef}
                id="phone-link-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(event) => { setOtp(event.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                onKeyDown={(event) => { if (event.key === 'Enter') void verifyCode(); }}
                className="mt-2 h-14 w-full rounded-2xl border border-[#d8dfda] bg-white px-4 text-center text-2xl font-bold tracking-[0.45em] text-[#0d3028] outline-none focus:border-[#176f57] focus:ring-4 focus:ring-[#176f57]/10"
                aria-invalid={!!error}
              />
              <p className="mt-2 text-center text-xs text-[#66766f]">
                Code sent to {fullPhone} via SMS
              </p>
              {error && <p role="alert" className="mt-2 text-center text-xs font-semibold text-[#a33b35]">{error}</p>}
              {ownershipNotice && (
                <p role="status" className="mx-auto mt-3 max-w-md rounded-2xl bg-[#fff1cf] px-4 py-3 text-center text-xs font-semibold leading-5 text-[#684e13]">
                  {ownershipNotice}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={busy || otp.length !== 6}
              onClick={verifyCode}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-full bg-[#176f57] px-5 text-base font-bold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Confirm number'}
              {!busy && <ArrowRight className="h-5 w-5" aria-hidden="true" />}
            </button>
            <div className="flex items-center justify-center gap-5 text-sm font-semibold text-[#176f57]">
              <button type="button" disabled={busy} onClick={() => { setStage('phone'); setOtp(''); setError(''); setOwnershipNotice(''); }}>Change number</button>
              <button type="button" disabled={busy} onClick={() => void requestCode(true)}>Send a new code</button>
            </div>
          </div>
        )}
        <div id="phone-link-recaptcha" className="mt-4 flex justify-center empty:hidden" />
      </section>
    </div>,
    document.body,
  );
}
