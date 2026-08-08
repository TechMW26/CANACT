import { NextResponse } from 'next/server';
import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import { sendWebPushSubscriptions, type StoredWebPushSubscription } from '@/lib/server/webPush';

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

// Default radius (meters) when the recipient hasn't expressed a preference.
const DEFAULT_RADIUS_M = 5000;
// Hard cap so a stale lastLocation can't ping people who moved a country away.
const MAX_RADIUS_M = 100_000;
// Maximum age of the stored lastLocation before we ignore it.
const MAX_LOC_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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
 * POST /api/push/nearby-friends
 * Body: {
 *   lat: number, lng: number,
 *   title: string, body?: string,
 *   url: string, image?: string, tag?: string,
 * }
 * Auth: Firebase ID token in Authorization: Bearer header.
 *
 * Fans out a system-tray notification to every accepted friend whose
 * last-known location lies within their own configured nearby-radius
 * of the post coordinates. Each notification carries the deep-link URL
 * (so a tap opens the post directly) plus an optional thumbnail image.
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
  const { lat, lng, title, body, url, image, tag } = payload || {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || !title || !url) {
    return NextResponse.json({ ok: false, reason: 'missing-fields' }, { status: 400 });
  }

  const dbAdm = getDatabase(app);
  const friendsSnap = await dbAdm.ref(`friends/${fromUid}`).get();
  const friendUids: string[] = [];
  friendsSnap.forEach((c) => { if (c.key) friendUids.push(c.key); return undefined; });
  if (friendUids.length === 0) return NextResponse.json({ ok: true, sent: 0, recipients: 0 });

  const cleanTitle = stripEmoji(title).slice(0, 80) || 'Canact';
  const cleanBody = stripEmoji(body || '').slice(0, 200);
  const safeImage = typeof image === 'string' && /^https?:\/\//.test(image) ? image : undefined;
  const safeUrl = String(url).slice(0, 400);
  const safeTag = tag ? String(tag).slice(0, 60) : undefined;

  const now = Date.now();
  const post = { lat, lng };

  // Pull each friend's stored prefs + lastLocation in parallel.
  const decisions = await Promise.all(friendUids.map(async (uid) => {
    try {
      const [locSnap, prefSnap, tokSnap, webPushSnap] = await Promise.all([
        dbAdm.ref(`users/${uid}/lastLocation`).get(),
        dbAdm.ref(`users/${uid}/notifPrefs`).get(),
        dbAdm.ref(`users/${uid}/pushTokens`).get(),
        dbAdm.ref(`users/${uid}/webPushSubscriptions`).get(),
      ]);
      const loc = locSnap.val() as { lat?: number; lng?: number; at?: number } | null;
      if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') return null;
      if (loc.at && now - loc.at > MAX_LOC_AGE_MS) return null;
      const pref = prefSnap.val() as { nearbyRadius?: number; nearbyPostsMuted?: boolean } | null;
      if (pref?.nearbyPostsMuted) return null;
      // 0 = "anywhere"; otherwise meters, capped to MAX_RADIUS_M.
      const rawRadius = typeof pref?.nearbyRadius === 'number' ? pref.nearbyRadius : DEFAULT_RADIUS_M;
      const effectiveRadius = rawRadius === 0 ? MAX_RADIUS_M : Math.min(rawRadius, MAX_RADIUS_M);
      const d = haversineMeters(post, { lat: loc.lat, lng: loc.lng });
      if (d > effectiveRadius) return null;
      const tokensVal = (tokSnap.val() ?? {}) as Record<string, { token: string }>;
      const tokens = Object.values(tokensVal).map((t) => t.token).filter(Boolean);
      const webPushSubscriptions = (webPushSnap.val() ?? {}) as Record<string, StoredWebPushSubscription>;
      if (tokens.length === 0 && Object.keys(webPushSubscriptions).length === 0) return null;
      return { uid, tokens, tokensVal, webPushSubscriptions };
    } catch { return null; }
  }));

  const recipients = decisions.filter(Boolean) as Array<{
    uid: string;
    tokens: string[];
    tokensVal: Record<string, { token: string }>;
    webPushSubscriptions: Record<string, StoredWebPushSubscription>;
  }>;
  if (recipients.length === 0) return NextResponse.json({ ok: true, sent: 0, recipients: 0 });

  const allTokens = recipients.flatMap((r) => r.tokens);
  const data: Record<string, string> = { title: cleanTitle, body: cleanBody, url: safeUrl };
  if (safeImage) data.image = safeImage;
  if (safeTag) data.tag = safeTag;

  const res = allTokens.length ? await getMessaging(app).sendEachForMulticast({
    tokens: allTokens,
    notification: { title: cleanTitle, body: cleanBody, ...(safeImage ? { imageUrl: safeImage } : {}) },
    data,
    android: {
      priority: 'high',
      notification: {
        channelId: 'canact_general_v1',
        clickAction: 'FCM_PLUGIN_ACTIVITY',
        ...(safeImage ? { imageUrl: safeImage } : {}),
      },
    },
    webpush: { headers: { Urgency: 'high' } },
  }) : null;

  const webResults = await Promise.all(recipients.map((recipient) => sendWebPushSubscriptions(
    dbAdm,
    recipient.uid,
    recipient.webPushSubscriptions,
    { title: cleanTitle, body: cleanBody, url: safeUrl, tag: safeTag, image: safeImage },
    { urgency: 'high' },
  )));

  // Prune dead tokens by walking responses in the same order they were sent.
  let cursor = 0;
  await Promise.all(recipients.map(async (r) => {
    const slice = (res?.responses ?? []).slice(cursor, cursor + r.tokens.length);
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
    sent: (res?.successCount ?? 0) + webResults.reduce((total, result) => total + result.sent, 0),
    failed: (res?.failureCount ?? 0) + webResults.reduce((total, result) => total + result.failed, 0),
  });
}
