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

    // ---- Per-permission helpers -----------------------------------------
    // Each helper RETURNS a boolean indicating whether the permission is
    // granted right now. They're idempotent: safe to call repeatedly.
    // The runner below chains them sequentially and only advances to the
    // next one once the previous resolved as granted, so the user sees
    // one OS dialog at a time instead of three stacked on top of each
    // other (which on first launch caused users to miss prompts entirely).
    const ensureNotifications = async (): Promise<boolean> => {
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        if (cancelled) return false;
        const cur = await FirebaseMessaging.checkPermissions();
        if (cur.receive === 'granted') return true;
        const req = await FirebaseMessaging.requestPermissions();
        return req.receive === 'granted';
      } catch (err: any) {
        await writeDebug('notif-err:' + (err?.message || String(err)).slice(0, 120));
        return false;
      }
    };

    const ensureLocation = async (): Promise<boolean> => {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        if (cancelled) return false;
        const cur = await Geolocation.checkPermissions();
        if (cur.location === 'granted' || cur.coarseLocation === 'granted') return true;
        const req = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
        return req.location === 'granted' || req.coarseLocation === 'granted';
      } catch (err: any) {
        await writeDebug('loc-err:' + (err?.message || String(err)).slice(0, 120));
        return false;
      }
    };

    const ensureMic = async (): Promise<boolean> => {
      // Capacitor doesn't ship a first-class permissions plugin for the
      // microphone, so we rely on getUserMedia to trigger the OS dialog.
      // A successful resolve == granted; instantly stop the track to
      // release the mic. Any reject == denied / dismissed.
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((t) => t.stop());
        return true;
      } catch {
        return false;
      }
    };

    type Step = { id: 'notif' | 'location' | 'mic'; ensure: () => Promise<boolean> };
    const steps: Step[] = [
      { id: 'notif', ensure: ensureNotifications },
      { id: 'location', ensure: ensureLocation },
      { id: 'mic', ensure: ensureMic },
    ];

    // Tracks which steps are still ungranted across retry cycles so we
    // know when to stop nagging.
    const granted: Record<string, boolean> = { notif: false, location: false, mic: false };
    const RETRY_DELAY_MS = 8_000;
    const MAX_RETRIES = 6;
    let retries = 0;

    /**
     * Walk the steps in order. After a step is granted, run its
     * post-grant follow-up (FCM token write, etc.). If a step is denied
     * we BREAK the chain — the next permission isn't requested until
     * the user grants the current one (or a retry fires).
     */
    const runChain = async () => {
      await writeDebug('chain-start:' + retries);
      for (const step of steps) {
        if (cancelled) return;
        if (granted[step.id]) continue;
        const ok = await step.ensure();
        granted[step.id] = ok;
        await writeDebug(step.id + ':' + (ok ? 'granted' : 'denied'));
        if (step.id === 'notif' && ok) {
          // Now safe to fetch the FCM token (would have failed before
          // the user granted POST_NOTIFICATIONS on Android 13+).
          await registerFcmToken((t) => { cachedToken = t; }).catch(() => {});
        }
        if (!ok) break; // sequential gate — stop here, retry will pick up
      }
    };

    /** Re-run the chain on a timer until everything is granted or we
     *  hit the retry cap. This catches the case where the user swipes
     *  away a system dialog by mistake — we re-prompt a few seconds
     *  later instead of leaving the permission silently broken. */
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRetry = () => {
      if (cancelled) return;
      if (granted.notif && granted.location && granted.mic) return; // done
      if (retries >= MAX_RETRIES) return;
      retryTimer = setTimeout(async () => {
        retries += 1;
        await runChain();
        scheduleRetry();
      }, RETRY_DELAY_MS);
    };

    (async () => {
      await writeDebug('start');
      await runChain();
      scheduleRetry();

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
      if (retryTimer) clearTimeout(retryTimer);
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
