import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Serve the Firebase Cloud Messaging service worker from the site root with
 * the project's messagingSenderId / appId baked in from env. This avoids
 * checking real config into the public directory.
 */
export async function GET() {
  const senderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '';
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '';
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || '';
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'canact-94ad6';
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'canact-94ad6.firebaseapp.com';
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'canact-94ad6.firebasestorage.app';

  const body = `/* Canact Firebase Messaging service worker — generated. */
/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: ${JSON.stringify(apiKey)},
  authDomain: ${JSON.stringify(authDomain)},
  projectId: ${JSON.stringify(projectId)},
  storageBucket: ${JSON.stringify(storageBucket)},
  messagingSenderId: ${JSON.stringify(senderId)},
  appId: ${JSON.stringify(appId)},
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = (data.title || 'Canact').slice(0, 80);
  self.registration.showNotification(title, {
    body: (data.body || '').slice(0, 200),
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    data: { url: data.url || '/' },
    tag: data.tag || undefined,
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          try { c.navigate(url); } catch (_) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
`;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
