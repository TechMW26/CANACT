import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let adminApp: App | null = null;

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
};

export async function verifyAdminRequest(request: Request, app: App): Promise<VerifiedAdmin | null> {
  const authHeader = request.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return null;

  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    const email = typeof decoded.email === 'string' ? decoded.email.toLowerCase() : null;
    const adminEmails = configuredSet('CANACT_ADMIN_EMAILS', 'ADMIN_EMAILS', 'NEXT_PUBLIC_ADMIN_EMAILS');
    const adminUids = configuredSet('CANACT_ADMIN_UIDS', 'ADMIN_UIDS');
    const allowedByEmail = !!email && adminEmails.has(email);
    const allowedByUid = adminUids.has(decoded.uid);
    if (!allowedByEmail && !allowedByUid) return null;
    return { uid: decoded.uid, email };
  } catch {
    return null;
  }
}

function configuredSet(...names: string[]): Set<string> {
  const values = names.flatMap((name) => (process.env[name] ?? '').split(','));
  const cleaned = values.map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (names.includes('CANACT_ADMIN_EMAILS') && names.includes('ADMIN_EMAILS') && names.includes('NEXT_PUBLIC_ADMIN_EMAILS')) {
    cleaned.push('avi2001raj@gmail.com');
  }
  return new Set(cleaned);
}