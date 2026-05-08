'use client';
import { getFirebaseAuth } from '../firebase';

/**
 * Fire-and-forget client helper to invoke the push API route. Failures are
 * swallowed silently — pushes are best-effort and never block primary flows.
 */
export async function sendPush(input: {
  toUid: string;
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  /** Public https:// URL of a thumbnail to render in the system tray. */
  image?: string;
}) {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch { /* ignore */ }
}

/**
 * Fan a notification out to every accepted friend whose stored
 * lastLocation is within their own configured nearby-radius of the
 * supplied post coordinates. Used by post / poll / reel creation to
 * tap nearby friends on the shoulder.
 */
export async function notifyNearbyFriends(input: {
  lat: number;
  lng: number;
  title: string;
  body?: string;
  url: string;
  image?: string;
  tag?: string;
}) {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();
    await fetch('/api/push/nearby-friends', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch { /* ignore */ }
}

/**
 * Fan a help-request notification out to every user (filtered by audience)
 * whose stored lastLocation lies inside the request's vicinity radius.
 */
export async function notifyHelpVicinity(input: {
  helpId: string;
  lat: number;
  lng: number;
  vicinityMeters: number;
  audience: 'public' | 'favourites' | 'contacts';
  title: string;
  body?: string;
  url: string;
  tag?: string;
}) {
  try {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();
    await fetch('/api/push/help-vicinity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify(input),
      keepalive: true,
    });
  } catch { /* ignore */ }
}
