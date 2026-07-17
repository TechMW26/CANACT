'use client';
import {
  linkWithPhoneNumber,
  linkWithCredential,
  getAdditionalUserInfo,
  PhoneAuthProvider,
  reload,
  signInWithCredential,
  signInWithPhoneNumber,
  signInWithCustomToken,
  RecaptchaVerifier,
  ConfirmationResult,
} from 'firebase/auth';
import { getFirebaseAuth } from '../firebase';

type OTPChannel = 'firebase-sms' | 'vobiz-whatsapp';
type OTPMode = 'signin' | 'link';
export type OTPVerifyResult = { ok: boolean; error?: string; isNewUser?: boolean; accountSwitched?: boolean };
export type OTPSession = {
  phone: string;
  channel: OTPChannel;
  mode: OTPMode;
  expiresAt: number;
};
type StoredOTPSession = OTPSession & {
  verificationId?: string;
  fallbackChallenge?: string;
};
type OTPSendResult = {
  ok: boolean;
  channel?: OTPChannel;
  error?: string;
  reused?: boolean;
  expiresAt?: number;
};

const SEND_FAILURE_MESSAGE = 'We could not send a code right now. Please try again shortly.';
const VERIFY_FAILURE_MESSAGE = 'That code did not work. Request a new code and try again.';

let fbConfirmation: ConfirmationResult | null = null;
let currentChannel: OTPChannel | null = null;
let pendingPhone: string = '';
let recaptchaVerifier: RecaptchaVerifier | null = null;
let fallbackChallenge: string = '';
let currentMode: OTPMode = 'signin';
let recaptchaContainerId = 'recaptcha-container';
let sendInFlight: Promise<OTPSendResult> | null = null;
let sendInFlightKey = '';

const OTP_SESSION_KEY = 'canact:otp-session:v1';
const OTP_SESSION_TTL_MS = 5 * 60 * 1000;

function readStoredSession(): StoredOTPSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const session = JSON.parse(window.sessionStorage.getItem(OTP_SESSION_KEY) || 'null') as StoredOTPSession | null;
    if (!session?.phone || !session.channel || !session.mode || session.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(OTP_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    window.sessionStorage.removeItem(OTP_SESSION_KEY);
    return null;
  }
}

function writeStoredSession(session: StoredOTPSession) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(OTP_SESSION_KEY, JSON.stringify(session));
}

function clearStoredSession() {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(OTP_SESSION_KEY);
}

function hydrateSession(session: StoredOTPSession) {
  pendingPhone = session.phone;
  currentChannel = session.channel;
  currentMode = session.mode;
  fallbackChallenge = session.fallbackChallenge || '';
}

export function getActiveOTPSession(phone?: string, mode?: OTPMode): OTPSession | null {
  const session = readStoredSession();
  if (!session || (phone && session.phone !== phone) || (mode && session.mode !== mode)) return null;
  hydrateSession(session);
  return { phone: session.phone, channel: session.channel, mode: session.mode, expiresAt: session.expiresAt };
}

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
  const expiresAt = Date.now() + OTP_SESSION_TTL_MS;
  writeStoredSession({ phone, mode: currentMode, channel: 'vobiz-whatsapp', fallbackChallenge, expiresAt });
  return { ok: true, channel: 'vobiz-whatsapp' as const, expiresAt };
}

/**
 * Send OTP: Firebase SMS first, Vobiz WhatsApp fallback.
 * Must be called from a user gesture (button click).
 */
export async function sendOTP(
  phone: string,
  containerId: string,
  mode: OTPMode = 'signin',
  forceNew = false,
): Promise<OTPSendResult> {
  if (!forceNew) {
    const active = getActiveOTPSession(phone, mode);
    if (active) return { ok: true, channel: active.channel, expiresAt: active.expiresAt, reused: true };
  }
  const requestKey = `${mode}:${phone}`;
  if (sendInFlight && sendInFlightKey === requestKey) return sendInFlight;
  sendInFlightKey = requestKey;
  sendInFlight = sendOTPInternal(phone, containerId, mode).finally(() => {
    sendInFlight = null;
    sendInFlightKey = '';
  });
  return sendInFlight;
}

async function sendOTPInternal(
  phone: string,
  containerId: string,
  mode: OTPMode,
): Promise<OTPSendResult> {
  clearStoredSession();
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
    const expiresAt = Date.now() + OTP_SESSION_TTL_MS;
    writeStoredSession({
      phone,
      mode,
      channel: 'firebase-sms',
      verificationId: fbConfirmation.verificationId,
      expiresAt,
    });
    return { ok: true, channel: 'firebase-sms', expiresAt };
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
  const storedSession = readStoredSession();
  if (storedSession) hydrateSession(storedSession);

  if (currentChannel === 'firebase-sms') {
    const verificationId = fbConfirmation?.verificationId || storedSession?.verificationId;
    if (!verificationId) return { ok: false, error: VERIFY_FAILURE_MESSAGE };
    try {
      const auth = getFirebaseAuth();
      const credential = PhoneAuthProvider.credential(verificationId, code);
      if (currentMode === 'link') {
        const currentUser = auth.currentUser;
        if (!currentUser) throw new Error('auth-required');
        try {
          await linkWithCredential(currentUser, credential);
          clearStoredSession();
          return { ok: true, isNewUser: false, accountSwitched: false };
        } catch (error: any) {
          if (error?.code !== 'auth/credential-already-in-use') throw error;
          await signInWithCredential(auth, credential);
          clearStoredSession();
          return { ok: true, isNewUser: false, accountSwitched: true };
        }
      }
      const signedIn = await signInWithCredential(auth, credential);
      clearStoredSession();
      return {
        ok: true,
        isNewUser: !!getAdditionalUserInfo(signedIn)?.isNewUser,
      };
    } catch (error: any) {
      console.warn('[OTP] Firebase code confirmation failed', error?.code || 'unknown');
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
      const data = await res.json().catch(() => null) as {
        ok?: boolean;
        token?: string;
        isNewUser?: boolean;
        accountSwitched?: boolean;
      } | null;
      if (!res.ok || !data?.ok || (!isLink && !data.token)) throw new Error('verification-failed');
      if (isLink) {
        if (data.accountSwitched) {
          if (!data.token) throw new Error('missing-switch-token');
          await signInWithCustomToken(auth, data.token);
        } else {
          if (!auth.currentUser) throw new Error('auth-required');
          await reload(auth.currentUser);
        }
      } else {
        await signInWithCustomToken(auth, data.token!);
      }
      clearStoredSession();
      return {
        ok: true,
        isNewUser: isLink ? false : !!data.isNewUser,
        accountSwitched: isLink ? !!data.accountSwitched : false,
      };
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
  clearStoredSession();
  clearRecaptcha(recaptchaContainerId);
}
