'use client';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  onAuthStateChanged,
  signOut as fbSignOut,
  deleteUser,
  reload,
  type User as FbUser,
} from 'firebase/auth';
import { equalTo, get, limitToFirst, onValue, orderByChild, query, ref, remove, update } from 'firebase/database';
import { db, getFirebaseAuth } from './firebase';
import { getActiveOTPSession, getPhoneLinkStatus, sendOTP, verifyOTP, resetOTP, type OTPSession } from './services/otp';
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
  requestOTP: (phone: string, forceNew?: boolean) => Promise<{ ok: boolean; channel?: string; error?: string; reused?: boolean; expiresAt?: number }>;
  signInLocally: (phone: string) => Promise<{ ok: boolean; error?: string; isNewUser?: boolean; nextPath?: '/' | '/onboard' }>;
  confirmOTP: (code: string) => Promise<{ ok: boolean; error?: string; isNewUser?: boolean; nextPath?: '/' | '/onboard' }>;
  requestPhoneLinkOTP: (phone: string, forceNew?: boolean) => Promise<{ ok: boolean; channel?: string; error?: string; reused?: boolean; expiresAt?: number }>;
  phoneLinkStatus: (phone: string) => Promise<'available' | 'current' | 'other' | 'unknown'>;
  confirmPhoneLinkOTP: (code: string) => Promise<{ ok: boolean; error?: string }>;
  pendingOTP: (mode: 'signin' | 'link') => OTPSession | null;
  signOut: () => Promise<void>;
  updateMyProfile: (patch: Partial<UserProfile>) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
const LOCAL_PHONE_SESSION_KEY = 'canact:local-phone-session:v1';

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

type ProfileSeedUser = Pick<SessionUser, 'uid' | 'email' | 'displayName' | 'photoURL' | 'phoneNumber'>;

function registrationProfile(u: ProfileSeedUser): UserProfile {
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
    scoreAdjustmentOffset: 0,
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
async function seedProfileIfMissing(u: ProfileSeedUser) {
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
  if (!profile.mobile && u.phoneNumber) patch.mobile = u.phoneNumber;
  if (!profile.photoURL && u.photoURL) patch.photoURL = u.photoURL;

  return patch;
}

async function routeAfterSignIn(u: ProfileSeedUser) {
  await seedProfileIfMissing(u);
  const snap = await get(ref(db, `users/${u.uid}/profileComplete`));
  return snap.val() === false ? '/onboard' : '/';
}

/** Fire-and-forget seed. Errors are logged but never thrown so they cannot
 * stall the auth listener or block routing. */
function seedInBackground(u: ProfileSeedUser) {
  seedProfileIfMissing(u).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn('[auth] seedProfileIfMissing failed', err);
  });
}

function localPhoneLoginEnabled() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}

function readLocalPhoneSession(): SessionUser | null {
  if (!localPhoneLoginEnabled()) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(LOCAL_PHONE_SESSION_KEY) || 'null') as SessionUser | null;
    return value?.uid && value.phoneNumber ? value : null;
  } catch {
    window.localStorage.removeItem(LOCAL_PHONE_SESSION_KEY);
    return null;
  }
}

function writeLocalPhoneSession(value: SessionUser | null) {
  if (typeof window === 'undefined') return;
  if (value) window.localStorage.setItem(LOCAL_PHONE_SESSION_KEY, JSON.stringify(value));
  else window.localStorage.removeItem(LOCAL_PHONE_SESSION_KEY);
}

export function clearLocalPhoneSession() {
  writeLocalPhoneSession(null);
}

function normalizedPhone(value: unknown) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

async function findLocalProfileByPhone(phone: string): Promise<[string, UserProfile] | null> {
  try {
    const indexedMatch = await get(query(ref(db, 'users'), orderByChild('mobile'), equalTo(phone), limitToFirst(1)));
    if (indexedMatch.exists()) {
      return Object.entries(indexedMatch.val() as Record<string, UserProfile>)[0] ?? null;
    }
  } catch (error: any) {
    // Local databases may allow reads but omit the optional mobile index.
    // Fall through to a localhost-only client-side lookup instead of blocking login.
    if (!String(error?.message || '').includes('Index not defined')) throw error;
  }

  const usersSnapshot = await get(ref(db, 'users'));
  if (!usersSnapshot.exists()) return null;
  const target = normalizedPhone(phone);
  return Object.entries(usersSnapshot.val() as Record<string, UserProfile>).find(([, profile]) => (
    normalizedPhone(profile.mobile) === target
    || normalizedPhone((profile as UserProfile & { phoneNumber?: string }).phoneNumber) === target
  )) ?? null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Auth state listener
  useEffect(() => {
    // Admin access always uses Firebase email authentication. A localhost
    // phone-session fallback must never mask the newly signed-in admin user.
    const localSession = window.location.pathname.startsWith('/admin') ? null : readLocalPhoneSession();
    if (localSession) {
      setUser(localSession);
      setLoading(false);
      seedInBackground(localSession);
      return;
    }
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
        const merged = ({ ...v, uid: user.uid, ...(hasPatch ? patch : {}) } as UserProfile);
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
    requestOTP: async (phone: string, forceNew = false) => {
      return sendOTP(phone, 'recaptcha-container', 'signin', forceNew);
    },
    signInLocally: async (phone: string) => {
      if (!localPhoneLoginEnabled()) return { ok: false, error: 'Local phone login is unavailable.' };
      try {
        const existing = await findLocalProfileByPhone(phone);
        const existingProfile = existing?.[1];
        const session: SessionUser = existing ? {
          uid: existing[0],
          email: existingProfile?.email ?? null,
          displayName: existingProfile?.fullName ?? null,
          photoURL: existingProfile?.photoURL ?? null,
          phoneNumber: phone,
        } : {
          uid: `local_${crypto.randomUUID().replaceAll('-', '')}`,
          email: null,
          displayName: null,
          photoURL: null,
          phoneNumber: phone,
        };
        const nextPath = await routeAfterSignIn(session);
        writeLocalPhoneSession(session);
        setUser(session);
        return { ok: true, isNewUser: !existing, nextPath };
      } catch (error) {
        console.error('[auth] Local Firebase profile lookup failed', error instanceof Error ? error.message : 'unknown');
        return { ok: false, error: 'Could not read this phone profile from Firebase.' };
      }
    },
    confirmOTP: async (code: string) => {
      const result = await verifyOTP(code);
      if (!result.ok) return result;
      const signedInUser = getFirebaseAuth().currentUser;
      if (!signedInUser) return { ok: false, error: 'Unable to finish sign in right now.' };
      const nextPath = await routeAfterSignIn(signedInUser);
      return { ...result, nextPath };
    },
    requestPhoneLinkOTP: async (phone: string, forceNew = false) => {
      return sendOTP(phone, 'phone-link-recaptcha', 'link', forceNew);
    },
    phoneLinkStatus: getPhoneLinkStatus,
    confirmPhoneLinkOTP: async (code: string) => {
      const result = await verifyOTP(code);
      if (!result.ok) return result;
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) return { ok: false, error: 'Unable to verify this number right now.' };
      await reload(currentUser);
      setUser(toSession(currentUser));
      if (currentUser.phoneNumber) {
        await update(ref(db, `users/${currentUser.uid}`), {
          mobile: currentUser.phoneNumber,
          mobileVerifiedAt: Date.now(),
        });
      }
      resetOTP();
      return { ok: true };
    },
    pendingOTP: (mode) => getActiveOTPSession(undefined, mode),
    signOut: async () => {
      resetOTP();
      const localSession = readLocalPhoneSession();
      if (localSession?.uid === user?.uid) {
        writeLocalPhoneSession(null);
        setUser(null);
        setProfile(null);
        return;
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
      const localSession = readLocalPhoneSession();
      const localUid = localSession?.uid;
      if (localUid && localUid === user?.uid) {
        await remove(ref(db, `users/${localUid}`));
        writeLocalPhoneSession(null);
        setUser(null);
        setProfile(null);
        return;
      }
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
