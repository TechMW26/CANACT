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
 *  - Microphone (RECORD_AUDIO): so the first incoming voice call can connect
 *    instantly without a permission dialog interrupting the ringing flow.
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
      await writeDebug('start');
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        if (cancelled) return;
        await writeDebug('plugin-loaded');

        const perm = await FirebaseMessaging.checkPermissions();
        let granted = perm.receive === 'granted';
        if (!granted) {
          const req = await FirebaseMessaging.requestPermissions();
          granted = req.receive === 'granted';
        }
        await writeDebug('perm:' + (granted ? 'granted' : perm.receive));
        if (granted) {
          try {
            const { token } = await FirebaseMessaging.getToken();
            await writeDebug('token:' + (token ? token.slice(0, 20) + '…' : 'EMPTY'));
            if (token) {
              cachedToken = token;
              // Try immediately (might already be signed in); the auth
              // listener above will retry if not.
              await writeToken(token);
              await writeDebug('persisted');
            }
          } catch (err: any) {
            await writeDebug('getToken-err:' + (err?.message || String(err)).slice(0, 200));
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
      } catch (err: any) {
        await writeDebug('init-err:' + (err?.message || String(err)).slice(0, 200));
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

      // --- Microphone (upfront) ------------------------------------------
      // Trigger Android's RECORD_AUDIO prompt now so the first incoming
      // voice call connects instantly. We open a short-lived audio track
      // and immediately stop it; the OS-level grant persists for the app.
      // Asked once per install via localStorage so we don't nag on every
      // launch if the user denied.
      try {
        const ASKED_MIC_KEY = 'canact:perms:mic:asked:v1';
        if (typeof window !== 'undefined' && !localStorage.getItem(ASKED_MIC_KEY)
            && navigator?.mediaDevices?.getUserMedia) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            stream.getTracks().forEach((t) => t.stop());
          } catch { /* user denied — they can re-enable in settings */ }
          localStorage.setItem(ASKED_MIC_KEY, '1');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[perms] mic request failed:', err);
      }

      // --- Full-screen-intent special access (Android 14+) ---------------
      // On Android 14+, USE_FULL_SCREEN_INTENT must be explicitly granted by
      // the user via Settings → Special access. Without it, our incoming
      // call activity will NOT auto-launch over the lockscreen — only a
      // heads-up notification appears. Open the settings page once per
      // device install so the user can enable it.
      try {
        const ASKED_FSI_KEY = 'canact:perms:fsi:asked:v1';
        if (typeof window !== 'undefined' && !localStorage.getItem(ASKED_FSI_KEY)) {
          // intent: URL to the per-app full-screen intent settings page.
          const intent =
            'intent:#Intent;' +
            'action=android.settings.MANAGE_APP_USE_FULL_SCREEN_INTENT;' +
            'data=package:com.canact.app;' +
            'end';
          window.open(intent, '_system');
          localStorage.setItem(ASKED_FSI_KEY, '1');
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[perms] full-screen intent request failed:', err);
      }
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
