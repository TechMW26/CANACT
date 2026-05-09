import { onValue, ref, get } from 'firebase/database';
import { db } from '../firebase';
import { UserProfile } from '../types';

export type LeaderScope = 'app' | 'city' | 'country' | 'favourites' | 'contacts';

export function listenLeaderboard(scope: LeaderScope, me: UserProfile | null, cb: (rows: UserProfile[]) => void) {
  if (scope === 'favourites' && me) {
    let unsub1: (() => void) | null = null;
    let unsub2: (() => void) | null = null;
    let users: Map<string, UserProfile> = new Map();
    let favs: Set<string> = new Set();
    const emit = () => {
      const rows = Array.from(users.values())
        .filter((u) => favs.has(u.uid) && !u.underground)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 200);
      cb(rows);
    };
    unsub1 = onValue(ref(db, 'users'), (snap) => {
      users.clear();
      snap.forEach((c) => {
        const u = c.val() as UserProfile;
        if (u) users.set(u.uid, u);
      });
      emit();
    });
    unsub2 = onValue(ref(db, `favourites/${me.uid}`), (snap) => {
      favs.clear();
      snap.forEach((c) => { favs.add(c.key as string); });
      emit();
    });
    return () => { unsub1?.(); unsub2?.(); };
  }
  const path = scope === 'city' && me?.city ? 'users' : scope === 'country' && me?.country ? 'users' : 'users';
  return onValue(ref(db, path), (snap) => {
    const all: UserProfile[] = [];
    snap.forEach((c) => {
      const u = c.val() as UserProfile;
      if (u && !u.underground) all.push(u);
    });
    let rows = all;
    if (scope === 'city') rows = all.filter((u) => me?.city && u.city === me.city);
    else if (scope === 'country') rows = all.filter((u) => me?.country && u.country === me.country);
    rows.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    cb(rows.slice(0, 200));
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
