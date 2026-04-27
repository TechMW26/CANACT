'use client';

import { useEffect } from 'react';
import { ref, set } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
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

/**
 * Globally-mounted component that, on first launch (and once per device after
 * sign-in), requests permissions Canact needs to deliver calls while closed:
 *  - POST_NOTIFICATIONS (Android 13+): heads-up incoming-call popups.
 *  - Geolocation (fine): help-radius matching.
 *
 * Mic / camera permissions are intentionally NOT pre-requested — Android's
 * getUserMedia prompt fires the first time the user accepts a call, exactly
 * like Instagram / WhatsApp.
 *
 * It also subscribes to the FCM token (via @capacitor-firebase/messaging) and
 * persists it to RTDB at users/{uid}/fcmTokens/{token} so the Cloud Function
 * that watches incomingCalls can target the right device.
 */
export default function NativePermissionsBootstrapper() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    let cachedToken: string | null = null;

    // Re-persist the FCM token whenever the auth state changes so we always
    // associate the device's current token with the signed-in user — even
    // if FCM emitted the token before sign-in completed.
    const auth = getFirebaseAuth();
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (cancelled || !u || !cachedToken) return;
      writeToken(cachedToken).catch(() => { /* noop */ });
    });

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
          try {
            const { token } = await FirebaseMessaging.getToken();
            if (token) {
              cachedToken = token;
              // Try immediately (might already be signed in); the auth
              // listener above will retry if not.
              await writeToken(token);
            }
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[perms] getToken failed:', err);
          }
          // Keep tokens fresh: refresh handler fires when Google rotates the
          // device token (rare but happens on app reinstall / data wipe).
          await FirebaseMessaging.addListener('tokenReceived', (event: { token: string }) => {
            if (event?.token) {
              cachedToken = event.token;
              writeToken(event.token).catch(() => { /* noop */ });
            }
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

      // NOTE: We deliberately do NOT prompt for battery-optimization
      // exemption or autostart. WhatsApp / Instagram-style call delivery is
      // achieved entirely through high-priority FCM data messages +
      // NotificationCompat.CallStyle.forIncomingCall + USE_FULL_SCREEN_INTENT
      // — none of which require the user to dig through settings.
    })();

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, []);

  return null;
}

async function writeToken(token: string) {
  const auth = getFirebaseAuth();
  const u = auth.currentUser;
  if (!u) return; // user not signed in yet; auth listener will retry
  await set(ref(db, `users/${u.uid}/fcmTokens/${token}`), {
    platform: 'android',
    updatedAt: Date.now(),
  });
}
