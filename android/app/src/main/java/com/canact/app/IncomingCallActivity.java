package com.canact.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.TextView;

/**
 * Full-screen native call ringer. Launched by CanactCallMessagingService via
 * setFullScreenIntent (lockscreen) and startActivity (unlocked) the moment a
 * `type:call` FCM data message arrives.
 *
 * Renders an instant Answer / Decline screen — no WebView load required —
 * matching the look and feel of the system phone app and WhatsApp /
 * Instagram. Answer hands off to MainActivity via canact://call/<id>?action=answer
 * deep link so the existing WebRTC ringer / call screen takes over.
 */
public class IncomingCallActivity extends Activity {
    public static final String EXTRA_CALL_ID = "callId";
    public static final String EXTRA_FROM_NAME = "fromName";

    private MediaPlayer player;
    private Vibrator vibrator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // If we're being launched with a cancel intent (only happens when the
        // activity wasn't already running), bail out immediately — there's
        // nothing to ring for.
        Intent launchIntent = getIntent();
        if (launchIntent != null && "cancel".equals(launchIntent.getAction())) {
            finish();
            return;
        }

        // Show over the lockscreen + turn the screen on the moment the
        // activity launches, identical to a system phone-app ringer.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
            KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        setContentView(R.layout.activity_incoming_call);

        Intent i = getIntent();
        final String callId = i.getStringExtra(EXTRA_CALL_ID);
        String fromName = i.getStringExtra(EXTRA_FROM_NAME);
        if (fromName == null || fromName.isEmpty()) fromName = "Someone";

        ((TextView) findViewById(R.id.caller_name)).setText(fromName);

        ImageButton answer = findViewById(R.id.btn_answer);
        ImageButton decline = findViewById(R.id.btn_decline);

        answer.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                stopRinging();
                Intent open = new Intent(IncomingCallActivity.this, MainActivity.class);
                open.setAction(Intent.ACTION_VIEW);
                open.setData(Uri.parse("canact://call/" + callId + "?action=answer"));
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(open);
                finishAndDismiss();
            }
        });

        decline.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                stopRinging();
                // Hand the decline off to MainActivity via deep link — the
                // NativeCallDeepLinkRouter inside the WebView marks the
                // call rejected in RTDB, which then triggers the
                // cancelIncomingCall Cloud Function.
                Intent open = new Intent(IncomingCallActivity.this, MainActivity.class);
                open.setAction(Intent.ACTION_VIEW);
                open.setData(Uri.parse("canact://call/" + callId + "?action=decline"));
                open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                startActivity(open);
                finishAndDismiss();
            }
        });

        startRinging();
    }

    private void startRinging() {
        try {
            player = MediaPlayer.create(this, R.raw.canact_ringtone);
            if (player != null) {
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                player.setLooping(true);
                player.setVolume(1f, 1f);
                player.start();
            }
        } catch (Exception ignored) {}

        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = { 0, 1000, 800, 1000, 800 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) {}
    }

    private void stopRinging() {
        try { if (player != null) { player.stop(); player.release(); player = null; } } catch (Exception ignored) {}
        try { if (vibrator != null) vibrator.cancel(); } catch (Exception ignored) {}
    }

    private void finishAndDismiss() {
        // Also clear the heads-up notification we may have posted alongside.
        try {
            android.app.NotificationManager mgr =
                (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            String callId = getIntent().getStringExtra(EXTRA_CALL_ID);
            if (mgr != null && callId != null) mgr.cancel(callId.hashCode());
        } catch (Exception ignored) {}
        finish();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // If the FCM service fires a cancel/another call while we're already
        // up, just close — the service will re-launch us if a new call
        // arrives, and a cancel intent means this call is gone.
        if (intent != null && "cancel".equals(intent.getAction())) {
            stopRinging();
            finish();
        }
    }

    @Override
    protected void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // Block back — the user must explicitly answer or decline.
    }
}
