package com.canact.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Re-starts the persistent KeepAliveService after device boot or after the
 * app is updated. RECEIVE_BOOT_COMPLETED is already declared in the
 * manifest. Without this the service only starts when the user opens the
 * app — meaning a freshly-rebooted phone wouldn't ring for incoming calls
 * until the app is launched.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
            || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            try { KeepAliveService.start(context); } catch (Exception ignored) {}
        }
    }
}
