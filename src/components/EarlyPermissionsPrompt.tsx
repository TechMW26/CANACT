'use client';

import { useEffect } from 'react';

function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.platform === 'android' || cap.platform === 'ios';
}

/**
 * Triggered as soon as the app boots — before sign-in — so the user is
 * prompted for notification permission immediately on first launch.
 *
 * The full bootstrap (FCM token persistence, location, mic prewarm) still
 * runs from `NativePermissionsBootstrapper` once the user has signed in.
 * Asking here as well is harmless: Capacitor's plugin no-ops if the perm
 * is already granted, so the system dialog only ever appears once.
 */
export default function EarlyPermissionsPrompt() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    (async () => {
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        if (cancelled) return;
        const perm = await FirebaseMessaging.checkPermissions();
        if (perm.receive !== 'granted') {
          await FirebaseMessaging.requestPermissions();
        }
      } catch { /* plugin not installed in web */ }
    })();
    return () => { cancelled = true; };
  }, []);
  return null;
}
