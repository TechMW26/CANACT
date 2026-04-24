import { get, ref, runTransaction, update } from 'firebase/database';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { dayKey } from '../utils';

export async function goUnderground(uid: string, hours = 4) {
  const u = (await get(ref(db, `users/${uid}`))).val() as UserProfile;
  const today = dayKey();
  const sameDay = u.undergroundDayKey === today;
  const count = sameDay ? (u.undergroundDayCount ?? 0) + 1 : 1;
  const penalty = Math.min(0.4, 0.05 * count);
  await runTransaction(ref(db, `users/${uid}`), (cur: UserProfile | null) => {
    if (!cur) return cur;
    cur.rating = Math.max(0, (cur.rating ?? 0) - penalty);
    cur.underground = true;
    cur.undergroundUntil = Date.now() + hours * 3600 * 1000;
    cur.undergroundDayKey = today;
    cur.undergroundDayCount = count;
    return cur;
  });
}
export async function exitUnderground(uid: string) {
  await update(ref(db, `users/${uid}`), { underground: false, undergroundUntil: 0 });
}
export async function extendUnderground(uid: string) {
  const u = (await get(ref(db, `users/${uid}`))).val() as UserProfile;
  const cur = u.undergroundUntil ?? Date.now();
  await update(ref(db, `users/${uid}`), { underground: true, undergroundUntil: Math.max(cur, Date.now()) + 4 * 3600 * 1000 });
}
