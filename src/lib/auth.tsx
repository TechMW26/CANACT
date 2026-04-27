'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as fbSignOut,
  deleteUser,
  type User as FbUser,
} from 'firebase/auth';
import { onValue, ref, update, get, remove, set } from 'firebase/database';
import { db, getFirebaseAuth, getGoogleProvider } from './firebase';
import { UserProfile } from './types';

/**
 * Detect Capacitor's native Android/iOS WebView. Embedded WebViews are blocked
 * from hosting Google's OAuth flow, so we use the @capacitor-firebase/authentication
 * plugin (native Google Sign-In SDK) instead of signInWithRedirect / signInWithPopup.
 */
function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.platform === 'android' || cap.platform === 'ios';
}

/** Lazy-loaded plugin reference — only imported on native to keep web bundle small. */
async function getNativeAuthPlugin() {
  const mod = await import('@capacitor-firebase/authentication');
  return mod.FirebaseAuthentication;
}

/**
 * Browser-fallback Google sign-in for the Capacitor APK.
 *
 * Used when the native @capacitor-firebase/authentication plugin fails or
 * hangs (commonly: missing google-services.json, SHA-1 not registered, Play
 * Services on the device disabled). We open the system browser to a hosted
 * helper page on canact.vercel.app that performs a real `signInWithPopup`,
 * then redirects back to the app via the `canact://auth-callback#idToken=...`
 * deep link. This function listens for that deep link, extracts the id token
 * and exchanges it for a Firebase credential. Resolves on success, rejects
 * if the user cancels or the helper reports an error.
 */
async function browserFallbackGoogleSignIn(auth: import('firebase/auth').Auth): Promise<void> {
  const [{ Browser }, { App }] = await Promise.all([
    import('@capacitor/browser'),
    import('@capacitor/app'),
  ]);

  const helperUrl =
    'https://canact.vercel.app/auth/native?return=' +
    encodeURIComponent('canact://auth-callback');

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let urlListener: { remove: () => Promise<void> } | null = null;

    const finish = async (err?: Error) => {
      if (settled) return;
      settled = true;
      try { await urlListener?.remove(); } catch { /* noop */ }
      try { await Browser.close(); } catch { /* noop */ }
      if (err) reject(err); else resolve();
    };

    App.addListener('appUrlOpen', async (data: { url: string }) => {
      try {
        if (!data?.url || !data.url.startsWith('canact://auth-callback')) return;
        // Parse the hash fragment for idToken / error.
        const hash = data.url.split('#')[1] ?? '';
        const params = new URLSearchParams(hash);
        const errorMsg = params.get('error');
        if (errorMsg) {
          await finish(new Error(errorMsg));
          return;
        }
        const idToken = params.get('idToken');
        if (!idToken) {
          await finish(new Error('No id token returned from browser sign-in.'));
          return;
        }
        const cred = GoogleAuthProvider.credential(idToken);
        const r = await signInWithCredential(auth, cred);
        if (r.user) seedInBackground(r.user);
        await finish();
      } catch (e: any) {
        await finish(e instanceof Error ? e : new Error(String(e)));
      }
    }).then((handle) => { urlListener = handle; });

    Browser.open({ url: helperUrl, presentationStyle: 'fullscreen' }).catch((e) => {
      finish(e instanceof Error ? e : new Error('Could not open browser for sign-in.'));
    });

    // Hard cap so the loader doesn't hang forever if the user closes the
    // custom tab without coming back.
    setTimeout(() => {
      if (!settled) finish(new Error('Sign-in timed out. Please try again.'));
    }, 5 * 60 * 1000);
  });
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface AuthCtx {
  user: SessionUser | null;
  profile: UserProfile | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateMyProfile: (patch: Partial<UserProfile>) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

const LOCKED_PROFILE_KEYS: (keyof UserProfile)[] = [
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'dateOfBirth',
  'address',
  'city',
  'country',
];

function toSession(u: FbUser): SessionUser {
  return {
    uid: u.uid,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoURL,
  };
}

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Seed a minimal profile after first Google sign-in. Profile is marked incomplete
 * so the app can route the user to /onboard to fill the rest. Safe to call repeatedly. */
async function seedProfileIfMissing(u: FbUser) {
  const snap = await get(ref(db, `users/${u.uid}`));
  if (snap.exists()) return;
  const fullName = u.displayName ?? (u.email ? u.email.split('@')[0] : 'New User');
  const parts = fullName.trim().split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
  const middleName = parts.length > 2 ? parts.slice(1, -1).join(' ') : '';
  const seed: UserProfile = {
    uid: u.uid,
    fullName,
    firstName,
    middleName: middleName || undefined,
    lastName,
    email: u.email ?? undefined,
    photoURL: u.photoURL ?? undefined,
    profileComplete: false,
    profileVerified: false,
    rating: 0,
    ratingCount: 0,
    likesCount: 0,
    dislikesCount: 0,
    attrs: { behaviour: 0, action: 0, reliable: 0, rude: 0, inactive: 0, unreliable: 0 },
    cardsReceived: { understanding: 0, humour: 0, goodVibes: 0, confidence: 0, intelligence: 0, creativity: 0, daring: 0 },
    badges: [],
    tags: ['New User', 'Unverified Profile'],
    notificationSound: true,
    createdAt: Date.now(),
  };
  // Strip undefined keys — RTDB rejects them.
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(seed)) if (v !== undefined) cleaned[k] = v;
  await set(ref(db, `users/${u.uid}`), cleaned);
}

/** Fire-and-forget seed. Errors are logged but never thrown so they cannot
 * stall the auth listener or block routing. */
function seedInBackground(u: FbUser) {
  seedProfileIfMissing(u).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[auth] seedProfileIfMissing failed', err);
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth state listener — the SOLE source of truth for `user`.
  // We never await anything here; routing must not depend on RTDB succeeding.
  useEffect(() => {
    const auth = getFirebaseAuth();
    // Pick up redirect result (mobile flow). On success, force a hard reload to
    // '/' so React/Next state can't drift from Firebase state — the / route
    // then routes to /onboard or /feed based on profileComplete.
    getRedirectResult(auth)
      .then((r) => {
        if (r?.user && typeof window !== 'undefined') {
          // Replace history so back-button doesn't return to /welcome.
          window.location.replace('/');
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[auth] getRedirectResult failed', err);
      });
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (!u) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
        // Set user IMMEDIATELY so routing can react.
        setUser(toSession(u));
        setLoading(false);
        // Seed profile in background; never blocks the listener.
        seedInBackground(u);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.error('[auth] onAuthStateChanged error', err);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  // Profile subscription — independent of auth `loading`.
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    const off = onValue(
      ref(db, `users/${user.uid}`),
      (snap) => {
        const v = snap.val() as UserProfile | null;
        setProfile(v ?? null);
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[auth] profile subscription error', err);
        setProfile(null);
      },
    );
    return () => off();
  }, [user?.uid]);

  const value = useMemo<AuthCtx>(() => ({
    user,
    profile,
    loading,
    signInWithGoogle: async () => {
      const auth = getFirebaseAuth();

      // Native (Capacitor APK): use the Google Sign-In SDK via the plugin and
      // exchange the idToken for a Firebase credential. This works inside the
      // Android WebView where signInWithRedirect / signInWithPopup are blocked.
      // If the native plugin fails or hangs (missing google-services.json,
      // SHA-1 mismatch, Play Services issue), fall back to the system browser
      // helper page which performs sign-in and returns the id token via a
      // canact://auth-callback deep link.
      if (isCapacitorNative()) {
        try {
          const FirebaseAuthentication = await getNativeAuthPlugin();
          const result = await withTimeout(
            FirebaseAuthentication.signInWithGoogle(),
            15000,
            'Native Google sign-in',
          );
          const idToken = result.credential?.idToken;
          if (!idToken) throw new Error('Google sign-in did not return an id token.');
          const cred = GoogleAuthProvider.credential(idToken);
          const r = await signInWithCredential(auth, cred);
          if (r.user) seedInBackground(r.user);
          return;
        } catch (nativeErr: any) {
          // eslint-disable-next-line no-console
          console.warn('[auth] native Google sign-in failed, falling back to browser:', nativeErr);
          await browserFallbackGoogleSignIn(auth);
          return;
        }
      }

      const provider = getGoogleProvider();
      if (isMobile()) {
        await signInWithRedirect(auth, provider);
        return;
      }
      try {
        const r = await signInWithPopup(auth, provider);
        if (r.user) seedInBackground(r.user);
      } catch (err: any) {
        const code = err?.code ?? '';
        if (
          code === 'auth/popup-blocked' ||
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request' ||
          code === 'auth/operation-not-supported-in-this-environment'
        ) {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw err;
      }
    },
    signOut: async () => {
      if (isCapacitorNative()) {
        try {
          const FirebaseAuthentication = await getNativeAuthPlugin();
          await FirebaseAuthentication.signOut();
        } catch { /* non-fatal */ }
      }
      await fbSignOut(getFirebaseAuth());
      setUser(null);
      setProfile(null);
    },
    updateMyProfile: async (patch) => {
      if (!user) return;
      if (profile?.profileVerified) {
        const attemptedLockedFields = LOCKED_PROFILE_KEYS.filter((key) => key in patch);
        if (attemptedLockedFields.length > 0) {
          throw new Error('Name, DOB, and address are locked after profile verification.');
        }
      }
      const cleaned: Record<string, any> = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
      await update(ref(db, `users/${user.uid}`), cleaned);
    },
    deleteAccount: async () => {
      const auth = getFirebaseAuth();
      const u = auth.currentUser;
      if (!u) throw new Error('Not signed in');
      await remove(ref(db, `users/${u.uid}`));
      try {
        await deleteUser(u);
      } catch (err: any) {
        // If recent-login is required, sign the user out so they can re-auth.
        if (err?.code === 'auth/requires-recent-login') {
          await fbSignOut(auth);
          throw new Error('Please sign in again to confirm account deletion.');
        }
        throw err;
      }
      setUser(null);
      setProfile(null);
    },
  }), [user, profile, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
