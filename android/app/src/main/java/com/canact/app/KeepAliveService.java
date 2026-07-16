package com.canact.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Persistent foreground service that keeps the Canact process alive even
 * after the user swipes the app away from the recents list. Without this
 * Android aggressively terminates background apps within a few minutes,
 * which means the FCM socket dies, RTDB listeners drop, and incoming
 * calls / messages are missed until the next app open.
 *
 * The service:
 *   - runs at low importance with a silent, persistent notification (no
 *     vibration, no sound) so the user knows Canact is "ready" but isn't
 *     pestered by it;
 *   - declares foregroundServiceType=dataSync so we honour the Android
 *     14+ FGS rules without needing user-prompted exemptions;
 *   - sets stopWithTask=false in the manifest so onTaskRemoved (swipe
 *     from recents) does NOT stop the service;
 *   - returns START_STICKY so the OS recreates the service after a
 *     low-memory kill.
 *
 * Tap on the notification opens MainActivity, matching what users expect.
 */
public class KeepAliveService extends Service {

    public static final String CHANNEL_ID = "canact_keepalive_v1";
    private static final int NOTIF_ID = 0xC0FFEE;

    public static void start(Context ctx) {
        try {
            Intent i = new Intent(ctx, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(i);
            } else {
                ctx.startService(i);
            }
        } catch (Exception ignored) { /* OEM may block — best effort */ }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception ignored) { /* ignore — better degraded than crash */ }
        return START_STICKY;
    }

    /**
     * Critical: do NOT stop on task removal. This is how the service
     * survives a swipe-from-recents and keeps the process resident so
     * the socket and RTDB listeners stay live.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // No-op. The OS will keep us running because we're a foreground
        // service. Re-issue the notification to be safe in case the
        // task removal somehow demoted us.
        try { startForeground(NOTIF_ID, buildNotification()); } catch (Exception ignored) {}
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr == null) return;
        if (mgr.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "Background activity", NotificationManager.IMPORTANCE_MIN);
        ch.setDescription("Keeps Canact ready to receive calls and messages");
        ch.setShowBadge(false);
        ch.enableVibration(false);
        ch.setSound(null, null);
        ch.setLockscreenVisibility(Notification.VISIBILITY_SECRET);
        mgr.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT
            | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, piFlags);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Canact")
            .setContentText("Ready for calls and messages")
            .setSmallIcon(R.mipmap.ic_notification)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setVisibility(NotificationCompat.VISIBILITY_SECRET)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setContentIntent(pi)
            .build();
    }
}
