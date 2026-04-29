package com.canact.app;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;

import java.util.HashMap;
import java.util.Map;

/**
 * Handles taps on the Answer / Decline buttons of the incoming-call
 * notification (or the lock-screen IncomingCallActivity) directly from the
 * notification surface.
 *
 * Why a BroadcastReceiver and not an Activity?
 *   - Tapping a notification action button to launch an Activity forces
 *     Android to bring the app to the foreground and unlock the device,
 *     which is exactly what we DON'T want for a quick decline.
 *   - A BroadcastReceiver runs in the background, can write to RTDB, and
 *     dismisses the notification without disturbing whatever the user was
 *     doing.
 *
 * For ANSWER we still need to bring the WebView forward (WebRTC lives in
 * JS), so we forward to MainActivity via the canact://call/<id>?action=answer
 * deep link — but the receiver still gets a chance to cancel the ringer
 * notification + finish the lock-screen ringer activity first.
 *
 * For DECLINE we write `status: 'rejected'` straight to RTDB using the
 * Firebase Auth token of the currently signed-in user. The Cloud Function
 * `cancelIncomingCall` then propagates the status to the caller's WebView.
 */
public class CallActionReceiver extends BroadcastReceiver {

    public static final String ACTION_ANSWER = "com.canact.app.CALL_ANSWER";
    public static final String ACTION_DECLINE = "com.canact.app.CALL_DECLINE";
    public static final String EXTRA_CALL_ID = "callId";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String callId = intent.getStringExtra(EXTRA_CALL_ID);
        if (callId == null || callId.isEmpty()) return;

        // 1) Always cancel the heads-up notification + dismiss the ringer
        //    activity immediately so the user sees instant feedback.
        cancelNotification(context, callId);
        dismissRinger(context, callId);

        if (ACTION_DECLINE.equals(intent.getAction())) {
            writeStatus(callId, "rejected");
            // Also clear our incomingCalls/{uid}/{callId} pointer if we
            // know who we are. The Cloud Function will do this anyway,
            // but doing it eagerly suppresses a stale ringtone retry.
            try {
                com.google.firebase.auth.FirebaseUser u =
                    com.google.firebase.auth.FirebaseAuth.getInstance().getCurrentUser();
                if (u != null) {
                    FirebaseDatabase.getInstance()
                        .getReference("incomingCalls/" + u.getUid() + "/" + callId)
                        .removeValue();
                }
            } catch (Exception ignored) {}
            return;
        }

        if (ACTION_ANSWER.equals(intent.getAction())) {
            // Open the WebView with the deep link — the in-app router
            // turns this into a pre-decision the IncomingCallRinger
            // applies as soon as the RTDB listener fires.
            Intent open = new Intent(context, MainActivity.class);
            open.setAction(Intent.ACTION_VIEW);
            open.setData(Uri.parse("canact://call/" + callId + "?action=answer&accepted=1"));
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try {
                context.startActivity(open);
            } catch (Exception ignored) {}
        }
    }

    private void cancelNotification(Context ctx, String callId) {
        try {
            NotificationManager mgr = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (mgr != null) mgr.cancel(callId.hashCode());
        } catch (Exception ignored) {}
    }

    private void dismissRinger(Context ctx, String callId) {
        try {
            Intent cancel = new Intent(ctx, IncomingCallActivity.class);
            cancel.setAction("cancel");
            cancel.putExtra(IncomingCallActivity.EXTRA_CALL_ID, callId);
            cancel.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            ctx.startActivity(cancel);
        } catch (Exception ignored) {}
    }

    private void writeStatus(String callId, String status) {
        try {
            DatabaseReference ref = FirebaseDatabase.getInstance()
                .getReference("calls/" + callId);
            Map<String, Object> updates = new HashMap<>();
            updates.put("status", status);
            updates.put("endedAt", System.currentTimeMillis());
            ref.updateChildren(updates);
        } catch (Exception ignored) {}
    }
}
