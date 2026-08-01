import { ref, runTransaction, update } from 'firebase/database';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { dayKey } from '../utils';

export async function goUnderground(uid: string, hours = 4) {
  const today = dayKey();
  await runTransaction(ref(db, `users/${uid}`), (cur: UserProfile | null) => {
    if (!cur) return cur;
    const sameDay = cur.undergroundDayKey === today;
    const count = sameDay ? (cur.undergroundDayCount ?? 0) + 1 : 1;
    const penalty = Math.min(0.4, 0.05 * count);
    const now = Date.now();
    cur.rating = Math.max(0, (cur.rating ?? 0) - penalty);
    cur.underground = true;
    cur.undergroundStartedAt = now;
    delete cur.undergroundExtendedAt;
    cur.undergroundUntil = now + hours * 3600 * 1000;
    cur.undergroundDayKey = today;
    cur.undergroundDayCount = count;
    return cur;
  });
}
export async function exitUnderground(uid: string) {
  await update(ref(db, `users/${uid}`), { underground: false, undergroundUntil: 0 });
}
export async function extendUnderground(uid: string) {
  const result = await runTransaction(ref(db, `users/${uid}`), (cur: UserProfile | null) => {
    const now = Date.now();
    if (!cur?.underground || (cur.undergroundUntil ?? 0) <= now || cur.undergroundExtendedAt) return;
    cur.undergroundUntil = Math.max(cur.undergroundUntil ?? now, now) + 4 * 3600 * 1000;
    cur.undergroundExtendedAt = now;
    return cur;
  });
  return result.committed;
}
