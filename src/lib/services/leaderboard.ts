import { onValue, ref, get } from 'firebase/database';
import { db } from '../firebase';
import { UserProfile } from '../types';

export type LeaderScope = 'app' | 'city' | 'country' | 'favourites' | 'contacts';

export function listenLeaderboard(scope: LeaderScope, me: UserProfile | null, cb: (rows: UserProfile[]) => void) {
  return onValue(ref(db, 'users'), async (snap) => {
    const all: UserProfile[] = []; snap.forEach((c) => { all.push(c.val()); });
    let rows = all;
    if (scope === 'city') rows = all.filter((u) => me?.city && u.city === me.city);
    else if (scope === 'country') rows = all.filter((u) => me?.country && u.country === me.country);
    else if (scope === 'favourites' && me) {
      const favs = (await get(ref(db, `favourites/${me.uid}`))).val() ?? {};
      const set = new Set(Object.keys(favs)); rows = all.filter((u) => set.has(u.uid));
    } else if (scope === 'contacts') rows = all; // device-contacts not available on web
    rows = rows.filter((u) => !!u && !u.underground);
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
