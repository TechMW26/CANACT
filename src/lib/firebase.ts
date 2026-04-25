'use client';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getDatabase, Database } from 'firebase/database';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'canact-94ad6.firebaseapp.com',
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
  return _auth;
}

let _googleProvider: GoogleAuthProvider | null = null;
export function getGoogleProvider(): GoogleAuthProvider {
  if (_googleProvider) return _googleProvider;
  _googleProvider = new GoogleAuthProvider();
  _googleProvider.setCustomParameters({ prompt: 'select_account' });
  return _googleProvider;
}

