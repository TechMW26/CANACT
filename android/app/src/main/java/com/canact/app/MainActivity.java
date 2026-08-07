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
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        normalizeNotificationDeepLink(getIntent());
        // Register custom plugins BEFORE super.onCreate so the Capacitor
        // bridge picks them up during initial plugin discovery.
        registerPlugin(AudioRouterPlugin.class);
        registerPlugin(CallPermissionsPlugin.class);
        super.onCreate(savedInstanceState);

        // Force GPU-accelerated rendering for the WebView so backdrop-blur
        // and glass-morphism effects render at 60fps without jank.
        try {
            WebView webView = getBridge().getWebView();
            webView.setLayerType(WebView.LAYER_TYPE_HARDWARE, null);
        } catch (Exception ignored) {}

        // Pre-create both notification channels at first launch so:
        //   * The FCM SDK has a real channel to attach auto-displayed
        //     `notification` payloads to (otherwise some Android versions
        //     drop them silently).
        //   * The user sees both Calls + General categories in App Info →
        //     Notifications immediately, and can tweak each independently.
        ensureNotificationChannels();
        cancelCallNotificationFor(getIntent());
        dismissRingerActivityFor(getIntent());
        // Start the persistent keep-alive foreground service so the
        // process survives the user swiping the app off recents —
        // without it Android tears the process down within minutes,
        // killing FCM + RTDB listeners and missing incoming calls.
        try { KeepAliveService.start(this); } catch (Exception ignored) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        normalizeNotificationDeepLink(intent);
        super.onNewIntent(intent);
        setIntent(intent);
        // singleTask launchMode means re-entries land here. Clear the
        // ringer notification + dismiss the lock-screen ringer activity
        // the moment the user taps Answer.
        cancelCallNotificationFor(intent);
        dismissRingerActivityFor(intent);
    }

    /** Legacy/auto-rendered FCM notifications launch the activity with data
     * extras instead of an Android VIEW URI. Convert those extras before the
     * Capacitor bridge starts so App.getLaunchUrl/appUrlOpen can route cold
     * and warm taps identically. Only relative in-app routes are accepted. */
    private void normalizeNotificationDeepLink(Intent intent) {
        if (intent == null || intent.getData() != null) return;
        String raw = intent.getStringExtra("deepLink");
        if (raw == null || raw.isEmpty()) raw = intent.getStringExtra("url");
        String route = null;
        try {
            if (raw != null && raw.startsWith("canact://open")) {
                route = Uri.parse(raw).getQueryParameter("to");
            } else if (raw != null && raw.startsWith("/") && !raw.startsWith("//")) {
                route = raw;
            }
            if (route != null && route.startsWith("/") && !route.startsWith("//")) {
                Uri uri = new Uri.Builder()
                    .scheme("canact")
                    .authority("open")
                    .appendQueryParameter("to", route)
                    .build();
                intent.setAction(Intent.ACTION_VIEW);
                intent.setData(uri);
            }
        } catch (Exception ignored) {}
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
            // Also stop the ringer foreground service so the ringtone
            // stops the moment we land on the in-app call screen.
            CallForegroundService.stopRinging(this, callId);
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

        createSoundChannel(
            mgr,
            "canact_general_v2",
            "General notifications",
            "Messages, help requests, ratings and other updates",
            R.raw.connection_card_notification);
        createSoundChannel(
            mgr,
            "canact_connection_cards_v1",
            "Connection cards",
            "Connection card recognition alerts",
            R.raw.connection_card_notification);
        createSoundChannel(
            mgr,
            "canact_lifetime_cards_v1",
            "Lifetime cards",
            "Lifetime card recognition alerts",
            R.raw.lifetime_card_notification);
    }

    private void createSoundChannel(
            NotificationManager mgr,
            String id,
            String name,
            String description,
            int soundResource) {
        if (mgr.getNotificationChannel(id) != null) return;
        NotificationChannel channel = new NotificationChannel(
            id, name, NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(description);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        Uri sound = Uri.parse("android.resource://" + getPackageName() + "/" + soundResource);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(sound, attrs);
        mgr.createNotificationChannel(channel);
    }
}
