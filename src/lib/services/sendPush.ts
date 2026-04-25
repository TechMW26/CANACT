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
