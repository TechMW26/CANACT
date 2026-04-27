'use client';

import { useEffect } from 'react';
import { ref, set } from 'firebase/database';
import { db, getFirebaseAuth } from '@/lib/firebase';

/**
 * Detect Capacitor's native Android/iOS runtime. Pure-web fallbacks are
 * silently no-op so the same component can mount in both contexts.
 */
function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.platform === 'android' || cap.platform === 'ios';
}

const ASKED_KEY = 'canact:perms:asked:v1';

/**
 * Globally-mounted component that, on first launch (and once per device after
 * sign-in), requests every permission Canact needs to operate while the app
 * is closed:
 *  - POST_NOTIFICATIONS (Android 13+): heads-up incoming-call popups.
 *  - Geolocation (fine): help-radius matching.
 *  - Battery optimization exemption: keeps the FCM stream alive while idle.
 *
 * It also subscribes to the FCM token (via @capacitor-firebase/messaging) and
 * persists it to RTDB at users/{uid}/fcmTokens/{token} so the Cloud Function
 * that watches incomingCalls can target the right device.
 */
export default function NativePermissionsBootstrapper() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;

    (async () => {
      // --- Notifications + FCM token -------------------------------------
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        if (cancelled) return;

        const perm = await FirebaseMessaging.checkPermissions();
        let granted = perm.receive === 'granted';
        if (!granted) {
          const req = await FirebaseMessaging.requestPermissions();
          granted = req.receive === 'granted';
        }
        if (granted) {
          await persistFcmToken(FirebaseMessaging);
          // Keep tokens fresh: refresh handler fires when Google rotates the
          // device token (rare but happens on app reinstall / data wipe).
          await FirebaseMessaging.addListener('tokenReceived', (event: { token: string }) => {
            if (event?.token) writeToken(event.token).catch(() => { /* noop */ });
          });
        }
      } catch (err) {
        // FCM only works when google-services.json is present in
        // android/app/. Without it the plugin throws here — log and move on
        // so location + battery prompts still happen.
        // eslint-disable-next-line no-console
        console.warn('[perms] FCM init skipped:', err);
      }

      // --- Location -------------------------------------------------------
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        if (cancelled) return;
        const status = await Geolocation.checkPermissions();
        if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
          await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[perms] location request failed:', err);
      }

      // --- Battery optimization exemption --------------------------------
      // Only ask once — opens the system settings dialog. Skip if we've
      // already prompted for it on this device.
      try {
        if (typeof window !== 'undefined' && !localStorage.getItem(ASKED_KEY)) {
          // No first-party Capacitor plugin exists, so we use the documented
          // intent URL via window.open. Android resolves the intent: scheme
          // and presents the "Allow Canact to ignore battery optimizations?"
          // system dialog.
          const intent =
            'intent:#Intent;' +
            'action=android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS;' +
            'package=com.canact.app;' +
            'end';
          // Fire-and-forget; user can dismiss.
          window.open(intent, '_system');
          localStorage.setItem(ASKED_KEY, '1');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[perms] battery exemption request failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return null;
}

async function persistFcmToken(FirebaseMessaging: any) {
  try {
    const { token } = await FirebaseMessaging.getToken();
    if (token) await writeToken(token);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[perms] getToken failed:', err);
  }
}

async function writeToken(token: string) {
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) return; // user not signed in yet; will retry next launch
  await set(ref(db, `users/${u.uid}/fcmTokens/${token}`), {
    platform: 'android',
    updatedAt: Date.now(),
  });
}
