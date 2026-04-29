package com.canact.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Pre-create both notification channels at first launch so:
        //   * The FCM SDK has a real channel to attach auto-displayed
        //     `notification` payloads to (otherwise some Android versions
        //     drop them silently).
        //   * The user sees both Calls + General categories in App Info →
        //     Notifications immediately, and can tweak each independently.
        ensureNotificationChannels();
        cancelCallNotificationFor(getIntent());
        dismissRingerActivityFor(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // singleTask launchMode means re-entries land here. Clear the
        // ringer notification + dismiss the lock-screen ringer activity
        // the moment the user taps Answer.
        cancelCallNotificationFor(intent);
        dismissRingerActivityFor(intent);
    }

    /**
     * If we were launched from a `canact://call/<id>?action=answer` deep
     * link (notification action button or IncomingCallActivity Answer),
     * cancel the heads-up call notification so it doesn't linger on top
     * of the in-app call screen.
     */
    private void cancelCallNotificationFor(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!"canact".equals(data.getScheme()) || !"call".equals(data.getHost())) return;
        try {
            String path = data.getPath();
            if (path == null) return;
            String callId = path.replaceAll("^/+", "").split("/")[0];
            if (callId.isEmpty()) return;
            NotificationManager mgr = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (mgr != null) mgr.cancel(callId.hashCode());
        } catch (Exception ignored) {}
    }

    /**
     * Also tell IncomingCallActivity (if visible on the lock screen) to
     * close itself, otherwise the user lands behind the ringer overlay.
     */
    private void dismissRingerActivityFor(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data == null) return;
        if (!"canact".equals(data.getScheme()) || !"call".equals(data.getHost())) return;
        try {
            String path = data.getPath();
            if (path == null) return;
            String callId = path.replaceAll("^/+", "").split("/")[0];
            if (callId.isEmpty()) return;
            Intent cancel = new Intent(this, IncomingCallActivity.class);
            cancel.setAction("cancel");
            cancel.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
            cancel.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startActivity(cancel);
        } catch (Exception ignored) {}
    }

    private void ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr == null) return;

        if (mgr.getNotificationChannel("canact_calls_v3") == null) {
            NotificationChannel calls = new NotificationChannel(
                "canact_calls_v3", "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
            calls.setDescription("Full-screen incoming voice calls");
            calls.enableVibration(true);
            calls.setVibrationPattern(new long[] { 0, 1000, 800, 1000, 800, 1000 });
            calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            Uri ringtone = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.canact_ringtone);
            AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            calls.setSound(ringtone, attrs);
            calls.setBypassDnd(true);
            mgr.createNotificationChannel(calls);
        }

        if (mgr.getNotificationChannel("canact_general_v1") == null) {
            NotificationChannel general = new NotificationChannel(
                "canact_general_v1", "General notifications", NotificationManager.IMPORTANCE_HIGH);
            general.setDescription("Messages, help requests, ratings and other updates");
            general.enableVibration(true);
            general.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            mgr.createNotificationChannel(general);
        }
    }
}
