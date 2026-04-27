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

    private static final String CHANNEL_ID = "canact_calls";
    private static final String CHANNEL_NAME = "Incoming calls";
    private static final String CHANNEL_DESC = "Full-screen incoming voice calls";

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        Map<String, String> data = message.getData();
        if (data == null || data.isEmpty()) return;

        String type = data.get("type");
        if (!"call".equals(type)) return;

        String callId = data.get("callId");
        if (callId == null || callId.isEmpty()) return;

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
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(ringtone, attrs);
        mgr.createNotificationChannel(channel);
    }

    private void showIncomingCallNotification(String callId, String fromName) {
        Context ctx = getApplicationContext();

        // Tapping the notification body / "Answer" deep-links into the app on
        // canact://call/<id>. The intent filter on MainActivity routes it to
        // the WebView which navigates to /call/<id>.
        Intent answer = new Intent(Intent.ACTION_VIEW,
            Uri.parse("canact://call/" + callId + "?action=answer"));
        answer.setPackage(ctx.getPackageName());
        answer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        Intent decline = new Intent(Intent.ACTION_VIEW,
            Uri.parse("canact://call/" + callId + "?action=decline"));
        decline.setPackage(ctx.getPackageName());
        decline.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;

        PendingIntent answerPi = PendingIntent.getActivity(ctx, 1001, answer, piFlags);
        PendingIntent declinePi = PendingIntent.getActivity(ctx, 1002, decline, piFlags);
        PendingIntent contentPi = PendingIntent.getActivity(ctx, 1003, answer, piFlags);

        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Incoming call")
            .setContentText(fromName + " is calling")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(true)
            .setContentIntent(contentPi)
            .setFullScreenIntent(answerPi, true)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPi)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePi)
            .build();

        NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (mgr != null) {
            // Use the call-id hash as notification id so multiple concurrent
            // calls don't collapse into one.
            mgr.notify(callId.hashCode(), n);
        }
    }
}
