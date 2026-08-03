'use client';
import {
  linkWithPhoneNumber,
  linkWithCredential,
  getAdditionalUserInfo,
  PhoneAuthProvider,
  reload,
  signInWithCredential,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
} from 'firebase/auth';
import { SDK_VERSION } from 'firebase/app';
import { getFirebaseAuth } from '../firebase';

type OTPChannel = 'firebase-sms';
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
    if (!session?.phone || session.channel !== 'firebase-sms' || !session.mode || session.expiresAt <= Date.now()) {
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
}

export async function getPhoneLinkStatus(
  phone: string,
): Promise<'available' | 'current' | 'other' | 'unknown'> {
  try {
    const auth = getFirebaseAuth();
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return 'unknown';
    const response = await fetch('/api/auth/phone-status', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ phone }),
    });
    const data = await response.json().catch(() => null) as {
      ok?: boolean;
      status?: 'available' | 'current' | 'other';
    } | null;
    return response.ok && data?.ok && data.status ? data.status : 'unknown';
  } catch {
    return 'unknown';
  }
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
    container.style.display = 'flex';
    container.style.justifyContent = 'center';
    container.style.margin = '16px auto';
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
    // A visible challenge is more reliable than score-based invisible
    // verification in embedded browsers and gives users a clear recovery path.
    size: 'normal',
    callback: () => undefined,
    'expired-callback': () => clearRecaptcha(containerId),
  });
  // The Firebase SDK renders and waits for the challenge before sending SMS.
  if (mode === 'link') {
    if (!auth.currentUser) throw new Error('auth-required');
    return linkWithPhoneNumber(auth.currentUser, phone, recaptchaVerifier);
  }
  return signInWithPhoneNumber(auth, phone, recaptchaVerifier);
}

/**
 * Send an SMS OTP with Firebase Phone Authentication.
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
  } catch (error: any) {
    clearRecaptcha(containerId);
    const serverMessage = error?.customData?._serverResponse?.error?.message
      || error?.customData?._serverResponse?.message;
    console.error(
      `[OTP] Firebase SMS send failed code=${error?.code || 'unknown'} sdk=${SDK_VERSION}`,
      error?.message || 'unknown',
      serverMessage ? `server=${serverMessage}` : '',
      error?.stack || '',
    );
    return { ok: false, error: firebaseSendError(error) };
  }
}

/**
 * Verify the SMS code with Firebase and complete sign-in or phone linking.
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
        const linkStatus = await getPhoneLinkStatus(pendingPhone);
        if (linkStatus === 'current') {
          await reload(currentUser);
          clearStoredSession();
          return { ok: true, isNewUser: false, accountSwitched: false };
        }
        if (linkStatus === 'other') {
          await signInWithCredential(auth, credential);
          clearStoredSession();
          return { ok: true, isNewUser: false, accountSwitched: true };
        }
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

  return { ok: false, error: VERIFY_FAILURE_MESSAGE };
}

function firebaseSendError(error: any) {
  switch (error?.code) {
    case 'auth/invalid-phone-number': return 'Enter a valid mobile number.';
    case 'auth/too-many-requests': return 'Too many attempts. Please wait before requesting another code.';
    case 'auth/quota-exceeded': return 'Firebase SMS quota is currently exhausted. Please try again later.';
    case 'auth/billing-not-enabled': return 'Firebase Phone Authentication requires billing to be enabled for this project.';
    case 'auth/operation-not-allowed': return 'Phone sign-in is not enabled in Firebase Authentication.';
    case 'auth/app-not-authorized':
    case 'auth/unauthorized-domain': return 'This app domain is not authorized in Firebase Authentication.';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
    case 'auth/missing-client-identifier': return 'Firebase could not verify this browser. Refresh the page and try again.';
    case 'auth/internal-error': return 'Firebase could not start SMS delivery. Confirm Blaze billing, Phone sign-in, and the destination SMS region are enabled for this project.';
    case 'auth/network-request-failed': return 'Network error while contacting Firebase. Check your connection and try again.';
    default: return SEND_FAILURE_MESSAGE;
  }
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
  currentMode = 'signin';
  clearStoredSession();
  clearRecaptcha(recaptchaContainerId);
}
