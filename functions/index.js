/**
 * Cloud Function: notifyIncomingCall
 *
 * Watches `incomingCalls/{toUid}/{callId}` writes in Firebase Realtime DB and,
 * for each new call, sends a high-priority FCM data message to every device
 * token registered under `users/{toUid}/fcmTokens/*`. The message is picked
 * up by CanactCallMessagingService on the device which posts a full-screen
 * heads-up call notification — even when the app is closed or the screen is
 * off.
 *
 * --- Deploy ---
 *   1. cd functions
 *   2. npm install
 *   3. Make sure firebase.json points at this directory:
 *        { "functions": [{ "source": "functions", "runtime": "nodejs20" }] }
 *   4. firebase deploy --only functions:notifyIncomingCall
 *
 * --- Required setup ---
 *   - The Firebase project must have FCM (Cloud Messaging) enabled.
 *   - The Android app must have google-services.json at android/app/.
 *   - The web app writes its FCM token to users/{uid}/fcmTokens/{token}
 *     (handled by NativePermissionsBootstrapper).
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const webPush = require('web-push');

admin.initializeApp();

const WEB_APP_ORIGIN = 'https://canact.vercel.app';
const WEB_PUSH_PUBLIC_KEY = 'BDS7qJlMyIW31ry0K6VgPdB0X6dxxd_U3G7KDC67Fgfo7iSyCoFIVxnj3EwioCyblnCOQFBniPpqAZ7wc1T6aA4';
let webPushConfigured = false;

function configureWebPush() {
  if (webPushConfigured) return true;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!privateKey) return false;
  webPush.setVapidDetails(WEB_APP_ORIGIN, WEB_PUSH_PUBLIC_KEY, privateKey);
  webPushConfigured = true;
  return true;
}

async function sendStandardWebPush(db, uid, subscriptions, payload, options = {}) {
  const entries = Object.entries(subscriptions || {}).filter(([, subscription]) => (
    subscription && subscription.endpoint && subscription.keys
    && subscription.keys.auth && subscription.keys.p256dh
  ));
  if (!entries.length || !configureWebPush()) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  await Promise.all(entries.map(async ([key, subscription]) => {
    try {
      await webPush.sendNotification(subscription, JSON.stringify({
        data: payload,
        notification: {
          title: payload.title || 'Canact',
          body: payload.body || '',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          tag: payload.tag,
          image: payload.image,
        },
      }), {
        TTL: options.ttl || 86400,
        urgency: options.urgency || 'normal',
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      if (error && (error.statusCode === 404 || error.statusCode === 410)) {
        await db.ref(`users/${uid}/webPushSubscriptions/${key}`).remove();
      }
    }
  }));
  return { sent, failed };
}

function webRoute(deepLink) {
  try {
    const raw = String(deepLink || '/');
    if (raw.startsWith('canact://open')) {
      return new URL(raw).searchParams.get('to') || '/';
    }
    return raw.startsWith('/') ? raw : '/';
  } catch (_) {
    return '/';
  }
}

async function getRecipientTokens(db, uid) {
  const [nativeSnap, webSnap, standardWebSnap] = await Promise.all([
    db.ref(`users/${uid}/fcmTokens`).get(),
    db.ref(`users/${uid}/pushTokens`).get(),
    db.ref(`users/${uid}/webPushSubscriptions`).get(),
  ]);
  const native = Object.keys(nativeSnap.val() || {});
  const webEntries = Object.entries(webSnap.val() || {})
    .filter(([, value]) => value && typeof value.token === 'string');
  return {
    native,
    web: webEntries.map(([, value]) => value.token),
    webEntries,
    standardWeb: standardWebSnap.val() || {},
  };
}

async function pruneRejectedTokens(db, uid, kind, tokens, responses, webEntries) {
  const updates = {};
  responses.forEach((response, index) => {
    if (response.success) return;
    const code = response.error && response.error.code;
    if (code !== 'messaging/invalid-registration-token'
      && code !== 'messaging/registration-token-not-registered') return;
    if (kind === 'native') updates[`users/${uid}/fcmTokens/${tokens[index]}`] = null;
    else {
      const entry = webEntries.find(([, value]) => value.token === tokens[index]);
      if (entry) updates[`users/${uid}/pushTokens/${entry[0]}`] = null;
    }
  });
  if (Object.keys(updates).length) await db.ref().update(updates);
}

exports.notifyIncomingCall = functions
  .runWith({ secrets: ['WEB_PUSH_PRIVATE_KEY'] })
  .region('asia-southeast1')
  .database
  .ref('/incomingCalls/{toUid}/{callId}')
  .onCreate(async (_snapshot, context) => {
    const { toUid, callId } = context.params;
    const db = admin.database();

    // 1. Look up the call record so we can include caller name/photo.
    const callSnap = await db.ref(`calls/${callId}`).get();
    const call = callSnap.val();
    if (!call) {
      console.log(`[notifyIncomingCall] no call record for ${callId}`);
      return null;
    }
    const fromName = (call.from && call.from.name) || 'Someone';
    const rawPhoto = (call.from && call.from.photoURL) || '';
    // FCM caps each data message at 4KB. Photo URLs from Google
    // (lh3.googleusercontent.com/...=s96-c-...) or signed Firebase Storage
    // URLs can easily blow that, and data: URIs definitely will. Drop any
    // photo that isn't a short http(s) URL.
    const fromPhoto = rawPhoto.startsWith('http') && rawPhoto.length < 512 ? rawPhoto : '';

    // 2. Collect all device tokens for the recipient.
    const tokenSets = await getRecipientTokens(db, toUid);
    if (tokenSets.native.length === 0 && tokenSets.web.length === 0
      && Object.keys(tokenSets.standardWeb).length === 0) {
      console.log(`[notifyIncomingCall] no notification tokens for user ${toUid}`);
      return null;
    }

    // 3. Send a data-only message at HIGH priority. Data-only ensures the
    //    Android service handles the payload (and shows the full-screen
    //    notification) instead of the system auto-displaying a quiet one.
    const message = {
      data: {
        type: 'call',
        callId: String(callId),
        fromName: String(fromName),
        fromPhoto: String(fromPhoto),
        kind: String((call.kind === 'video') ? 'video' : 'audio'),
      },
      android: {
        priority: 'high',
        ttl: 60 * 1000, // call rings for ~1 min
      },
      tokens: tokenSets.native,
    };

    if (tokenSets.native.length) {
      const resp = await admin.messaging().sendEachForMulticast(message);
      console.log(`[notifyIncomingCall] native ${resp.successCount}/${tokenSets.native.length}`);
      await pruneRejectedTokens(db, toUid, 'native', tokenSets.native, resp.responses, []);
    }

    // Web/iOS Home Screen apps cannot display a native full-screen CallKit
    // surface. A high-urgency visible push wakes the PWA; tapping it opens
    // Canact where the existing incoming-call listener presents Answer/Reject.
    if (tokenSets.web.length) {
      const title = `${(call.kind === 'video') ? 'Video' : 'Voice'} call from ${fromName}`;
      const body = `${fromName} is calling you on Canact`;
      const route = `/?incomingCall=${encodeURIComponent(callId)}`;
      const webResp = await admin.messaging().sendEachForMulticast({
        tokens: tokenSets.web,
        notification: { title, body },
        data: {
          type: 'call',
          callId: String(callId),
          fromName: String(fromName),
          fromPhoto: String(fromPhoto),
          kind: String((call.kind === 'video') ? 'video' : 'audio'),
          title,
          body,
          url: route,
          tag: `call:${callId}`,
        },
        webpush: {
          headers: { Urgency: 'high', TTL: '60' },
          notification: {
            icon: `${WEB_APP_ORIGIN}/icons/icon-192.png`,
            badge: `${WEB_APP_ORIGIN}/icons/badge-72.png`,
            tag: `call:${callId}`,
            renotify: true,
            requireInteraction: true,
          },
          fcmOptions: { link: `${WEB_APP_ORIGIN}${route}` },
        },
      });
      console.log(`[notifyIncomingCall] web ${webResp.successCount}/${tokenSets.web.length}`);
      await pruneRejectedTokens(db, toUid, 'web', tokenSets.web, webResp.responses, tokenSets.webEntries);
    }

    if (Object.keys(tokenSets.standardWeb).length) {
      const title = `${(call.kind === 'video') ? 'Video' : 'Voice'} call from ${fromName}`;
      const body = `${fromName} is calling you on Canact`;
      const route = `/?incomingCall=${encodeURIComponent(callId)}`;
      const standardResult = await sendStandardWebPush(db, toUid, tokenSets.standardWeb, {
        type: 'call',
        callId: String(callId),
        fromName: String(fromName),
        fromPhoto: String(fromPhoto),
        kind: String((call.kind === 'video') ? 'video' : 'audio'),
        title,
        body,
        url: route,
        tag: `call:${callId}`,
      }, { urgency: 'high', ttl: 60 });
      console.log(`[notifyIncomingCall] standard web ${standardResult.sent}/${Object.keys(tokenSets.standardWeb).length}`);
    }
    return null;
  });

/**
 * Cloud Function: cancelIncomingCall
 *
 * Watches calls/{callId} status changes. When a ringing call transitions to
 * active / ended / rejected / missed, push a `type: 'call-cancel'` data
 * message to the recipient's devices so the FCM service can dismiss the
 * full-screen incoming-call notification (just like WhatsApp / Instagram
 * cancel the ringer when the caller hangs up or the user accepts on another
 * device).
 */
exports.cancelIncomingCall = functions
  .region('asia-southeast1')
  .database
  .ref('/calls/{callId}/status')
  .onUpdate(async (change, context) => {
    const before = change.before.val();
    const after = change.after.val();
    if (before === after) return null;
    if (after === 'ringing') return null; // still ringing, nothing to do

    const { callId } = context.params;
    const db = admin.database();

    // Need the recipient uid to know whose tokens to push to.
    const callSnap = await db.ref(`calls/${callId}`).get();
    const call = callSnap.val();
    const toUid = call && call.to && call.to.uid;
    if (!toUid) {
      console.log(`[cancelIncomingCall] no to.uid for ${callId}`);
      return null;
    }

    const tokensSnap = await db.ref(`users/${toUid}/fcmTokens`).get();
    const tokens = Object.keys(tokensSnap.val() || {});
    if (tokens.length === 0) return null;

    const message = {
      data: {
        type: 'call-cancel',
        callId: String(callId),
        reason: String(after),
      },
      android: {
        priority: 'high',
        ttl: 60 * 1000,
      },
      tokens,
    };

    try {
      const resp = await admin.messaging().sendEachForMulticast(message);
      console.log(`[cancelIncomingCall] cancel sent to ${resp.successCount}/${tokens.length} (status=${after})`);
    } catch (err) {
      console.warn('[cancelIncomingCall] send failed', err && err.message);
    }
    return null;
  });

// ---------------------------------------------------------------------------
// Generic push helpers
// ---------------------------------------------------------------------------

/**
 * Fetch every FCM token registered to a user and send a notification+data
 * push to each. `notification` ensures the OS auto-displays a heads-up when
 * the app is backgrounded; the `data` half lets the in-app foreground
 * service decide whether to show its own banner.
 *
 * Stale tokens (returned by FCM as invalid) are pruned automatically so
 * /users/{uid}/fcmTokens never accumulates dead entries.
 */
async function pushToUser(toUid, { title, body, deepLink, type, extra }) {
  if (!toUid) return;
  const db = admin.database();
  const tokenSets = await getRecipientTokens(db, toUid);
  if (tokenSets.native.length === 0 && tokenSets.web.length === 0
    && Object.keys(tokenSets.standardWeb).length === 0) {
    console.log(`[push] no tokens for ${toUid} (type=${type})`);
    return;
  }

  const cleanTitle = title || 'Canact';
  const cleanBody = body || '';
  const route = webRoute(deepLink);
  const data = {
    type: String(type || 'general'),
    deepLink: String(deepLink || 'canact://open'),
    title: String(cleanTitle),
    body: String(cleanBody),
  };
  if (extra && typeof extra === 'object') {
    Object.entries(extra).forEach(([k, v]) => {
      // Every value in an FCM data payload must be a string.
      if (v !== undefined && v !== null) data[k] = String(v);
    });
  }

  try {
    if (tokenSets.native.length) {
      const nativeResp = await admin.messaging().sendEachForMulticast({
        data,
        android: {
          priority: 'high',
          ttl: 24 * 60 * 60 * 1000,
        },
        tokens: tokenSets.native,
      });
      console.log(`[push:${type}] native ${nativeResp.successCount}/${tokenSets.native.length} to ${toUid}`);
      await pruneRejectedTokens(db, toUid, 'native', tokenSets.native, nativeResp.responses, []);
    }

    if (tokenSets.web.length) {
      const webData = {
        ...data,
        title: String(cleanTitle),
        body: String(cleanBody),
        url: route,
        tag: `${String(type || 'general')}:${String((extra && (extra.notificationId || extra.threadId || extra.helpId)) || toUid)}`,
      };
      const webResp = await admin.messaging().sendEachForMulticast({
        notification: { title: cleanTitle, body: cleanBody },
        data: webData,
        webpush: {
          headers: { Urgency: type === 'help-request' ? 'high' : 'normal', TTL: '86400' },
          notification: {
            icon: `${WEB_APP_ORIGIN}/icons/icon-192.png`,
            badge: `${WEB_APP_ORIGIN}/icons/badge-72.png`,
            tag: webData.tag,
          },
          fcmOptions: { link: `${WEB_APP_ORIGIN}${route}` },
        },
        tokens: tokenSets.web,
      });
      console.log(`[push:${type}] web ${webResp.successCount}/${tokenSets.web.length} to ${toUid}`);
      await pruneRejectedTokens(db, toUid, 'web', tokenSets.web, webResp.responses, tokenSets.webEntries);
    }

    if (Object.keys(tokenSets.standardWeb).length) {
      const webData = {
        ...data,
        title: String(cleanTitle),
        body: String(cleanBody),
        url: route,
        tag: `${String(type || 'general')}:${String((extra && (extra.notificationId || extra.threadId || extra.helpId)) || toUid)}`,
      };
      const standardResult = await sendStandardWebPush(db, toUid, tokenSets.standardWeb, webData, {
        urgency: type === 'help-request' ? 'high' : 'normal',
      });
      console.log(`[push:${type}] standard web ${standardResult.sent}/${Object.keys(tokenSets.standardWeb).length} to ${toUid}`);
    }
  } catch (err) {
    console.warn(`[push:${type}] failed`, err && err.message);
  }
}

/**
 * Cloud Function: notifyChatMessage
 *
 * Pushes a notification to the recipient on every new chat message so the
 * device buzzes even when the app is fully closed — matching WhatsApp /
 * Instagram DM behaviour. We deliberately don't push to the sender's own
 * tokens.
 */
exports.notifyChatMessage = functions
  .runWith({ secrets: ['WEB_PUSH_PRIVATE_KEY'] })
  .region('asia-southeast1')
  .database
  .ref('/chatMessages/{threadId}/{messageId}')
  .onCreate(async (snapshot, context) => {
    const msg = snapshot.val();
    if (!msg || msg.deleted) return null;

    const fromUid = msg.fromUid;
    const toUid = msg.toUid;
    if (!fromUid || !toUid || fromUid === toUid) return null;

    const db = admin.database();

    // Look up sender's display name. Fall back to "Someone" if missing.
    let fromName = 'Someone';
    try {
      const fromSnap = await db.ref(`users/${fromUid}`).get();
      const u = fromSnap.val() || {};
      fromName = u.displayName || u.name || u.username || 'Someone';
    } catch (_) {}

    // Truncate the message body so we never blow the FCM payload limit.
    const text = (msg.text || '').toString().slice(0, 180);
    const body = msg.attachment && msg.attachment.kind === 'post'
      ? '📎 Sent a post'
      : msg.attachment && msg.attachment.kind === 'reel'
        ? '🎬 Sent a reel'
        : text || 'Sent you a message';

    await pushToUser(toUid, {
      title: fromName,
      body,
      deepLink: `canact://open?to=/inbox/${fromUid}`,
      type: 'chat',
      extra: { fromUid, threadId: context.params.threadId },
    });
    return null;
  });

/**
 * Cloud Function: notifyAppNotification
 *
 * Single fan-out for every in-app notification stored at
 * `/notifications/{uid}/{id}`. The web layer already calls
 * `pushNotification(uid, item)` whenever:
 *   - someone offers help on your request
 *   - the asker confirms you as a helper
 *   - someone leaves a rating after a help session
 *   - follow / react / comment events
 *   - system messages
 * so a single trigger here delivers all of those as device push without us
 * having to wire each event individually.
 */
exports.notifyAppNotification = functions
  .runWith({ secrets: ['WEB_PUSH_PRIVATE_KEY'] })
  .region('asia-southeast1')
  .database
  .ref('/notifications/{toUid}/{id}')
  .onCreate(async (snapshot, context) => {
    const note = snapshot.val();
    if (!note) return null;
    const { toUid } = context.params;

    const title = note.title || 'Canact';
    const body = (note.body || '').toString().slice(0, 200);

    // Deep-link based on notification kind so a tap lands the user on the
    // right screen instead of just opening the app.
    let deepLink = 'canact://open?to=/notifications';
    const d = note.data || {};
    switch (note.kind) {
      case 'help':
        if (d.helpId) deepLink = `canact://open?to=/help/${d.helpId}`;
        break;
      case 'follow':
        if (d.fromUid) deepLink = `canact://open?to=/profile/${d.fromUid}`;
        break;
      case 'react':
      case 'comment':
        if (d.postId) deepLink = `canact://open?to=/post/${d.postId}`;
        break;
      default:
        break;
    }

    await pushToUser(toUid, {
      title,
      body,
      deepLink,
      type: note.kind || 'general',
      extra: { kind: note.kind, family: d.family, notificationId: context.params.id },
    });
    return null;
  });

/**
 * Cloud Function: notifyHelpRequest
 *
 * Help requests aren't stored under /notifications/{uid}/* (they're a feed),
 * but we still want to alert nearby users that something fresh has dropped.
 * Strategy: when a help is created with audience='public', push to everyone
 * in /helpAudience/{helpId}/{uid} which the web layer pre-computes (or, if
 * no audience list is provided, fall back to the help author's followers).
 *
 * If neither index exists yet, we silently skip — no harm done.
 */
exports.notifyHelpRequest = functions
  .runWith({ secrets: ['WEB_PUSH_PRIVATE_KEY'] })
  .region('asia-southeast1')
  .database
  .ref('/help/{helpId}')
  .onCreate(async (snapshot, context) => {
    const help = snapshot.val();
    if (!help || help.status !== 'open') return null;

    const { helpId } = context.params;
    const db = admin.database();

    // Prefer an explicit audience index if the web layer wrote one.
    let audience = [];
    try {
      const audSnap = await db.ref(`helpAudience/${helpId}`).get();
      audience = Object.keys(audSnap.val() || {});
    } catch (_) {}

    // Fall back: if no index, skip — fanning out to "all users" is too
    // expensive and out of scope here. The web feed will still show the
    // request to anyone browsing.
    if (audience.length === 0) {
      console.log(`[notifyHelpRequest] no audience index for ${helpId}; skipping`);
      return null;
    }

    const authorName = help.authorName || 'Someone nearby';
    const typeLabel = help.type === 'red' ? '🚨 Urgent help'
                    : help.type === 'orange' ? '🟠 Help needed'
                    : '🟡 Quick assist';
    const body = (help.text || '').toString().slice(0, 160);

    // Fan out in parallel — `pushToUser` is idempotent and self-pruning.
    await Promise.all(audience
      .filter((uid) => uid && uid !== help.uid)
      .map((uid) => pushToUser(uid, {
        title: `${typeLabel} · ${authorName}`,
        body,
        deepLink: `canact://open?to=/help/${helpId}`,
        type: 'help-request',
        extra: { helpId },
      })));
    return null;
  });
