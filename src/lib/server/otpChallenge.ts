import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const OTP_TTL_MS = 5 * 60 * 1000;

function secret() {
  const value = process.env.VOBZ_AUTH_TOKEN || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!value) throw new Error('otp-server-secret-missing');
  return value;
}

function sign(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function createOtpChallenge(phone: string, otp: string) {
  const nonce = randomBytes(18).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ phone, nonce, expiresAt: Date.now() + OTP_TTL_MS })).toString('base64url');
  return `${payload}.${sign(`${payload}.${otp}`)}`;
}

export function verifyOtpChallenge(challenge: string, phone: string, otp: string) {
  const [payload, signature] = challenge.split('.');
  if (!payload || !signature) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { phone?: string; expiresAt?: number };
    if (parsed.phone !== phone || !parsed.expiresAt || parsed.expiresAt < Date.now()) return false;
    const expected = Buffer.from(sign(`${payload}.${otp}`));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}
