import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const N = 16384, r = 8, p = 1, KEYLEN = 32, SALTLEN = 16;

export function hashPassword(plain: string): string {
  const salt = randomBytes(SALTLEN);
  const key = scryptSync(plain, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string | undefined | null): boolean {
  if (!stored) return false;
  // Legacy DJB2 fallback (so test accounts created earlier still work).
  if (stored.startsWith('h')) {
    let h = 5381;
    for (let i = 0; i < plain.length; i++) h = ((h << 5) + h + plain.charCodeAt(i)) | 0;
    return stored === 'h' + (h >>> 0).toString(36);
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const got = scryptSync(plain, salt, expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}
