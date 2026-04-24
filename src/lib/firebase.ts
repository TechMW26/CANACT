'use client';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getDatabase, Database } from 'firebase/database';

const config = {
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DB_URL ??
    'https://canact-94ad6-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'canact-94ad6',
};

export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
export const db: Database = getDatabase(firebaseApp);

