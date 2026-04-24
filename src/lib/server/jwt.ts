import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-me-please-32+bytes-long-string'
);
const ALG = 'HS256';
const COOKIE = 'canact_session';
const TTL_DAYS = 30;

export async function signSession(uid: string): Promise<string> {
  return await new SignJWT({ uid })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${TTL_DAYS}d`)
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<{ uid: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.uid !== 'string') return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_TTL_SECONDS = TTL_DAYS * 24 * 3600;
