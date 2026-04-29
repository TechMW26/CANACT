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

    // Default channel used by every non-call push (chat messages, help
    // alerts, ratings, etc). Bumping the suffix forces Android to recreate
    // the channel if we ever change its sound/importance.
    private static final String GENERAL_CHANNEL_ID = "canact_general_v1";
    private static final String GENERAL_CHANNEL_NAME = "General notifications";
    private static final String GENERAL_CHANNEL_DESC = "Messages, help requests, ratings and other updates";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        if (data == null) data = new java.util.HashMap<>();

        String type = data.get("type");
        String callId = data.get("callId");

        // ------------------------------------------------------------------
        // Call-specific message types come in as a data-only payload so the
        // service is guaranteed to wake. Everything else (chat, help, rating,
        // etc.) is delivered with an FCM `notification` field, which the SDK
        // auto-displays when backgrounded — we only need to handle them here
        // when the app is in the foreground (to surface a heads-up that the
        // SDK would otherwise swallow).
        // ------------------------------------------------------------------
        if ("call-cancel".equals(type) && callId != null && !callId.isEmpty()) {
            // Tell the foreground ringer service to stop (it cancels its
            // own notification + dismisses IncomingCallActivity).
            CallForegroundService.stopRinging(getApplicationContext(), callId);
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

        if ("call".equals(type) && callId != null && !callId.isEmpty()) {
            String fromName = data.get("fromName");
            if (fromName == null || fromName.isEmpty()) fromName = "Someone";
            String fromPhoto = data.get("fromPhoto");

            // If the WebView is in the foreground, IncomingCallRinger.tsx is
            // already ringing via its RTDB listener — adding a notification
            // here would just stack a second ringtone on top.
            if (isAppInForeground()) return;

            // Hand off to the foreground service. It owns the notification
            // lifecycle AND has the BAL exemption needed to launch the
            // full-screen IncomingCallActivity even on an unlocked device.
            CallForegroundService.startRinging(getApplicationContext(), callId, fromName, fromPhoto);
            return;
        }

        // -------- Generic push (chat / help / rating / system) --------
        // Only surface here when the app is foreground; otherwise the FCM
        // SDK has already shown the system notification using the `notification`
        // payload + GENERAL_CHANNEL_ID (declared as the default in the
        // manifest meta-data).
        if (!isAppInForeground()) return;

        RemoteMessage.Notification n = message.getNotification();
        String title = n != null ? n.getTitle() : data.get("title");
        String body = n != null ? n.getBody() : data.get("body");
        if ((title == null || title.isEmpty()) && (body == null || body.isEmpty())) return;

        ensureGeneralChannel();
        postGeneralNotification(title, body, data);
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

    private void ensureCallChannel() {
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

    private void postIncomingCallNotification(String callId, String fromName) {
        Context ctx = getApplicationContext();

        // The full-screen ringer activity that Android will auto-launch when
        // the device is locked (and that pops as a heads-up otherwise). This
        // is the *only* place we ask for the activity to be shown — we no
        // longer call startActivity() ourselves because background activity
        // launches are restricted on Android 10+ and silently fail.
        Intent ringer = new Intent(ctx, IncomingCallActivity.class);
        ringer.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
        ringer.putExtra(IncomingCallActivity.EXTRA_FROM_NAME, fromName);
        ringer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION);

        // Action-button intents.
        //   • DECLINE → BroadcastReceiver writes status:'rejected' to RTDB
        //     directly without ever waking the WebView. The user never has
        //     to leave the lock screen.
        //   • ANSWER  → must launch an Activity to bring the WebView
        //     forward (WebRTC lives in JS). Notification action taps that
        //     start an Activity get a foreground-launch exemption from
        //     Android's BAL restrictions, so we use getActivity() here.
        //     Background `BroadcastReceiver.startActivity()` would be
        //     blocked silently on Android 10+, which is why answer used
        //     to dismiss the notification but never bring the app up.
        Intent answer = new Intent(ctx, MainActivity.class);
        answer.setAction(Intent.ACTION_VIEW);
        answer.setData(Uri.parse("canact://call/" + callId + "?action=answer&accepted=1"));
        answer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        Intent decline = new Intent(ctx, CallActionReceiver.class);
        decline.setAction(CallActionReceiver.ACTION_DECLINE);
        decline.putExtra(CallActionReceiver.EXTRA_CALL_ID, callId);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent ringerPi = PendingIntent.getActivity(ctx, 1000, ringer, piFlags);
        // Unique request codes per callId so multiple concurrent calls
        // don't share the same PendingIntent.
        int answerRc = ("answer:" + callId).hashCode();
        int declineRc = ("decline:" + callId).hashCode();
        PendingIntent answerPi = PendingIntent.getActivity(ctx, answerRc, answer, piFlags);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, declineRc, decline, piFlags);

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Incoming call")
            .setContentText(fromName + " is calling")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            // CallStyle renders the proper full-width Answer/Decline UI on
            // both heads-up and lockscreen.
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(
                new Person.Builder().setName(fromName).setImportant(true).build(),
                declinePi,
                answerPi))
            .setContentIntent(ringerPi)
            // The critical bit: Android auto-launches the ringer activity
            // when the device is locked, and falls back to a heads-up
            // when it isn't — this is the same path WhatsApp / Phone use.
            .setFullScreenIntent(ringerPi, true)
            .build();

        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr != null) {
            mgr.notify(callId.hashCode(), n);
        }

        // setFullScreenIntent only auto-launches when the device is LOCKED.
        // On an unlocked device Android falls back to a heads-up — which
        // means the user never sees our full-screen ringer. Posting the
        // notification first grants this service a temporary background-
        // activity-launch (BAL) exemption (because the notification is
        // CATEGORY_CALL + we hold USE_FULL_SCREEN_INTENT), so kicking off
        // the activity here works in both states. This matches what
        // WhatsApp / Phone do.
        try {
            ctx.startActivity(ringer);
        } catch (Exception ignored) {
            // OEM blocked it; the heads-up notification still rings.
        }
    }

    private void ensureGeneralChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr == null) return;
        if (mgr.getNotificationChannel(GENERAL_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            GENERAL_CHANNEL_ID, GENERAL_CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(GENERAL_CHANNEL_DESC);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        mgr.createNotificationChannel(channel);
    }

    private void postGeneralNotification(String title, String body, Map<String, String> data) {
        Context ctx = getApplicationContext();

        // Tap → open the relevant screen inside the WebView. We use a
        // generic deep-link that the in-app router converts into a route
        // change (e.g. /inbox/<uid>, /help/<id>, /notifications).
        String deepLink = data.get("deepLink");
        if (deepLink == null || deepLink.isEmpty()) deepLink = "canact://open";

        Intent open = new Intent(ctx, MainActivity.class);
        open.setAction(Intent.ACTION_VIEW);
        open.setData(Uri.parse(deepLink));
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        // Unique request code per notification so concurrent pushes don't
        // overwrite each other's intents.
        int rc = (int) (System.currentTimeMillis() & 0x7fffffff);
        PendingIntent pi = PendingIntent.getActivity(ctx, rc, open, piFlags);

        Notification notif = new NotificationCompat.Builder(ctx, GENERAL_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title != null ? title : "Canact")
            .setContentText(body != null ? body : "")
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body != null ? body : ""))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build();

        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr != null) {
            mgr.notify(rc, notif);
        }
    }
}
