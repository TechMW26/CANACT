package com.canact.app;

import android.app.ActivityManager;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.List;
import java.util.Map;

/**
 * Receives FCM push messages while the app is backgrounded or fully closed.
 *
 * The web layer relies on Firebase Realtime DB listeners to surface incoming
 * voice calls — those listeners die the moment the OS suspends or kills the
 * Capacitor process. To wake the device for an inbound call we deploy a
 * Cloud Function that, on every write under `incomingCalls/{toUid}/{callId}`,
 * sends a high-priority FCM data message to the recipient's device tokens
 * with payload:
 *   {
 *     type:       "call",
 *     callId:     "<id>",
 *     fromName:   "<caller display name>",
 *     fromPhoto:  "<caller photo url, optional>"
 *   }
 *
 * On receipt, this service builds a heads-up, full-screen call notification
 * that wakes the screen, plays the ringtone, and on tap launches MainActivity
 * via the canact://call/<id> deep link. The web app's IncomingCallRinger
 * picks that up and presents the live ringer / accept-decline UI.
 */
public class CanactCallMessagingService extends FirebaseMessagingService {

    // Bump the channel id whenever sound/vibration changes — Android does not
    // allow mutating an existing channel's sound, so a new id is required to
    // pick up the bundled ringtone on devices that already have the app.
    private static final String CHANNEL_ID = "canact_calls_v3";
    private static final String CHANNEL_NAME = "Incoming calls";
    private static final String CHANNEL_DESC = "Full-screen incoming voice calls";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        String type = data.get("type");
        String callId = data.get("callId");
        if (callId == null || callId.isEmpty()) return;

        if ("call-cancel".equals(type)) {
            // Caller hung up, recipient answered/rejected on another device,
            // or call timed out — dismiss the ringing notification so the
            // user isn't left with a stale "Incoming call" that no longer
            // matches reality.
            NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (mgr != null) mgr.cancel(callId.hashCode());
            // Also close the native ringer activity if it's currently up.
            try {
                Intent cancel = new Intent(getApplicationContext(), IncomingCallActivity.class);
                cancel.setAction("cancel");
                cancel.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
                cancel.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                getApplicationContext().startActivity(cancel);
            } catch (Exception ignored) {}
            return;
        }

        if (!"call".equals(type)) return;

        String fromName = data.get("fromName");
        if (fromName == null || fromName.isEmpty()) fromName = "Someone";

        // Pick exactly ONE delivery surface based on device state, so the
        // user never gets multiple ringtones playing at once:
        //   1. App is in the foreground → do nothing. The web layer's
        //      RTDB listener will surface the in-app ringer.
        //   2. Device is locked → launch full-screen IncomingCallActivity
        //      directly (no notification — it would just compete with the
        //      activity's ringtone).
        //   3. Otherwise (unlocked, app backgrounded) → post a heads-up
        //      CallStyle notification only.
        if (isAppInForeground()) {
            return;
        }
        ensureChannel();
        if (isDeviceLocked()) {
            launchFullScreenRinger(callId, fromName);
        } else {
            postHeadsUpCallNotification(callId, fromName);
        }
    }

    private boolean isAppInForeground() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return false;
            List<ActivityManager.RunningAppProcessInfo> procs = am.getRunningAppProcesses();
            if (procs == null) return false;
            String myPkg = getPackageName();
            for (ActivityManager.RunningAppProcessInfo p : procs) {
                if (p.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
                        && p.processName != null && p.processName.startsWith(myPkg)) {
                    return true;
                }
            }
        } catch (Exception ignored) {}
        return false;
    }

    private boolean isDeviceLocked() {
        try {
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km == null) return false;
            return km.isKeyguardLocked();
        } catch (Exception ignored) {
            return false;
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // The web layer (@capacitor-firebase/messaging) also surfaces the
        // refreshed token via the `tokenReceived` event, where we persist it
        // to the user profile. Nothing to do here.
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr == null) return;
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(CHANNEL_DESC);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 1000, 800, 1000, 800, 1000 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        Uri ringtone = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.canact_ringtone);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(ringtone, attrs);
        channel.setBypassDnd(true);
        mgr.createNotificationChannel(channel);
    }

    private void launchFullScreenRinger(String callId, String fromName) {
        Context ctx = getApplicationContext();
        Intent ringer = new Intent(ctx, IncomingCallActivity.class);
        ringer.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
        ringer.putExtra(IncomingCallActivity.EXTRA_FROM_NAME, fromName);
        ringer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        try {
            ctx.startActivity(ringer);
        } catch (Exception ignored) {
            // OEM may block background activity launch — fall back to a
            // heads-up notification so the user still sees something.
            postHeadsUpCallNotification(callId, fromName);
        }
    }

    private void postHeadsUpCallNotification(String callId, String fromName) {
        Context ctx = getApplicationContext();

        // Action-button intents → MainActivity (WebView). The deep-link
        // router stores the user's choice as a pre-decision so the in-app
        // ringer auto-applies it without prompting again.
        Intent answer = new Intent(ctx, MainActivity.class);
        answer.setAction(Intent.ACTION_VIEW);
        answer.setData(Uri.parse("canact://call/" + callId + "?action=answer"));
        answer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        Intent decline = new Intent(ctx, MainActivity.class);
        decline.setAction(Intent.ACTION_VIEW);
        decline.setData(Uri.parse("canact://call/" + callId + "?action=decline"));
        decline.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent answerPi = PendingIntent.getActivity(ctx, 1001, answer, piFlags);
        PendingIntent declinePi = PendingIntent.getActivity(ctx, 1002, decline, piFlags);
        // Tapping the body opens the WebView ringer (without a pre-decision).
        Intent body = new Intent(ctx, MainActivity.class);
        body.setAction(Intent.ACTION_VIEW);
        body.setData(Uri.parse("canact://call/" + callId + "?action=incoming"));
        body.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent bodyPi = PendingIntent.getActivity(ctx, 1003, body, piFlags);

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Incoming call")
            .setContentText(fromName + " is calling")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(
                new Person.Builder().setName(fromName).setImportant(true).build(),
                declinePi,
                answerPi))
            .setContentIntent(bodyPi)
            .build();

        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr != null) {
            mgr.notify(callId.hashCode(), n);
        }
    }
}
