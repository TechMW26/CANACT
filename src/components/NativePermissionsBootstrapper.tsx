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
 * Microphone/camera access stays feature-scoped and is requested only when a
 * user starts or answers a call.
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

    const prepareNotifications = async () => {
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        if (cancelled) return;
        const cur = await FirebaseMessaging.checkPermissions();
        if (cur.receive === 'granted') {
          await registerFcmToken((t) => { cachedToken = t; });
          return;
        }
        const key = 'canact:perms:notifications:asked:v1';
        if (localStorage.getItem(key)) return;
        // Mark before opening the OS dialog so dismissals cannot create a
        // prompt loop on remount or app resume.
        localStorage.setItem(key, '1');
        const req = await FirebaseMessaging.requestPermissions();
        await writeDebug(`notif:${req.receive}`);
        if (req.receive === 'granted') await registerFcmToken((t) => { cachedToken = t; });
      } catch (err: any) {
        await writeDebug('notif-err:' + (err?.message || String(err)).slice(0, 120));
      }
    };

    const prepareLocation = async () => {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        if (cancelled) return;
        const cur = await Geolocation.checkPermissions();
        if (cur.location === 'granted' || cur.coarseLocation === 'granted') return;
        const key = 'canact:perms:location:asked:v1';
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
        const req = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
        const granted = req.location === 'granted' || req.coarseLocation === 'granted';
        await writeDebug(`location:${granted ? 'granted' : 'denied'}`);
      } catch (err: any) {
        await writeDebug('loc-err:' + (err?.message || String(err)).slice(0, 120));
      }
    };

    (async () => {
      await writeDebug('start');
      await prepareNotifications();
      if (!cancelled) await prepareLocation();

      // --- Full-screen-intent special access (Android 14+) ---------------
      // Independent of the core trio above; runs after them so the user
      // isn't bounced to Settings before the in-app prompts finish.
      try {
        const ASKED_FSI_KEY = 'canact:perms:fsi:asked:v2';
        const { canUseFullScreenIntent, openFullScreenIntentSettings } = await import('@/lib/callPermissions');
        const okFsi = await canUseFullScreenIntent();
        if (!okFsi && typeof window !== 'undefined' && !localStorage.getItem(ASKED_FSI_KEY)) {
          await openFullScreenIntentSettings();
          localStorage.setItem(ASKED_FSI_KEY, '1');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[perms] full-screen intent request failed:', err);
      }

      // --- Battery-optimisation exemption (post-login only) --------------
      try {
        const ASKED_BAT_KEY = 'canact:perms:battery:asked:v1';
        if (typeof window !== 'undefined' && !localStorage.getItem(ASKED_BAT_KEY)) {
          await new Promise<void>((resolve) => {
            const off = onAuthStateChanged(getFirebaseAuth(), (u) => {
              if (u) { off(); resolve(); }
            });
            setTimeout(() => { try { off(); } catch {} resolve(); }, 90_000);
          });
          if (cancelled) return;
          const { isIgnoringBatteryOptimizations, requestIgnoreBatteryOptimizations } =
            await import('@/lib/callPermissions');
          const ignoring = await isIgnoringBatteryOptimizations();
          if (!ignoring) {
            await requestIgnoreBatteryOptimizations();
          }
          localStorage.setItem(ASKED_BAT_KEY, '1');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[perms] battery-opt request failed:', err);
      }
    })();

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, []);

  return null;
}

/**
 * Fetch the FCM token, persist it under the signed-in user, and register
 * a `tokenReceived` listener so future rotations are also captured.
 * Split out so it can be invoked the moment notification permission is
 * actually granted (not before — the plugin returns an empty string on
 * Android 13+ if POST_NOTIFICATIONS hasn't been granted yet).
 */
async function registerFcmToken(remember: (t: string) => void) {
  const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
  try {
    const { token } = await FirebaseMessaging.getToken();
    await writeDebug('token:' + (token ? token.slice(0, 20) + '…' : 'EMPTY'));
    if (token) {
      remember(token);
      await writeToken(token);
      await writeDebug('persisted');
    }
  } catch (err: any) {
    await writeDebug('getToken-err:' + (err?.message || String(err)).slice(0, 200));
  }
  try {
    await FirebaseMessaging.addListener('tokenReceived', (event: { token: string }) => {
      if (event?.token) {
        remember(event.token);
        writeToken(event.token).catch(() => { /* noop */ });
      }
    });
  } catch { /* noop */ }
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

async function writeDebug(stage: string) {
  try {
    const auth = getFirebaseAuth();
    const u = auth.currentUser;
    if (!u) return;
    await set(ref(db, `users/${u.uid}/fcmDebug`), {
      stage,
      at: Date.now(),
    });
  } catch { /* noop */ }
}
