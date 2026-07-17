'use client';
import {
  linkWithPhoneNumber,
  getAdditionalUserInfo,
  reload,
  signInWithPhoneNumber,
  signInWithCustomToken,
  RecaptchaVerifier,
  ConfirmationResult,
} from 'firebase/auth';
import { getFirebaseAuth } from '../firebase';

type OTPChannel = 'firebase-sms' | 'vobiz-whatsapp';
type OTPMode = 'signin' | 'link';
export type OTPVerifyResult = { ok: boolean; error?: string; isNewUser?: boolean };

const SEND_FAILURE_MESSAGE = 'We could not send a code right now. Please try again shortly.';
const VERIFY_FAILURE_MESSAGE = 'That code did not work. Request a new code and try again.';

let fbConfirmation: ConfirmationResult | null = null;
let currentChannel: OTPChannel | null = null;
let pendingPhone: string = '';
let recaptchaVerifier: RecaptchaVerifier | null = null;
let fallbackChallenge: string = '';
let currentMode: OTPMode = 'signin';
let recaptchaContainerId = 'recaptcha-container';
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

async function sendWithFirebase(phone: string, containerId: string, mode: OTPMode) {
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
  if (mode === 'link') {
    if (!auth.currentUser) throw new Error('auth-required');
    return linkWithPhoneNumber(auth.currentUser, phone, recaptchaVerifier);
  }
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
  containerId: string,
  mode: OTPMode = 'signin',
): Promise<{ ok: boolean; channel?: OTPChannel; error?: string }> {
  if (sendInFlight) return sendInFlight;
  sendInFlight = sendOTPInternal(phone, containerId, mode).finally(() => {
    sendInFlight = null;
  });
  return sendInFlight;
}

async function sendOTPInternal(
  phone: string,
  containerId: string,
  mode: OTPMode,
): Promise<{ ok: boolean; channel?: OTPChannel; error?: string }> {
  pendingPhone = phone;
  currentMode = mode;
  recaptchaContainerId = containerId;
  fbConfirmation = null;
  currentChannel = null;
  fallbackChallenge = '';

  // ── TRY 1: FIREBASE SMS ──
  try {
    fbConfirmation = await sendWithFirebase(phone, containerId, mode);
    currentChannel = 'firebase-sms';
    return { ok: true, channel: 'firebase-sms' };
  } catch {
    clearRecaptcha(containerId);
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
export async function verifyOTP(code: string): Promise<OTPVerifyResult> {
  if (currentChannel === 'firebase-sms') {
    if (!fbConfirmation) return { ok: false, error: VERIFY_FAILURE_MESSAGE };
    try {
      const credential = await fbConfirmation.confirm(code);
      return {
        ok: true,
        isNewUser: currentMode === 'signin'
          ? !!getAdditionalUserInfo(credential)?.isNewUser
          : false,
      };
    } catch {
      return { ok: false, error: VERIFY_FAILURE_MESSAGE };
    }
  }

  if (currentChannel === 'vobiz-whatsapp') {
    try {
      const auth = getFirebaseAuth();
      const isLink = currentMode === 'link';
      const idToken = isLink ? await auth.currentUser?.getIdToken() : null;
      if (isLink && !idToken) throw new Error('auth-required');
      const res = await fetch(isLink ? '/api/auth/link-phone' : '/api/auth/verify-otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ phone: pendingPhone, otp: code, challenge: fallbackChallenge }),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; token?: string; isNewUser?: boolean } | null;
      if (!res.ok || !data?.ok || (!isLink && !data.token)) throw new Error('verification-failed');
      if (isLink) {
        if (!auth.currentUser) throw new Error('auth-required');
        await reload(auth.currentUser);
      } else {
        await signInWithCustomToken(auth, data.token!);
      }
      return { ok: true, isNewUser: isLink ? false : !!data.isNewUser };
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
  currentMode = 'signin';
  clearRecaptcha(recaptchaContainerId);
}
