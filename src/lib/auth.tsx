'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  deleteUser,
  type User as FbUser,
} from 'firebase/auth';
import { onValue, ref, update, get, remove } from 'firebase/database';
import { db, getFirebaseAuth } from './firebase';
import { sendOTP, verifyOTP, resetOTP, getOTPChannel } from './services/otp';
import { UserProfile } from './types';

interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  phoneNumber: string | null;
}

interface AuthCtx {
  user: SessionUser | null;
  profile: UserProfile | null;
  loading: boolean;
  requestOTP: (phone: string) => Promise<{ ok: boolean; channel?: string; error?: string }>;
  confirmOTP: (code: string) => Promise<{ ok: boolean; error?: string }>;
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
    phoneNumber: u.phoneNumber,
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

function registrationProfile(u: FbUser): UserProfile {
  const fullName = u.phoneNumber || fallbackDisplayName(u);
  const { firstName, lastName, middleName } = splitNameParts(fullName);
  return {
    uid: u.uid,
    fullName,
    firstName,
    middleName: middleName || undefined,
    lastName,
    email: u.email ?? undefined,
    mobile: u.phoneNumber ?? undefined,
    photoURL: u.photoURL ?? undefined,
    profileComplete: false,
    onboarding: { version: 1, points: 0, startedAt: Date.now(), completed: {}, signals: {} },
    profileVerified: false,
    rating: 0,
    ratingCount: 0,
    likesCount: 0,
    dislikesCount: 0,
    attrs: { behaviour: 0, reliability: 0, civic_sense: 0, rude: 0, unreliable: 0, uncivil: 0 },
    cardsReceived: { understanding: 0, humour: 0, goodVibes: 0, confidence: 0, cooperative: 0, intelligence: 0, creativity: 0, daring: 0 },
    badges: [],
    tags: ['New User'],
    notificationSound: true,
    createdAt: Date.now(),
  };
}

function cleanProfilePatch(profile: Partial<UserProfile>) {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(profile)) if (value !== undefined) cleaned[key] = value;
  return cleaned;
}

/** Seed a minimal profile after first sign-in. Profile is marked incomplete so
 * registration can continue. `update` keeps concurrent registration fields. */
async function seedProfileIfMissing(u: FbUser) {
  const snap = await get(ref(db, `users/${u.uid}`));
  if (snap.exists()) return;
  const seed = registrationProfile(u);
  // Strip undefined keys — RTDB rejects them.
  await update(ref(db, `users/${u.uid}`), cleanProfilePatch(seed));
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
  return snap.val() === false ? '/onboard' : '/';
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

  // Auth state listener
  useEffect(() => {
    const auth = getFirebaseAuth();
    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (!u) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
        setUser(toSession(u));
        setProfile((current) => current?.uid === u.uid ? current : null);
        setLoading(false);
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
        if (!v) {
          // Preserve the optimistic profile created by email registration
          // while its first database write is still in flight.
          setProfile((current) => current?.uid === user.uid ? current : null);
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
    requestOTP: async (phone: string) => {
      return sendOTP(phone, 'recaptcha-container');
    },
    confirmOTP: async (code: string) => {
      const result = await verifyOTP(code);
      return result;
    },
    signOut: async () => {
      resetOTP();
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
