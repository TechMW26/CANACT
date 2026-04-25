'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  deleteUser,
  type User as FbUser,
} from 'firebase/auth';
import { onValue, ref, update, get, remove, set } from 'firebase/database';
import { db, getFirebaseAuth, getGoogleProvider } from './firebase';
import { UserProfile } from './types';

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
 * so the app can route the user to /onboard to fill the rest. */
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Pick up redirect result on mount (mobile flow), then start listener.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      const auth = getFirebaseAuth();
      try {
        const r = await getRedirectResult(auth);
        if (r?.user) await seedProfileIfMissing(r.user);
      } catch {
        // ignore — listener still resolves auth state
      }
      unsub = onAuthStateChanged(auth, async (u) => {
        if (!u) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
        try {
          await seedProfileIfMissing(u);
        } catch {
          // continue — profile listener below will surface errors
        }
        setUser(toSession(u));
      });
    })();
    return () => { if (unsub) unsub(); };
  }, []);

  // Profile subscription
  useEffect(() => {
    if (!user) { setProfile(null); return; }
    setLoading(true);
    const off = onValue(ref(db, `users/${user.uid}`), (snap) => {
      const v = snap.val() as UserProfile | null;
      setProfile(v ?? null);
      setLoading(false);
    });
    return () => off();
  }, [user?.uid]);

  const value = useMemo<AuthCtx>(() => ({
    user,
    profile,
    loading,
    signInWithGoogle: async () => {
      const auth = getFirebaseAuth();
      const provider = getGoogleProvider();
      if (isMobile()) {
        await signInWithRedirect(auth, provider);
        return;
      }
      try {
        const r = await signInWithPopup(auth, provider);
        if (r.user) await seedProfileIfMissing(r.user);
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
