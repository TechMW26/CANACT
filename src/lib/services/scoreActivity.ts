import { ref, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { dayKey } from '../utils';

export const DAILY_ACTIVITY_POINT_LIMIT = 10;
export const ACTIVITY_SCORE_LIMIT = 50;

/**
 * Awards one durable score point for a meaningful community action. The
 * daily cap keeps reactions useful without turning repeated taps into an
 * unlimited score source.
 */
export async function recordScoreActivity(uid: string) {
  if (!uid) return { awarded: 0 };
  const today = dayKey();
  let awarded = 0;
  await runTransaction(ref(db, `users/${uid}`), (profile: UserProfile | null) => {
    if (!profile) return profile;
    const sameDay = profile.activityScoreDayKey === today;
    const todayCount = sameDay ? Number(profile.activityScoreDayCount || 0) : 0;
    if (todayCount >= DAILY_ACTIVITY_POINT_LIMIT) return profile;
    awarded = 1;
    profile.activityScoreDayKey = today;
    profile.activityScoreDayCount = todayCount + 1;
    profile.activityScorePoints = Math.min(ACTIVITY_SCORE_LIMIT, Number(profile.activityScorePoints || 0) + 1);
    return profile;
  });
  return { awarded };
}

/** Rate Me votes are public profile ratings and must feed the same aggregate
 * used by proximity ratings and the Canact score. */
export async function recordProfileRating(uid: string, kind: 'like' | 'dislike') {
  await runTransaction(ref(db, `users/${uid}`), (profile: UserProfile | null) => {
    if (!profile) return profile;
    profile.likesCount = Number(profile.likesCount || 0);
    profile.dislikesCount = Number(profile.dislikesCount || 0);
    if (kind === 'like') profile.likesCount += 1;
    else profile.dislikesCount += 1;
    const total = profile.likesCount + profile.dislikesCount;
    profile.ratingCount = total;
    profile.rating = total ? Math.max(0, Math.min(5, (profile.likesCount / total) * 5)) : 0;
    return profile;
  });
}
