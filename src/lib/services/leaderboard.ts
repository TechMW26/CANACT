import { onValue, ref, get } from 'firebase/database';
import { db } from '../firebase';
import { NEGATIVE_ATTRS, POSITIVE_ATTRS, type UserProfile } from '../types';
import { calculateCanactScore } from '../canactScore';

export type LeaderScope = 'app' | 'city' | 'country' | 'favourites' | 'contacts';

/** The leaderboard must rank by the exact value rendered in its rows. The
 * legacy `rating` field is a 0–5 profile rating and must never be used as a
 * Canact-score proxy. */
export function leaderboardScore(profile: UserProfile) {
  return calculateCanactScore(profile).score;
}

export function compareLeaderboardProfiles(a: UserProfile, b: UserProfile) {
  const scoreDifference = leaderboardScore(b) - leaderboardScore(a);
  if (scoreDifference) return scoreDifference;

  // Stable, reputation-relevant tie breakers prevent ranks from jumping when
  // Firebase returns equal-score users in a different key order.
  const signalDifference = netCommunitySignals(b) - netCommunitySignals(a);
  if (signalDifference) return signalDifference;

  const createdDifference = Number(a.createdAt || 0) - Number(b.createdAt || 0);
  if (createdDifference) return createdDifference;
  return String(a.uid || '').localeCompare(String(b.uid || ''));
}

function netCommunitySignals(profile: UserProfile) {
  const positiveAttributes = POSITIVE_ATTRS.reduce((sum, key) => sum + safeNumber(profile.attrs?.[key]), 0);
  const negativeAttributes = NEGATIVE_ATTRS.reduce((sum, key) => sum + safeNumber(profile.attrs?.[key]), 0);
  return safeNumber(profile.likesCount) + positiveAttributes - safeNumber(profile.dislikesCount) - negativeAttributes;
}

function safeNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedLocation(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function isVisibleOnLeaderboard(profile: UserProfile) {
  if (!profile.underground) return true;
  return Number(profile.undergroundUntil || 0) > 0 && Number(profile.undergroundUntil) <= Date.now();
}

function profileFromSnapshot(value: unknown, key: string | null) {
  if (!value || typeof value !== 'object') return null;
  const profile = value as UserProfile;
  return { ...profile, uid: profile.uid || key || '' } as UserProfile;
}

function sortLeaderboard(rows: UserProfile[]) {
  return rows.filter((profile) => profile.uid && isVisibleOnLeaderboard(profile)).sort(compareLeaderboardProfiles);
}

export function listenLeaderboard(scope: LeaderScope, me: UserProfile | null, cb: (rows: UserProfile[]) => void) {
  if ((scope === 'favourites' || scope === 'contacts') && me) {
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    let users: Map<string, UserProfile> = new Map();
    let includedUids: Set<string> = new Set();
    const emit = () => {
      const rows = sortLeaderboard(Array.from(users.values()).filter((u) => includedUids.has(u.uid)));
      cb(rows);
    };
    unsub1 = onValue(ref(db, 'users'), (snap) => {
      users.clear();
      snap.forEach((c) => {
        const u = profileFromSnapshot(c.val(), c.key);
        if (u) users.set(u.uid, u);
      });
      emit();
    });
    unsub2 = onValue(ref(db, `${scope === 'contacts' ? 'contacts' : 'favourites'}/${me.uid}`), (snap) => {
      includedUids.clear();
      snap.forEach((c) => { includedUids.add(c.key as string); });
      emit();
    });
    return () => { unsub1?.(); unsub2?.(); };
  }
  const path = scope === 'city' && me?.city ? 'users' : scope === 'country' && me?.country ? 'users' : 'users';
  return onValue(ref(db, path), (snap) => {
    const all: UserProfile[] = [];
    snap.forEach((c) => {
      const u = profileFromSnapshot(c.val(), c.key);
      if (u) all.push(u);
    });
    let rows = all;
    if (scope === 'city') {
      const city = normalizedLocation(me?.city);
      rows = city ? all.filter((u) => normalizedLocation(u.city) === city) : [];
    } else if (scope === 'country') {
      const country = normalizedLocation(me?.country);
      rows = country ? all.filter((u) => normalizedLocation(u.country) === country) : [];
    }
    cb(sortLeaderboard(rows));
  });
}

export async function searchUsers(text: string): Promise<UserProfile[]> {
  const t = text.trim().toLowerCase(); if (!t) return [];
  const snap = await get(ref(db, 'users'));
  const out: UserProfile[] = []; snap.forEach((c) => {
    const u = c.val() as UserProfile;
    const hay = `${u.fullName ?? ''} ${u.city ?? ''} ${u.country ?? ''} ${u.email ?? ''} ${u.mobile ?? ''}`.toLowerCase();
    if (hay.includes(t)) out.push(u);
  });
  return out.slice(0, 50);
}
