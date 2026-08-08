import { ref, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { UserProfile } from '../types';
import { dayKey } from '../utils';

export const DAILY_ACTIVITY_POINT_LIMIT = 10;
export const ACTIVITY_SCORE_LIMIT = 50;
let lastContentReactionVersion = 0;

function claimId(value: string): string {
  let a = 2166136261;
  let b = 2246822519;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 3266489917);
  }
  return `v1_${(a >>> 0).toString(36)}_${(b >>> 0).toString(36)}_${value.length.toString(36)}`;
}

export function dailyActivityClaim(kind: string) {
  return `${kind}:${dayKey()}`;
}

/** Monotonic within the running client, including multiple taps in one ms. */
export function nextContentReactionVersion() {
  lastContentReactionVersion = Math.max(Date.now() * 1000, lastContentReactionVersion + 1);
  return lastContentReactionVersion;
}

/** Reconciles an author's aggregate counters with the latest reaction state.
 * The versioned ledger makes delayed like/unlike requests harmless. */
export async function syncAuthorContentReaction(
  authorUid: string,
  actorUid: string,
  claim: string,
  previousKind: 'like' | 'dislike' | null,
  nextKind: 'like' | 'dislike' | null,
  version: number,
) {
  if (!authorUid || !actorUid || authorUid === actorUid) return;
  const id = claimId(`${actorUid}:${claim}`);
  await runTransaction(ref(db, `users/${authorUid}`), (profile: UserProfile | null) => {
    if (!profile) return profile;
    profile.contentReactionClaims = profile.contentReactionClaims ?? {};
    const current = profile.contentReactionClaims[id];
    if (current && current.version >= version) return profile;
    const countedKind = current
      ? (current.kind === 'none' ? null : current.kind)
      : previousKind;
    if (countedKind) {
      const field = countedKind === 'like' ? 'contentLikes' : 'contentDislikes';
      profile[field] = Math.max(0, Number(profile[field] || 0) - 1);
    }
    if (nextKind) {
      const field = nextKind === 'like' ? 'contentLikes' : 'contentDislikes';
      profile[field] = Number(profile[field] || 0) + 1;
    }
    profile.contentReactionClaims[id] = { kind: nextKind ?? 'none', version };
    return profile;
  });
}

/** Awards an author's aggregate content signal once per actor/content action.
 * This prevents repeated comments from inflating the author's score. */
export async function recordUniqueAuthorContentFeedback(
  authorUid: string,
  actorUid: string,
  claim: string,
  kind: 'like' | 'dislike' = 'like',
) {
  if (!authorUid || !actorUid || authorUid === actorUid) return { awarded: 0 };
  const id = claimId(`${actorUid}:${claim}`);
  let awarded = 0;
  await runTransaction(ref(db, `users/${authorUid}`), (profile: UserProfile | null) => {
    if (!profile) return profile;
    awarded = 0;
    profile.contentScoreClaims = profile.contentScoreClaims ?? {};
    if (profile.contentScoreClaims[id]) return profile;
    profile.contentScoreClaims[id] = Date.now();
    const field = kind === 'like' ? 'contentLikes' : 'contentDislikes';
    profile[field] = Math.max(0, Number(profile[field] || 0) + 1);
    awarded = 1;
    return profile;
  });
  return { awarded };
}

/**
 * Awards one durable score point for a meaningful community action. The
 * daily cap keeps reactions useful without turning repeated taps into an
 * unlimited score source.
 */
export async function recordScoreActivity(uid: string, claim?: string) {
  if (!uid) return { awarded: 0 };
  const today = dayKey();
  const now = Date.now();
  const id = claim ? claimId(claim) : null;
  let awarded = 0;
  await runTransaction(ref(db, `users/${uid}`), (profile: UserProfile | null) => {
    if (!profile) return profile;
    awarded = 0;
    if (id) {
      profile.activityScoreClaims = profile.activityScoreClaims ?? {};
      if (profile.activityScoreClaims[id]) return profile;
      // Record the claim even when today's cap has already been reached.
      // Otherwise the same unlike/re-like action could be replayed tomorrow.
      profile.activityScoreClaims[id] = now;
    }
    if (Number(profile.activityScorePoints || 0) >= ACTIVITY_SCORE_LIMIT) return profile;
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
