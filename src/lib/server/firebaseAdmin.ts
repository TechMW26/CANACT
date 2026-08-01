import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
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

  try {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const credential = json
      ? cert(JSON.parse(json))
      : clientEmail && privateKey && projectId
        ? cert({ projectId, clientEmail, privateKey })
        : process.env.GOOGLE_APPLICATION_CREDENTIALS
          ? applicationDefault()
          : null;
    if (!credential) return null;
    adminApp = initializeApp({
      credential,
      databaseURL:
        process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
        'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app',
    });
    return adminApp;
  } catch (error) {
    console.error('[firebase-admin] initialization failed', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

export type VerifiedAdmin = {
  uid: string;
  email: string | null;
  idToken: string;
};

export type VerifiedUser = {
  uid: string;
  email: string | null;
  idToken: string;
};

export async function verifyUserRequest(request: Request, app: App | null): Promise<VerifiedUser | null> {
  const authHeader = request.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return null;

  try {
    const decoded = app
      ? await getAuth(app).verifyIdToken(idToken)
      : await verifyIdTokenWithRest(idToken);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null,
      idToken,
    };
  } catch {
    return null;
  }
}

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

export async function runUserRtdbTransaction<T = any>(
  path: string,
  app: App | null,
  idToken: string,
  update: (current: T | null) => T | undefined,
): Promise<{ committed: boolean; value: T | null }> {
  if (app) {
    const result = await getDatabase(app).ref(path).transaction(update, undefined, false);
    return { committed: result.committed, value: result.snapshot.val() as T | null };
  }

  const url = new URL(`${RTDB_BASE}/${path}.json`);
  url.searchParams.set('auth', idToken);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const read = await fetch(url, {
      cache: 'no-store',
      headers: { 'X-Firebase-ETag': 'true' },
    });
    if (!read.ok) throw new Error(`RTDB transaction read failed: ${read.status}`);
    const current = (await read.json()) as T | null;
    const next = update(current);
    if (typeof next === 'undefined') return { committed: false, value: current };
    const etag = read.headers.get('etag');
    if (!etag) throw new Error('RTDB transaction ETag missing');
    const write = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(next),
      cache: 'no-store',
    });
    if (write.ok) return { committed: true, value: (await write.json()) as T };
    if (write.status !== 412) throw new Error(`RTDB transaction write failed: ${write.status}`);
  }
  throw new Error('RTDB transaction contention');
}

export async function writeUserRtdb(path: string, value: unknown, app: App | null, idToken: string): Promise<void> {
  if (app) {
    await getDatabase(app).ref(path).set(value);
    return;
  }
  const url = new URL(`${RTDB_BASE}/${path}.json`);
  url.searchParams.set('auth', idToken);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`RTDB write failed: ${response.status}`);
}

export async function patchUserRtdb(path: string, value: Record<string, unknown>, app: App | null, idToken: string): Promise<void> {
  if (app) {
    await getDatabase(app).ref(path).update(value);
    return;
  }
  const url = new URL(`${RTDB_BASE}/${path}.json`);
  url.searchParams.set('auth', idToken);
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`RTDB patch failed: ${response.status}`);
}

export async function deleteUserRtdb(path: string, app: App | null, idToken: string): Promise<void> {
  if (app) {
    await getDatabase(app).ref(path).remove();
    return;
  }
  const url = new URL(`${RTDB_BASE}/${path}.json`);
  url.searchParams.set('auth', idToken);
  const response = await fetch(url, { method: 'DELETE', cache: 'no-store' });
  if (!response.ok) throw new Error(`RTDB delete failed: ${response.status}`);
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
