package com.canact.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.core.graphics.drawable.RoundedBitmapDrawable;
import androidx.core.graphics.drawable.RoundedBitmapDrawableFactory;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

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
    public static final String EXTRA_FROM_PHOTO = "fromPhoto";

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
        String fromPhoto = i.getStringExtra(EXTRA_FROM_PHOTO);
        if (fromName == null || fromName.isEmpty()) fromName = "Someone";

        ((TextView) findViewById(R.id.caller_name)).setText(fromName);

        // Avatar: if a photo URL was passed, fetch it off the main thread
        // and swap the placeholder gradient + initials for the real image.
        // Otherwise fall back to a brand-coloured disc with the caller's
        // initials, matching the in-app Avatar component.
        TextView initialsView = findViewById(R.id.caller_initials);
        ImageView avatarView = findViewById(R.id.caller_avatar);
        initialsView.setText(extractInitials(fromName));
        if (fromPhoto != null && !fromPhoto.isEmpty() && fromPhoto.startsWith("http")) {
            loadAvatar(fromPhoto, avatarView, initialsView);
        }

        ImageButton answer = findViewById(R.id.btn_answer);
        ImageButton decline = findViewById(R.id.btn_decline);

        answer.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                Intent ans = new Intent(IncomingCallActivity.this, CallActionReceiver.class);
                ans.setAction(CallActionReceiver.ACTION_ANSWER);
                ans.putExtra(CallActionReceiver.EXTRA_CALL_ID, callId);
                sendBroadcast(ans);
                finishAndDismiss();
            }
        });

        decline.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) {
                // Decline directly via the broadcast receiver — writes
                // status:'rejected' to RTDB without ever waking the
                // WebView, so the user never has to unlock.
                Intent dec = new Intent(IncomingCallActivity.this, CallActionReceiver.class);
                dec.setAction(CallActionReceiver.ACTION_DECLINE);
                dec.putExtra(CallActionReceiver.EXTRA_CALL_ID, callId);
                sendBroadcast(dec);
                finishAndDismiss();
            }
        });

        // Ringtone + vibration come from the call notification channel
        // (CanactCallMessagingService.CHANNEL_ID). We deliberately do NOT
        // play our own MediaPlayer here, otherwise the system would ring
        // twice — once from the channel sound and once from us.
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
            finishAndDismiss();
        }
    }

    @Override
    public void onBackPressed() {
        // Block back — the user must explicitly answer or decline.
    }

    private static String extractInitials(String name) {
        if (name == null) return "?";
        String trimmed = name.trim();
        if (trimmed.isEmpty()) return "?";
        String[] parts = trimmed.split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length && sb.length() < 2; i++) {
            if (parts[i].length() > 0) sb.append(Character.toUpperCase(parts[i].charAt(0)));
        }
        return sb.length() == 0 ? "?" : sb.toString();
    }

    /**
     * Fetch the caller's avatar off the main thread and render it as a
     * round bitmap. Kept dependency-free \u2014 a one-shot AsyncTask is far
     * lighter than pulling Glide / Coil into the APK just for one image.
     */
    private void loadAvatar(final String url, final ImageView target, final View initialsOverlay) {
        new AsyncTask<Void, Void, Bitmap>() {
            @Override protected Bitmap doInBackground(Void... params) {
                HttpURLConnection conn = null;
                InputStream in = null;
                try {
                    URL u = new URL(url);
                    conn = (HttpURLConnection) u.openConnection();
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(6000);
                    conn.setInstanceFollowRedirects(true);
                    in = conn.getInputStream();
                    return BitmapFactory.decodeStream(in);
                } catch (Throwable t) {
                    return null;
                } finally {
                    try { if (in != null) in.close(); } catch (Throwable ignored) {}
                    if (conn != null) conn.disconnect();
                }
            }

            @Override protected void onPostExecute(Bitmap bmp) {
                if (bmp == null || isFinishing()) return;
                try {
                    RoundedBitmapDrawable drawable =
                        RoundedBitmapDrawableFactory.create(getResources(), bmp);
                    drawable.setCircular(true);
                    target.setImageDrawable(drawable);
                    target.setVisibility(View.VISIBLE);
                    initialsOverlay.setVisibility(View.GONE);
                } catch (Throwable ignored) {}
            }
        }.executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR);
    }
}
