import type { Database } from 'firebase-admin/database';
import webPush, { type PushSubscription } from 'web-push';
import { WEB_PUSH_PUBLIC_KEY } from '@/lib/webPushConfig';

export type StoredWebPushSubscription = PushSubscription & {
  kind?: string;
  platform?: string;
  updatedAt?: number;
  userAgent?: string;
};

export type WebPushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
  type?: string;
  image?: string;
  [key: string]: string | undefined;
};

let configured = false;

function configure() {
  if (configured) return true;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!privateKey) return false;
  webPush.setVapidDetails('https://canact.vercel.app', WEB_PUSH_PUBLIC_KEY, privateKey);
  configured = true;
  return true;
}

export async function sendWebPushSubscriptions(
  database: Database,
  uid: string,
  subscriptions: Record<string, StoredWebPushSubscription>,
  payload: WebPushPayload,
  options: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
) {
  const entries = Object.entries(subscriptions).filter(([, subscription]) => (
    subscription?.endpoint && subscription.keys?.auth && subscription.keys?.p256dh
  ));
  if (!entries.length || !configure()) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  await Promise.all(entries.map(async ([key, subscription]) => {
    try {
      await webPush.sendNotification(subscription, JSON.stringify({
        data: payload,
        notification: {
          title: payload.title,
          body: payload.body || '',
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-72.png',
          tag: payload.tag,
          image: payload.image,
        },
      }), {
        TTL: options.ttl ?? 86_400,
        urgency: options.urgency ?? 'normal',
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await database.ref(`users/${uid}/webPushSubscriptions/${key}`).remove();
      }
    }
  }));
  return { sent, failed };
}

