'use client';
import { ref, set, remove } from 'firebase/database';
import { db } from '../firebase';
import { WEB_PUSH_PUBLIC_KEY } from '../webPushConfig';

type StoredWebPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { auth: string; p256dh: string };
};

export function isIosDevice() {
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
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  // Keep this as the first awaited operation. Safari requires the permission
  // request to run within the transient user activation from the button tap.
  let perm = Notification.permission;
  if (perm === 'default') perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };

  // Reuse the app's root worker. Registering it under a different URL replaces
  // the active worker and can invalidate the iOS push subscription.
  const existing = await navigator.serviceWorker.getRegistration('/');
  const reg = existing ?? await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidPublicKey(WEB_PUSH_PUBLIC_KEY),
    });
  }
  const json = subscription.toJSON() as StoredWebPushSubscription;
  if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) {
    return { ok: false, reason: 'no-token' };
  }

  await set(ref(db, `users/${uid}/webPushSubscriptions/${tokenKey(json.endpoint)}`), {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: json.keys,
    kind: 'web-push',
    platform: isIosDevice() ? 'ios-web' : 'web',
    userAgent: navigator.userAgent.slice(0, 160),
    updatedAt: Date.now(),
  });

  return { ok: true, token: json.endpoint };
}

export async function disableWebPushToken(uid: string, token: string) {
  await remove(ref(db, `users/${uid}/webPushSubscriptions/${tokenKey(token)}`));
}

export function pushSupported() {
  return typeof window !== 'undefined'
    && !webPushInstallRequired()
    && 'Notification' in window
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

export function webPushErrorMessage(reason?: string) {
  switch (reason) {
    case 'ios-install-required': return 'Add Canact to your Home Screen, then open it from the new icon.';
    case 'denied': return 'Notifications are blocked. Enable Canact in the device notification settings.';
    case 'unsupported':
    case 'not-supported': return 'Web Push is not supported in this browser.';
    case 'no-token': return 'The device could not create a notification subscription.';
    default: return 'Could not enable notifications. Please try again.';
  }
}

function decodeVapidPublicKey(value: string) {
  const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, '=');
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
