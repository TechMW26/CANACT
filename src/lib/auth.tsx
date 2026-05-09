'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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
 * from hosting Google's OAuth flow, so on native we open the system browser
 * and bridge the id token back via the canact://auth-callback deep link.
 */
function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap: any = (window as any).Capacitor;
  if (!cap) return false;
  if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform();
  return cap.platform === 'android' || cap.platform === 'ios';
}

/**
 * Open the system browser to the hosted Google sign-in helper page. Returns
 * as soon as the browser is launched — the actual credential exchange happens
 * later when Android delivers the canact://auth-callback deep link to the
 * global listener registered in AuthProvider. This way the spinner on the
 * sign-in button clears immediately and the user simply sees the splash
 * screen / signed-in state when they return from the browser.
 */
async function openBrowserGoogleSignIn(): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  const helperUrl =
    'https://canact.vercel.app/auth/native?return=' +
    encodeURIComponent('canact://auth-callback');
  await Browser.open({ url: helperUrl, presentationStyle: 'fullscreen' });
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
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
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

function splitNameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
  };
}

function fallbackDisplayName(u: Pick<FbUser, 'displayName' | 'email'>): string {
  const candidate = (u.displayName || '').trim();
  if (candidate) return candidate;
  if (u.email) return u.email.split('@')[0] || 'Canact user';
  return 'Canact user';
}

function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Seed a minimal profile after first Google sign-in. Profile is marked incomplete
 * so the profile page can prompt the user to finish it. Safe to call repeatedly. */
async function seedProfileIfMissing(u: FbUser) {
  const snap = await get(ref(db, `users/${u.uid}`));
  if (snap.exists()) return;
  const fullName = fallbackDisplayName(u);
  const { firstName, lastName, middleName } = splitNameParts(fullName);
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

function profileBackfillFromAuth(u: SessionUser, profile: UserProfile | null): Partial<UserProfile> {
  const patch: Partial<UserProfile> = {};
  if (!profile) return patch;
  const authName = (u.displayName || '').trim();
  const profileName = typeof profile.fullName === 'string' ? profile.fullName.trim() : '';
  const fullName = profileName || authName || (u.email ? u.email.split('@')[0] : 'Canact user');
  if (!profileName && fullName) patch.fullName = fullName;

  const nameParts = splitNameParts(fullName);
  if (!profile.firstName && nameParts.firstName) patch.firstName = nameParts.firstName;
  if (!profile.lastName && nameParts.lastName) patch.lastName = nameParts.lastName;
  if (!profile.middleName && nameParts.middleName) patch.middleName = nameParts.middleName;
  if (!profile.email && u.email) patch.email = u.email;
  if (!profile.photoURL && u.photoURL) patch.photoURL = u.photoURL;

  return patch;
}

async function routeAfterSignIn(u: FbUser) {
  await seedProfileIfMissing(u);
  const snap = await get(ref(db, `users/${u.uid}/profileComplete`));
  return snap.val() === false ? '/profile' : '/';
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
    // '/' so React/Next state can't drift from Firebase state.
    getRedirectResult(auth)
      .then(async (r) => {
        if (r?.user && typeof window !== 'undefined') {
          const destination = await routeAfterSignIn(r.user).catch(() => '/');
          // Replace history so back-button doesn't return to /welcome.
          window.location.replace(destination);
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

  // Global deep-link listener for the browser-based Google sign-in flow
  // (Capacitor APK only). The /auth/native helper page redirects to
  // canact://auth-callback#idToken=... once the user signs in via the system
  // browser; Android delivers that URL to MainActivity, the @capacitor/app
  // plugin emits `appUrlOpen`, and we exchange the id token for a Firebase
  // credential here. Mounted once at app boot so it survives even if the
  // user closes the welcome page after launching the browser.
  useEffect(() => {
    if (!isCapacitorNative()) return;
    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;
    (async () => {
      const [{ App }, { Browser }] = await Promise.all([
        import('@capacitor/app'),
        import('@capacitor/browser'),
      ]);
      if (cancelled) return;
      handle = await App.addListener('appUrlOpen', async (data: { url: string }) => {
        try {
          if (!data?.url || !data.url.startsWith('canact://auth-callback')) return;
          const hash = data.url.split('#')[1] ?? '';
          const params = new URLSearchParams(hash);
          const errorMsg = params.get('error');
          if (errorMsg) {
            // eslint-disable-next-line no-console
            console.warn('[auth] browser sign-in returned error:', errorMsg);
            try { await Browser.close(); } catch { /* noop */ }
            return;
          }
          const idToken = params.get('idToken');
          if (!idToken) return;
          const cred = GoogleAuthProvider.credential(idToken);
          const auth = getFirebaseAuth();
          const r = await signInWithCredential(auth, cred);
          if (r.user) seedInBackground(r.user);
          try { await Browser.close(); } catch { /* noop */ }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[auth] deep-link sign-in handler failed', err);
        }
      });
    })().catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[auth] failed to register deep-link listener', err);
    });
    return () => {
      cancelled = true;
      handle?.remove().catch(() => { /* noop */ });
    };
  }, []);

  // Profile subscription — independent of auth `loading`.
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    const off = onValue(
      ref(db, `users/${user.uid}`),
      (snap) => {
        const v = snap.val() as UserProfile | null;
        if (!v) {
          setProfile(null);
          return;
        }

        const patch = profileBackfillFromAuth(user, v);
        const hasPatch = Object.keys(patch).length > 0;
        const merged = hasPatch ? ({ ...v, ...patch } as UserProfile) : v;
        setProfile(merged);

        if (hasPatch) {
          update(ref(db, `users/${user.uid}`), patch).catch((err) => {
            // eslint-disable-next-line no-console
            console.warn('[auth] profile backfill failed', err);
          });
        }
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

      // Native (Capacitor APK): open the system browser and let the hosted
      // helper page (/auth/native) handle Google sign-in. Resolve immediately
      // — the global deep-link listener mounted in AuthProvider will exchange
      // the returned id token for a Firebase credential. Awaiting here would
      // freeze the sign-in button's spinner for the entire browser flow.
      if (isCapacitorNative()) {
        await openBrowserGoogleSignIn();
        return;
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
    signInWithEmail: async (email, password) => {
      const auth = getFirebaseAuth();
      const r = await signInWithEmailAndPassword(auth, email, password);
      if (r.user) seedInBackground(r.user);
    },
    signUpWithEmail: async (email, password) => {
      const auth = getFirebaseAuth();
      const r = await createUserWithEmailAndPassword(auth, email, password);
      if (r.user) seedInBackground(r.user);
    },
    signOut: async () => {
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
