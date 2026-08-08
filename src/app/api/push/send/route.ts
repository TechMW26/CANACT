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
  if (getApps().length) {
    _app = getApps()[0]!;
    return _app;
  }
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    const credentials = JSON.parse(json);
    _app = initializeApp({
      credential: cert(credentials),
      databaseURL:
        process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
        'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app',
    });
    return _app;
  } catch {
    return null;
  }
}

/**
 * POST /api/push/send
 * Body: { toUid: string, title: string, body?: string, url?: string, tag?: string }
 * Auth: Firebase ID token in `Authorization: Bearer <token>` header.
 *
 * Server verifies the caller, loads the recipient's stored FCM tokens, and
 * sends a data-only message that the SW renders (so we control the click URL).
 */
export async function POST(req: Request) {
  const app = admin();
  if (!app) return NextResponse.json({ ok: false, reason: 'admin-not-configured' }, { status: 503 });

  const authHeader = req.headers.get('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  let fromUid: string;
  try {
    const decoded = await getAuth(app).verifyIdToken(idToken);
    fromUid = decoded.uid;
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid-token' }, { status: 401 });
  }

  let payload: any;
  try { payload = await req.json(); } catch {
    return NextResponse.json({ ok: false, reason: 'bad-json' }, { status: 400 });
  }
  const { toUid, title, body, url, tag, image } = payload || {};
  if (!toUid || !title) {
    return NextResponse.json({ ok: false, reason: 'missing-fields' }, { status: 400 });
  }
  if (toUid === fromUid) {
    // Don't push to self.
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const database = getDatabase(app);
  const [tokensSnap, webPushSnap] = await Promise.all([
    database.ref(`users/${toUid}/pushTokens`).get(),
    database.ref(`users/${toUid}/webPushSubscriptions`).get(),
  ]);
  const tokensVal = (tokensSnap.val() ?? {}) as Record<string, { token: string }>;
  const tokens = Object.values(tokensVal).map((t) => t.token).filter(Boolean);
  const webPushSubscriptions = (webPushSnap.val() ?? {}) as Record<string, StoredWebPushSubscription>;
  if (tokens.length === 0 && Object.keys(webPushSubscriptions).length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  // Strip emojis from any user-provided text — product requirement.
  const stripEmoji = (s: string) =>
    String(s)
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const cleanTitle = stripEmoji(title).slice(0, 80) || 'Canact';
  const cleanBody = stripEmoji(body || '').slice(0, 200);
  const safeUrl = typeof url === 'string' ? url : '/';
  const safeImage = typeof image === 'string' && /^https?:\/\//.test(image) ? image : undefined;
  let webLink = new URL('/', req.url).href;
  try {
    webLink = new URL(safeUrl.startsWith('/') ? safeUrl : '/', req.url).href;
  } catch { /* use app root */ }

  const data: Record<string, string> = { title: cleanTitle, body: cleanBody, url: safeUrl };
  if (tag) data.tag = String(tag).slice(0, 60);
  if (safeImage) data.image = safeImage;

  const res = tokens.length ? await getMessaging(app).sendEachForMulticast({
    tokens,
    // Notification block ensures Android/iOS render in the system tray
    // even when the app is backgrounded or killed. The data block carries
    // the deep-link URL the click handler navigates to.
    notification: { title: cleanTitle, body: cleanBody, ...(safeImage ? { imageUrl: safeImage } : {}) },
    data,
    android: {
      priority: 'high',
      notification: {
        // Channel id is registered in AndroidManifest as the default
        // FCM channel; leaving it explicit guards against the platform
        // falling back to 'Miscellaneous'.
        channelId: 'canact_general_v1',
        clickAction: 'FCM_PLUGIN_ACTIVITY',
        ...(safeImage ? { imageUrl: safeImage } : {}),
      },
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: {
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        tag: tag ? String(tag).slice(0, 60) : undefined,
        ...(safeImage ? { image: safeImage } : {}),
      },
      fcmOptions: { link: webLink },
    },
  }) : null;

  const webResult = await sendWebPushSubscriptions(database, toUid, webPushSubscriptions, {
    title: cleanTitle,
    body: cleanBody,
    url: safeUrl,
    tag: tag ? String(tag).slice(0, 60) : undefined,
    image: safeImage,
  }, { urgency: 'high' });

  // Prune dead tokens.
  await Promise.all(
    (res?.responses ?? []).map(async (r, i) => {
      if (r.success) return;
      const code = r.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        const key = Object.keys(tokensVal).find((k) => tokensVal[k]?.token === tokens[i]);
        if (key) await database.ref(`users/${toUid}/pushTokens/${key}`).remove();
      }
    }),
  );

  return NextResponse.json({
    ok: true,
    sent: (res?.successCount ?? 0) + webResult.sent,
    failed: (res?.failureCount ?? 0) + webResult.failed,
  });
}
