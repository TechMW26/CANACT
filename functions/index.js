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

admin.initializeApp();

exports.notifyIncomingCall = functions
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
    const tokensSnap = await db.ref(`users/${toUid}/fcmTokens`).get();
    const tokensVal = tokensSnap.val() || {};
    const tokens = Object.keys(tokensVal);
    if (tokens.length === 0) {
      console.log(`[notifyIncomingCall] no FCM tokens for user ${toUid}`);
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
      },
      android: {
        priority: 'high',
        ttl: 60 * 1000, // call rings for ~1 min
      },
      tokens,
    };

    const resp = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `[notifyIncomingCall] sent to ${resp.successCount}/${tokens.length} tokens`,
    );

    // 4. Prune any tokens FCM rejected as invalid so they don't accumulate.
    const stale = [];
    resp.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      ) {
        stale.push(tokens[i]);
      } else {
        console.warn('[notifyIncomingCall] send error', code, r.error && r.error.message);
      }
    });
    if (stale.length > 0) {
      const updates = {};
      stale.forEach((t) => { updates[`users/${toUid}/fcmTokens/${t}`] = null; });
      await db.ref().update(updates);
      console.log(`[notifyIncomingCall] pruned ${stale.length} stale tokens`);
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
