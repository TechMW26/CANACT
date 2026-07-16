'use client';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getDatabase, Database } from 'firebase/database';
import { getAuth, browserLocalPersistence, indexedDBLocalPersistence, type Auth } from 'firebase/auth';

// authDomain controls where Google sign-in is served from. We prefer the
// CURRENT origin (e.g. canact.vercel.app) so popups/redirects stay on the same
// domain as the app — eliminating third-party cookie / iframe storage problems
// that cause sessions to silently drop after sign-in. The /__/auth/* requests
// the SDK makes are proxied by next.config.js back to the real Firebase host.
const currentHost = typeof window !== 'undefined' ? window.location?.host : undefined;
const isLocalHost = !!currentHost && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(currentHost);
const browserAuthDomain = currentHost && !isLocalHost ? currentHost : undefined;

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:
    (isLocalHost ? 'canact-94ad6.firebaseapp.com' : browserAuthDomain) ??
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    'canact-94ad6.firebaseapp.com',
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
    'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'canact-94ad6',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? 'canact-94ad6.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
export const db: Database = getDatabase(firebaseApp);

// Auth is lazy — getAuth() throws synchronously at module import time on the
// server (during Next.js prerender) when NEXT_PUBLIC_FIREBASE_API_KEY is
// missing. Only initialize it in the browser.
let _auth: Auth | null = null;
export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  _auth = getAuth(firebaseApp);
  try { _auth.useDeviceLanguage(); } catch {}
  // Persist session across reloads (IndexedDB preferred, localStorage fallback).
  _auth.setPersistence(indexedDBLocalPersistence).catch(() => {
    _auth!.setPersistence(browserLocalPersistence).catch(() => {});
  });
  return _auth;
}
