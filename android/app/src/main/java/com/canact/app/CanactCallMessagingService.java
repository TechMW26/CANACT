package com.canact.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

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

        ensureChannel();
        showIncomingCallNotification(callId, fromName);
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

    private void showIncomingCallNotification(String callId, String fromName) {
        Context ctx = getApplicationContext();

        // Native full-screen ringer activity. Launching this directly gives
        // an instant phone-app-style call screen on both locked and
        // unlocked devices — no WebView load latency.
        Intent ringer = new Intent(ctx, IncomingCallActivity.class);
        ringer.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
        ringer.putExtra(IncomingCallActivity.EXTRA_FROM_NAME, fromName);
        ringer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION);

        // Action-button intents used by the heads-up notification fallback
        // (when USE_FULL_SCREEN_INTENT permission is missing). Both route
        // through MainActivity → WebView so the existing ringer / call UI
        // takes over, and decline writes status='rejected' to RTDB.
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

        PendingIntent ringerPi = PendingIntent.getActivity(ctx, 1000, ringer, piFlags);
        PendingIntent answerPi = PendingIntent.getActivity(ctx, 1001, answer, piFlags);
        PendingIntent declinePi = PendingIntent.getActivity(ctx, 1002, decline, piFlags);

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Incoming call")
            .setContentText(fromName + " is calling")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            // CallStyle is the official "treat this like a phone call" API
            // (Android 12+). Renders the proper full-width call UI on the
            // lockscreen with prominent Answer / Decline buttons — exactly
            // how WhatsApp / Instagram calls look. NotificationCompat
            // gracefully falls back to the legacy heads-up + actions on
            // Android 11 and below.
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(
                new Person.Builder().setName(fromName).setImportant(true).build(),
                declinePi,
                answerPi))
            .setContentIntent(ringerPi)
            .setFullScreenIntent(ringerPi, true)
            .build();

        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr != null) {
            // Use the call-id hash as notification id so multiple concurrent
            // calls don't collapse into one.
            mgr.notify(callId.hashCode(), n);
        }

        // Always launch the native ringer activity directly. setFullScreenIntent
        // alone only fires on a fully-locked device (and only if
        // USE_FULL_SCREEN_INTENT is granted on Android 14+); starting the
        // activity here covers the unlocked case so the user always sees
        // the proper call UI immediately.
        try {
            ctx.startActivity(ringer);
        } catch (Exception ignored) { /* OEM may block; notification still fires */ }
    }
}
