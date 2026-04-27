package com.canact.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
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
