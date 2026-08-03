import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';

export const runtime = 'nodejs';

let _app: App | null = null;
function admin(): App | null {
  if (_app) return _app;
  if (getApps().length) { _app = getApps()[0]!; return _app; }
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    _app = initializeApp({
      credential: cert(JSON.parse(json)),
      databaseURL:
        process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
        'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app',
    });
    return _app;
  } catch { return null; }
}

const MAX_RADIUS_M = 100_000;
const MAX_LOC_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RECIPIENTS = 500;

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const stripEmoji = (s: string) =>
  String(s)
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * POST /api/push/help-vicinity
 * Body: {
 *   helpId: string,
 *   lat: number, lng: number, vicinityMeters: number,
 *   audience: 'public' | 'favourites' | 'contacts',
 *   title: string, body?: string, url: string, tag?: string,
 * }
 * Auth: Firebase ID token in Authorization: Bearer header.
 *
 * Fans a help-request notification to every user whose stored
 * lastLocation is inside the request's vicinity radius. Audience
 * filters limit recipients to friends or favourites when applicable.
 */
export async function POST(req: Request) {
  const app = admin();
  if (!app) return NextResponse.json({ ok: false, reason: 'admin-not-configured' }, { status: 503 });

  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });
  let fromUid: string;
  try { fromUid = (await getAuth(app).verifyIdToken(idToken)).uid; }
  catch { return NextResponse.json({ ok: false, reason: 'invalid-token' }, { status: 401 }); }

  let payload: any;
  try { payload = await req.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }
  const { lat, lng, vicinityMeters, audience, title, body, url, tag, helpId } = payload || {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || !title || !url) {
    return NextResponse.json({ ok: false, reason: 'missing-fields' }, { status: 400 });
  }
  const radius = Math.min(
    Math.max(0, typeof vicinityMeters === 'number' ? vicinityMeters : MAX_RADIUS_M),
    MAX_RADIUS_M,
  );
  const aud: 'public' | 'favourites' | 'contacts' =
    audience === 'favourites' || audience === 'contacts' ? audience : 'public';

  const dbAdm = getDatabase(app);

  // Build candidate UID set based on audience.
  let candidateUids: string[] = [];
  if (aud === 'contacts') {
    const snap = await dbAdm.ref(`contacts/${fromUid}`).get();
    snap.forEach((c) => { if (c.key) candidateUids.push(c.key); return undefined; });
  } else if (aud === 'favourites') {
    const snap = await dbAdm.ref(`favourites/${fromUid}`).get();
    snap.forEach((c) => { if (c.key) candidateUids.push(c.key); return undefined; });
  } else {
    // Public: scan all users (capped). For larger deployments swap this for
    // a geohash index — sufficient for current user counts.
    const snap = await dbAdm.ref('users').get();
    snap.forEach((c) => { if (c.key && c.key !== fromUid) candidateUids.push(c.key); return undefined; });
  }

  candidateUids = candidateUids.filter((uid) => uid !== fromUid).slice(0, MAX_RECIPIENTS);
  if (candidateUids.length === 0) return NextResponse.json({ ok: true, sent: 0, recipients: 0 });

  const cleanTitle = stripEmoji(title).slice(0, 80) || 'Help nearby';
  const cleanBody = stripEmoji(body || '').slice(0, 200);
  const safeUrl = String(url).slice(0, 400);
  const safeTag = tag ? String(tag).slice(0, 60) : helpId ? `help:${String(helpId).slice(0, 40)}` : undefined;

  const now = Date.now();
  const post = { lat, lng };

  const decisions = await Promise.all(candidateUids.map(async (uid) => {
    try {
      const [locSnap, prefSnap, tokSnap] = await Promise.all([
        dbAdm.ref(`users/${uid}/lastLocation`).get(),
        dbAdm.ref(`users/${uid}/notifPrefs`).get(),
        dbAdm.ref(`users/${uid}/pushTokens`).get(),
      ]);
      const loc = locSnap.val() as { lat?: number; lng?: number; at?: number } | null;
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
      if (loc.at && now - loc.at > MAX_LOC_AGE_MS) return null;
      const pref = prefSnap.val() as { helpMuted?: boolean } | null;
      if (pref?.helpMuted) return null;
      const d = haversineMeters(post, { lat: loc.lat, lng: loc.lng });
      if (d > radius) return null;
      const tokensVal = (tokSnap.val() ?? {}) as Record<string, { token: string }>;
      const tokens = Object.values(tokensVal).map((t) => t.token).filter(Boolean);
      if (tokens.length === 0) return null;
      return { uid, tokens, tokensVal };
    } catch { return null; }
  }));

  const recipients = decisions.filter(Boolean) as Array<{
    uid: string; tokens: string[]; tokensVal: Record<string, { token: string }>;
  }>;
  if (recipients.length === 0) return NextResponse.json({ ok: true, sent: 0, recipients: 0 });

  const allTokens = recipients.flatMap((r) => r.tokens);
  const data: Record<string, string> = { title: cleanTitle, body: cleanBody, url: safeUrl, kind: 'help' };
  if (safeTag) data.tag = safeTag;
  if (helpId) data.helpId = String(helpId);

  const res = await getMessaging(app).sendEachForMulticast({
    tokens: allTokens,
    notification: { title: cleanTitle, body: cleanBody },
    data,
    android: {
      priority: 'high',
      notification: { channelId: 'canact_general_v1', clickAction: 'FCM_PLUGIN_ACTIVITY' },
    },
    webpush: { headers: { Urgency: 'high' } },
  });

  // Prune dead tokens.
  let cursor = 0;
  await Promise.all(recipients.map(async (r) => {
    const slice = res.responses.slice(cursor, cursor + r.tokens.length);
    cursor += r.tokens.length;
    await Promise.all(slice.map(async (resp, i) => {
      if (resp.success) return;
      const code = resp.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        const dead = r.tokens[i];
        const key = Object.keys(r.tokensVal).find((k) => r.tokensVal[k]?.token === dead);
        if (key) await dbAdm.ref(`users/${r.uid}/pushTokens/${key}`).remove();
      }
    }));
  }));

  return NextResponse.json({
    ok: true,
    recipients: recipients.length,
    sent: res.successCount,
    failed: res.failureCount,
  });
}
