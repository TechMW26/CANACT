package com.canact.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

/**
 * Short-lived foreground service that owns the lifetime of an incoming call's
 * ringer. Started by {@link CanactCallMessagingService} the moment an FCM
 * `type=call` message arrives.
 *
 * Why a foreground service?
 *   • An FCM `FirebaseMessagingService` is a normal background service. On
 *     Android 10+ it cannot reliably call `startActivity()` (BAL restriction)
 *     — which means our full-screen {@link IncomingCallActivity} silently
 *     fails to appear when the screen is unlocked.
 *   • Promoting to a foreground service with `serviceType=phoneCall` grants
 *     a permanent BAL exemption for the duration of the service. This is
 *     exactly the path WhatsApp / Telegram / Signal take.
 *   • Bonus: the notification is genuinely sticky (`setOngoing` honoured),
 *     so the user can't accidentally swipe-dismiss an incoming call.
 *
 * Lifecycle:
 *   START_RING(callId, fromName) → post notification, launch ringer activity
 *   STOP(callId)                 → cancel notification, stop self
 */
public class CallForegroundService extends Service {

    public static final String ACTION_START_RING = "com.canact.app.START_CALL_RING";
    public static final String ACTION_STOP = "com.canact.app.STOP_CALL_RING";
    public static final String EXTRA_CALL_ID = "callId";
    public static final String EXTRA_FROM_NAME = "fromName";
    public static final String EXTRA_FROM_PHOTO = "fromPhoto";

    private static final String CHANNEL_ID = "canact_calls_v4";
    private static final String TAG = "CallFgSvc";
    private String currentCallId;
    private PowerManager.WakeLock wakeLock;

    /** Convenience: kick the service into "ringing" state. */
    public static void startRinging(Context ctx, String callId, String fromName, String fromPhoto) {
        Intent i = new Intent(ctx, CallForegroundService.class);
        i.setAction(ACTION_START_RING);
        i.putExtra(EXTRA_CALL_ID, callId);
        i.putExtra(EXTRA_FROM_NAME, fromName);
        i.putExtra(EXTRA_FROM_PHOTO, fromPhoto);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    /** Convenience: tell the service to stop ringing for the given call. */
    public static void stopRinging(Context ctx, String callId) {
        Intent i = new Intent(ctx, CallForegroundService.class);
        i.setAction(ACTION_STOP);
        i.putExtra(EXTRA_CALL_ID, callId);
        try {
            ctx.startService(i);
        } catch (Exception ignored) {
            // Service may already be dead — caller will just NotificationManager.cancel().
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelfSafely(); return START_NOT_STICKY; }
        String action = intent.getAction();
        String callId = intent.getStringExtra(EXTRA_CALL_ID);

        if (ACTION_STOP.equals(action)) {
            // If the active call matches, stop. Otherwise keep ringing the
            // newer call.
            if (callId != null && callId.equals(currentCallId)) {
                cancelNotification(callId);
                stopSelfSafely();
            } else if (callId != null) {
                cancelNotification(callId);
            }
            return START_NOT_STICKY;
        }

        if (!ACTION_START_RING.equals(action) || callId == null) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        String fromName = intent.getStringExtra(EXTRA_FROM_NAME);
        if (fromName == null || fromName.isEmpty()) fromName = "Someone";
        String fromPhoto = intent.getStringExtra(EXTRA_FROM_PHOTO);

        currentCallId = callId;

        // Wake the CPU + screen the moment FCM hands us the message. Without
        // this, on Android 12+ the screen often stays off when an FCM
        // foreground service launches an activity from a cold-start — the
        // notification rings but the lockscreen ringer never appears.
        // Using SCREEN_BRIGHT_WAKE_LOCK | ACQUIRE_CAUSES_WAKEUP because
        // FULL_WAKE_LOCK is deprecated since API 17.
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    //noinspection deprecation — SCREEN_BRIGHT is the only flag
                    // that reliably wakes the display from a service.
                    wakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                            | PowerManager.ACQUIRE_CAUSES_WAKEUP
                            | PowerManager.ON_AFTER_RELEASE,
                        "canact:incomingCall");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                // Auto-release after 60s — ringtone duration cap.
                wakeLock.acquire(60_000L);
            }
        } catch (Throwable t) {
            Log.w(TAG, "wake lock failed", t);
        }

        Notification n = buildCallNotification(callId, fromName);

        // Promote to foreground. Try phoneCall first (BAL exemption + most
        // accurate UX), then specialUse (Android 14+ fall-back when
        // MANAGE_OWN_CALLS isn't fully recognised by the OEM ROM), then
        // a plain startForeground without a type (pre-Q). On any failure
        // we still post the notification + try to launch the activity —
        // a half-working ringer is better than no ringer at all.
        boolean foregroundOk = false;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    startForeground(callId.hashCode(), n,
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
                    foregroundOk = true;
                } catch (Throwable t1) {
                    Log.w(TAG, "phoneCall fgs failed, trying specialUse", t1);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        try {
                            startForeground(callId.hashCode(), n,
                                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                            foregroundOk = true;
                        } catch (Throwable t2) {
                            Log.w(TAG, "specialUse fgs failed, trying plain", t2);
                            startForeground(callId.hashCode(), n);
                            foregroundOk = true;
                        }
                    } else {
                        startForeground(callId.hashCode(), n);
                        foregroundOk = true;
                    }
                }
            } else {
                startForeground(callId.hashCode(), n);
                foregroundOk = true;
            }
        } catch (Throwable t) {
            Log.w(TAG, "all startForeground variants failed", t);
            // Plain notify so the heads-up + sound + setFullScreenIntent at
            // least fire — the OS will auto-launch the activity from FSI
            // on a locked device.
            try {
                NotificationManager mgr = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (mgr != null) mgr.notify(callId.hashCode(), n);
            } catch (Throwable ignored) {}
        }

        // Always attempt the explicit activity launch — if startForeground
        // succeeded with phoneCall/specialUse we have BAL exemption; if it
        // didn't, the call is still better off trying than not. Android
        // will silently no-op when the launch is blocked.
        //
        // Pre-warm MainActivity (the WebView) FIRST so it ends up below
        // the ringer in the back stack. Cold-launching MainActivity
        // AFTER the user taps Answer means they have to wait for the
        // WebView + JS bundle + React hydration (~1-3s on mid-range
        // Android) before WebRTC even starts. By pre-warming here we
        // move that work into the few seconds of ringing — when the
        // user accepts, the deep-link arrives as an onNewIntent on the
        // already-hydrated MainActivity and InAppCallSheet mounts in
        // milliseconds.
        try {
            Intent warm = new Intent(this, MainActivity.class);
            warm.setAction("com.canact.app.PREWARM");
            warm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
            startActivity(warm);
        } catch (Throwable t) {
            Log.w(TAG, "MainActivity pre-warm blocked", t);
        }

        Intent ringer = new Intent(this, IncomingCallActivity.class);
        ringer.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
        ringer.putExtra(IncomingCallActivity.EXTRA_FROM_NAME, fromName);
        ringer.putExtra(IncomingCallActivity.EXTRA_FROM_PHOTO, fromPhoto);
        ringer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP
            | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        try {
            startActivity(ringer);
        } catch (Throwable t) {
            Log.w(TAG, "startActivity blocked, relying on FSI from notification", t);
        }
        // Suppress the unused-warning while keeping the local readable.
        if (!foregroundOk) Log.w(TAG, "Service is not in true foreground state");

        return START_NOT_STICKY;
    }

    private Notification buildCallNotification(String callId, String fromName) {
        Context ctx = getApplicationContext();

        Intent ringer = new Intent(ctx, IncomingCallActivity.class);
        ringer.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
        ringer.putExtra(IncomingCallActivity.EXTRA_FROM_NAME, fromName);
        ringer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
            | Intent.FLAG_ACTIVITY_CLEAR_TOP
            | Intent.FLAG_ACTIVITY_SINGLE_TOP);

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
        PendingIntent answerPi = PendingIntent.getActivity(ctx, ("answer:" + callId).hashCode(), answer, piFlags);
        PendingIntent declinePi = PendingIntent.getBroadcast(ctx, ("decline:" + callId).hashCode(), decline, piFlags);

        ensureChannel();

        return new NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_notification)
            .setContentTitle("Incoming call")
            .setContentText(fromName + " is calling")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setStyle(NotificationCompat.CallStyle.forIncomingCall(
                new Person.Builder().setName(fromName).setImportant(true).build(),
                declinePi,
                answerPi))
            .setContentIntent(ringerPi)
            .setFullScreenIntent(ringerPi, true)
            .build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager mgr = getSystemService(NotificationManager.class);
        if (mgr == null || mgr.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Full-screen incoming voice calls");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 1000, 800, 1000, 800, 1000 });
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        // Use the user's system phone ringtone — same UX as a real call.
        Uri ringtone = RingtoneManager.getActualDefaultRingtoneUri(getApplicationContext(), RingtoneManager.TYPE_RINGTONE);
        if (ringtone == null) ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        if (ringtone == null) ringtone = Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.canact_ringtone);
        AudioAttributes attrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        channel.setSound(ringtone, attrs);
        channel.setBypassDnd(true);
        mgr.createNotificationChannel(channel);
    }

    private void cancelNotification(String callId) {
        try {
            NotificationManager mgr = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (mgr != null) mgr.cancel(callId.hashCode());
        } catch (Exception ignored) {}
    }

    private void stopSelfSafely() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Throwable ignored) {}
        wakeLock = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Throwable ignored) {}
        wakeLock = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
