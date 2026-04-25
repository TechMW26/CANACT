'use client';
import { firebaseApp } from '../firebase';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { ref, set, remove } from 'firebase/database';
import { db } from '../firebase';

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

function tokenKey(token: string) {
  // Stable, short key for RTDB (Firebase keys can't include '/')
  let h = 0;
  for (let i = 0; i < token.length; i++) h = (h * 31 + token.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/**
 * Request notification permission, register the FCM service worker, and save
 * the issued token under `users/{uid}/pushTokens/{hash}`. Safe to call
 * repeatedly — it short-circuits if already enabled.
 */
export async function enableWebPush(uid: string): Promise<{ ok: boolean; reason?: string; token?: string }> {
  if (typeof window === 'undefined') return { ok: false, reason: 'ssr' };
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (!VAPID_KEY) return { ok: false, reason: 'missing-vapid-key' };
  try {
    const supported = await isSupported();
    if (!supported) return { ok: false, reason: 'not-supported' };
  } catch { return { ok: false, reason: 'not-supported' }; }

  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };

  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;

  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
  if (!token) return { ok: false, reason: 'no-token' };

  await set(ref(db, `users/${uid}/pushTokens/${tokenKey(token)}`), {
    token,
    platform: navigator.userAgent.slice(0, 80),
    createdAt: Date.now(),
  });

  // Foreground messages: render a native notification so the user sees them
  // even when the tab is focused. (FCM only auto-displays in the background.)
  onMessage(messaging, (payload) => {
    const data = payload.data || {};
    if (Notification.permission === 'granted') {
      reg.showNotification(data.title || 'Canact', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-72.png',
        data: { url: data.url || '/' },
        tag: data.tag || undefined,
      });
    }
  });

  return { ok: true, token };
}

export async function disableWebPushToken(uid: string, token: string) {
  await remove(ref(db, `users/${uid}/pushTokens/${tokenKey(token)}`));
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}
