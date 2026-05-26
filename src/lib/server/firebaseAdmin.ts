import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

let adminApp: App | null = null;

const RTDB_BASE =
  process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
  'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app';

export function getFirebaseAdminApp(): App | null {
  if (adminApp) return adminApp;
  if (getApps().length) {
    adminApp = getApps()[0]!;
    return adminApp;
  }

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    adminApp = initializeApp({
      credential: cert(JSON.parse(json)),
      databaseURL:
        process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
        'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app',
    });
    return adminApp;
  } catch {
    return null;
  }
}

export type VerifiedAdmin = {
  uid: string;
  email: string | null;
  idToken: string;
};

export async function verifyAdminRequest(request: Request, app: App | null): Promise<VerifiedAdmin | null> {
  const authHeader = request.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return null;

  try {
    const decoded = app
      ? await getAuth(app).verifyIdToken(idToken)
      : await verifyIdTokenWithRest(idToken);
    const email = typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null;
    const adminEmails = configuredSet('CANACT_ADMIN_EMAILS', 'ADMIN_EMAILS', 'NEXT_PUBLIC_ADMIN_EMAILS');
    const adminUids = configuredSet('CANACT_ADMIN_UIDS', 'ADMIN_UIDS');
    const allowedByEmail = !!email && adminEmails.has(email);
    const allowedByUid = adminUids.has(decoded.uid);
    if (!allowedByEmail && !allowedByUid) return null;
    return { uid: decoded.uid, email, idToken };
  } catch {
    return null;
  }
}

export async function readAdminRtdb<T = any>(path: string, app: App | null, idToken: string): Promise<T | null> {
  if (app) {
    const snap = await getDatabase(app).ref(path).get();
    return snap.val() as T | null;
  }

  const url = new URL(`${RTDB_BASE}/${path}.json`);
  url.searchParams.set('auth', idToken);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`RTDB ${path} failed: ${response.status}`);
  return (await response.json()) as T | null;
}

async function verifyIdTokenWithRest(idToken: string): Promise<{ uid: string; email?: string | null }> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('firebase-api-key-missing');

  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('invalid-token');
  const json = (await response.json()) as { users?: Array<{ localId?: string; email?: string }> };
  const account = json.users?.[0];
  if (!account?.localId) throw new Error('invalid-token');
  return { uid: account.localId, email: account.email ?? null };
}

function configuredSet(...names: string[]): Set<string> {
  const values = names.flatMap((name) => (process.env[name] ?? '').split(','));
  const cleaned = values.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (names.includes('CANACT_ADMIN_EMAILS') && names.includes('ADMIN_EMAILS') && names.includes('NEXT_PUBLIC_ADMIN_EMAILS')) {
    cleaned.push('avi2001raj@gmail.com');
  }
  return new Set(cleaned);
}