'use client';
import { firebaseApp } from '../firebase';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { ref, set, remove } from 'firebase/database';
import { db } from '../firebase';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
let foregroundListenerReady = false;

function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandaloneWebApp() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function webPushInstallRequired() {
  return isIosDevice() && !isStandaloneWebApp();
}

function tokenKey(token: string) {
  // Stable, short key for RTDB (Firebase keys can't include '/')
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Request notification permission, bind FCM to the app service worker, and save
 * the issued token under `users/{uid}/pushTokens/{hash}`. Safe to call
 * repeatedly so an existing grant can refresh an expired browser token.
 */
export async function enableWebPush(uid: string): Promise<{ ok: boolean; reason?: string; token?: string }> {
  if (typeof window === 'undefined') return { ok: false, reason: 'ssr' };
  // iOS exposes Web Push only to apps launched from the Home Screen.
  if (webPushInstallRequired()) return { ok: false, reason: 'ios-install-required' };
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported' };
  }
  try {
    const supported = await isSupported();
    if (!supported) return { ok: false, reason: 'not-supported' };
  } catch { return { ok: false, reason: 'not-supported' }; }

  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };

  // The app already owns the root scope with /sw.js. Registering a second
  // Firebase worker at the same scope replaces the offline/cache worker and
  // is unreliable on iOS. FCM can bind to our existing worker directly.
  const reg = await navigator.serviceWorker.register('/sw.js?v=push', { scope: '/' });
  await navigator.serviceWorker.ready;

  const messaging = getMessaging(firebaseApp);
  // Firebase supplies its managed default Web Push key when a project-specific
  // public VAPID key has not been configured yet.
  const token = await getToken(messaging, {
    ...(VAPID_KEY ? { vapidKey: VAPID_KEY } : {}),
    serviceWorkerRegistration: reg,
  });
  if (!token) return { ok: false, reason: 'no-token' };

  await set(ref(db, `users/${uid}/pushTokens/${tokenKey(token)}`), {
    token,
    kind: 'web',
    platform: isIosDevice() ? 'ios-web' : 'web',
    userAgent: navigator.userAgent.slice(0, 160),
    updatedAt: Date.now(),
  });

  // Foreground messages: render a native notification so the user sees them
  // even when the tab is focused. (FCM only auto-displays in the background.)
  if (!foregroundListenerReady) {
    onMessage(messaging, (payload) => {
      const data = payload.data || {};
      if (Notification.permission === 'granted') {
        // Match the background SW format — store the canact:// or relative
        // URL under `data.url` so notificationclick can route correctly.
        const link = (data as Record<string, string>).deepLink
          || (data as Record<string, string>).url
          || '/';
        reg.showNotification(data.title || payload.notification?.title || 'Canact', {
          body: data.body || payload.notification?.body || '',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          data: { url: link },
          tag: data.tag || undefined,
        });
      }
    });
    foregroundListenerReady = true;
  }

  return { ok: true, token };
}

export async function disableWebPushToken(uid: string, token: string) {
  await remove(ref(db, `users/${uid}/pushTokens/${tokenKey(token)}`));
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && !webPushInstallRequired()
    && 'Notification' in window
    && 'serviceWorker' in navigator;
}
