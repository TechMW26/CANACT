'use client';
import {
  signInWithPhoneNumber,
  signInWithCustomToken,
  RecaptchaVerifier,
  ConfirmationResult,
} from 'firebase/auth';
import { getFirebaseAuth } from '../firebase';

type OTPChannel = 'firebase-sms' | 'vobiz-whatsapp';

const SEND_FAILURE_MESSAGE = 'We could not send a code right now. Please try again shortly.';
const VERIFY_FAILURE_MESSAGE = 'That code did not work. Request a new code and try again.';

let fbConfirmation: ConfirmationResult | null = null;
let currentChannel: OTPChannel | null = null;
let pendingPhone: string = '';
let recaptchaVerifier: RecaptchaVerifier | null = null;
let fallbackChallenge: string = '';
let sendInFlight: Promise<{ ok: boolean; channel?: OTPChannel; error?: string }> | null = null;

function ensureRecaptchaContainer(containerId: string) {
  if (typeof document === 'undefined') throw new Error('browser-required');
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.style.position = 'fixed';
    container.style.inset = 'auto 0 0 auto';
    container.style.zIndex = '-1';
    container.style.pointerEvents = 'none';
    document.body.appendChild(container);
  }
  container.removeAttribute('aria-hidden');
  container.replaceChildren();
  return container;
}

function clearRecaptcha(containerId?: string) {
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch { /* ignore */ }
    recaptchaVerifier = null;
  }
  if (containerId && typeof document !== 'undefined') document.getElementById(containerId)?.replaceChildren();
}

async function sendWithFirebase(phone: string, containerId: string) {
  const auth = getFirebaseAuth();
  clearRecaptcha(containerId);
  ensureRecaptchaContainer(containerId);
  recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
    callback: () => undefined,
    'expired-callback': () => clearRecaptcha(containerId),
  });
  // signInWithPhoneNumber renders and executes the verifier itself. Explicitly
  // rendering first can produce stale tokens after Fast Refresh or navigation.
  return signInWithPhoneNumber(auth, phone, recaptchaVerifier);
}

async function sendWithFallback(phone: string) {
  const res = await fetch('/api/auth/send-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = await res.json().catch(() => null) as { ok?: boolean; challenge?: string } | null;
  if (!res.ok || !data?.ok || !data.challenge) throw new Error('fallback-unavailable');
  fallbackChallenge = data.challenge;
  currentChannel = 'vobiz-whatsapp';
  return { ok: true, channel: 'vobiz-whatsapp' as const };
}

/**
 * Send OTP: Firebase SMS first, Vobiz WhatsApp fallback.
 * Must be called from a user gesture (button click).
 */
export async function sendOTP(
  phone: string,
  recaptchaContainerId: string,
): Promise<{ ok: boolean; channel?: OTPChannel; error?: string }> {
  if (sendInFlight) return sendInFlight;
  sendInFlight = sendOTPInternal(phone, recaptchaContainerId).finally(() => {
    sendInFlight = null;
  });
  return sendInFlight;
}

async function sendOTPInternal(
  phone: string,
  recaptchaContainerId: string,
): Promise<{ ok: boolean; channel?: OTPChannel; error?: string }> {
  pendingPhone = phone;
  fbConfirmation = null;
  currentChannel = null;
  fallbackChallenge = '';

  // ── TRY 1: FIREBASE SMS ──
  try {
    fbConfirmation = await sendWithFirebase(phone, recaptchaContainerId);
    currentChannel = 'firebase-sms';
    return { ok: true, channel: 'firebase-sms' };
  } catch {
    clearRecaptcha(recaptchaContainerId);
    console.warn('[OTP] Primary delivery unavailable; using fallback');
  }

  // ── TRY 2: VOBZ WHATSAPP ──
  try {
    return await sendWithFallback(phone);
  } catch {
    return { ok: false, error: SEND_FAILURE_MESSAGE };
  }
}

/**
 * Verify OTP: Firebase confirm() if SMS, Vobiz API if WhatsApp.
 * On success for Vobiz path, signs into Firebase with the returned custom token.
 */
export async function verifyOTP(code: string): Promise<{ ok: boolean; error?: string }> {
  if (currentChannel === 'firebase-sms') {
    if (!fbConfirmation) return { ok: false, error: VERIFY_FAILURE_MESSAGE };
    try {
      await fbConfirmation.confirm(code);
      return { ok: true };
    } catch {
      return { ok: false, error: VERIFY_FAILURE_MESSAGE };
    }
  }

  if (currentChannel === 'vobiz-whatsapp') {
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone, otp: code, challenge: fallbackChallenge }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; token?: string } | null;
      if (!res.ok || !data?.ok || !data.token) throw new Error('verification-failed');
      // Sign into Firebase with custom token
      await signInWithCustomToken(getFirebaseAuth(), data.token);
      return { ok: true };
    } catch {
      return { ok: false, error: VERIFY_FAILURE_MESSAGE };
    }
  }

  return { ok: false, error: VERIFY_FAILURE_MESSAGE };
}

/** Which channel delivered the OTP? For UI display. */
export function getOTPChannel(): OTPChannel | null {
  return currentChannel;
}

/** Reset state (e.g., on back navigation or component unmount). */
export function resetOTP() {
  fbConfirmation = null;
  currentChannel = null;
  pendingPhone = '';
  fallbackChallenge = '';
  clearRecaptcha('recaptcha-container');
}
