package com.canact.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Bridges the Android-only "special access" toggles required for an
 * Instagram / WhatsApp-style incoming-call ringer:
 *
 *   USE_FULL_SCREEN_INTENT  (Android 14+) \u2014 without it, our incoming-call
 *     CallStyle notification is downgraded to a plain heads-up and our
 *     IncomingCallActivity never auto-launches over the lockscreen.
 *     The grant is per-app and managed via a dedicated Settings page; users
 *     must flip it themselves.
 *
 * `check()` returns whether the permission is currently granted, so the JS
 * bootstrapper can decide whether to send the user to Settings on first
 * launch (and never nag again once granted). `requestSettings()` opens the
 * exact per-app toggle page so the user can flip it in one tap.
 */
@CapacitorPlugin(name = "CallPermissions")
public class CallPermissionsPlugin extends Plugin {

    @PluginMethod
    public void canUseFullScreenIntent(PluginCall call) {
        Context ctx = getContext();
        boolean granted = true; // default-true on pre-14; the permission is install-time granted there
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                NotificationManager mgr = ctx.getSystemService(NotificationManager.class);
                granted = mgr != null && mgr.canUseFullScreenIntent();
            } catch (Throwable t) {
                granted = false;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT < 34) {
            // Pre-14 \u2014 nothing to open; permission is granted at install.
            call.resolve();
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Throwable t) {
            // Fallback to generic app notification settings on quirky OEMs.
            try {
                Intent fallback = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                fallback.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                call.resolve();
            } catch (Throwable t2) {
                call.reject("Could not open settings: " + t2.getMessage());
            }
        }
    }

    /**
     * IGNORE_BATTERY_OPTIMIZATIONS — without this, Doze / App Standby will
     * eventually freeze our process when the screen is off, dropping the
     * FCM socket so incoming-call pushes arrive minutes late or not at all.
     * The user must grant it through the system dialog (we can't grant it
     * silently). Returns true on pre-M devices where the concept doesn't
     * exist yet.
     */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        boolean ignoring = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
                ignoring = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
            } catch (Throwable t) {
                ignoring = false;
            }
        }
        JSObject ret = new JSObject();
        ret.put("granted", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        // Prefer the direct "Allow" prompt (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
        // is declared in the manifest). Falls back to the full settings
        // list on OEMs (Xiaomi, OPPO…) that block the direct intent.
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + ctx.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            call.resolve();
        } catch (Throwable t) {
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fallback);
                call.resolve();
            } catch (Throwable t2) {
                call.reject("Could not open battery settings: " + t2.getMessage());
            }
        }
    }
}
