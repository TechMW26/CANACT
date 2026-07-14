import { get, ref, runTransaction, set, remove } from 'firebase/database';
import { db } from '../firebase';
import { AttrKey, CardKey, NEGATIVE_ATTRS, POSITIVE_ATTRS, UserProfile } from '../types';

/** Positive ↔ negative attribute pairs. Giving the opposite of an existing
 *  attribute replaces it (shifts from positive to negative or vice versa). */
const ATTR_OPPOSITES: Record<string, string> = {
  behaviour: 'rude',
  reliability: 'unreliable',
  civic_sense: 'uncivil',
  rude: 'behaviour',
  unreliable: 'reliability',
  uncivil: 'civic_sense',
};
import { calculateCanactScore } from '../canactScore';

export const SIX_HOURS = 6 * 3600 * 1000;

// Local cache for vote lookups to avoid redundant get() calls
const _voteCache = new Map<string, { vote: any; expiresAt: number }>();
function cacheVote(key: string, vote: any) {
  _voteCache.set(key, { vote, expiresAt: Date.now() + 10000 });
}
function getCachedVote(key: string): any {
  const entry = _voteCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.vote;
  _voteCache.delete(key);
  return undefined;
}

function recomputeRating(u: UserProfile) {
  const total = (u.likesCount ?? 0) + (u.dislikesCount ?? 0);
  if (total === 0) { u.rating = 0; u.ratingCount = 0; return; }
  u.rating = Math.max(0, Math.min(5, ((u.likesCount ?? 0) / total) * 5));
  u.ratingCount = total;
}

export async function setLikeDislike(toUid: string, fromUid: string, kind: 'like' | 'dislike') {
  const myVoteRef = ref(db, `votes/${toUid}/${fromUid}/main`);
  const cacheKey = `${toUid}/${fromUid}/main`;
  let prev = getCachedVote(cacheKey);
  if (prev === undefined) {
    prev = (await get(myVoteRef)).val() as 'like' | 'dislike' | null;
    cacheVote(cacheKey, prev);
  }
  if (prev === kind) return;
  await runTransaction(ref(db, `users/${toUid}`), (u: UserProfile | null) => {
    if (!u) return u;
    u.likesCount = u.likesCount ?? 0; u.dislikesCount = u.dislikesCount ?? 0;
    if (prev === 'like') u.likesCount = Math.max(0, u.likesCount - 1);
    if (prev === 'dislike') u.dislikesCount = Math.max(0, u.dislikesCount - 1);
    if (kind === 'like') u.likesCount += 1; else u.dislikesCount += 1;
    recomputeRating(u);
    return u;
  });
  await set(myVoteRef, kind);

  // Notify the recipient that someone liked/disliked them.
  import('./sendPush').then(({ sendPush }) => {
    sendPush({
      toUid,
      title: kind === 'like' ? 'Someone liked your profile 👍' : 'Someone gave feedback on your profile',
      body: 'Tap to see your updated community signals.',
      url: `/profile/${toUid}`,
      tag: `vote:${fromUid}`,
    }).catch(() => {});
  }).catch(() => {});
}

/**
 * Give an attribute to a user. Each voter can give multiple different
 * attributes to the same person — they accumulate independently. Giving the
 * *same* attribute again is blocked by a per-attribute 6h cooldown. Giving
 * the *opposite* attribute (e.g. behaviour → rude) replaces the old one:
 * the positive is removed and the negative is added in a single atomic swap.
 */
export async function setAttribute(toUid: string, fromUid: string, attr: AttrKey): Promise<{ ok: boolean; waitMs?: number }> {
  const specificRef = ref(db, `votes/${toUid}/${fromUid}/attrs/${attr}`);

  // Check if the user already gave THIS exact attribute (cooldown per-attr).
  const existingSnap = await get(specificRef);
  const existing = existingSnap.val() as { at: number } | null;
  if (existing && Date.now() - existing.at < SIX_HOURS) {
    return { ok: false, waitMs: SIX_HOURS - (Date.now() - existing.at) };
  }

  // Check if the OPPOSITE attribute exists — if so, this is a shift.
  const opposite = ATTR_OPPOSITES[attr];
  const oppositeRef = opposite ? ref(db, `votes/${toUid}/${fromUid}/attrs/${opposite}`) : null;
  const oppositeSnap = oppositeRef ? await get(oppositeRef) : null;
  const oppositeExists = oppositeSnap?.exists();

  // Ensure a main vote exists (auto-like for positive, auto-dislike for negative).
  const mainRef = ref(db, `votes/${toUid}/${fromUid}/main`);
  const mainSnap = await get(mainRef);
  const main = mainSnap.val() as 'like' | 'dislike' | null;
  if (!main) {
    const auto = (POSITIVE_ATTRS as readonly string[]).includes(attr) ? 'like' : 'dislike';
    await setLikeDislike(toUid, fromUid, auto);
  }

  const votedAt = Date.now();

  // Atomic: remove opposite if shifting, add the new attribute.
  await runTransaction(ref(db, `users/${toUid}/attrs`), (a: any) => {
    a = a ?? { behaviour: 0, reliability: 0, civic_sense: 0, rude: 0, unreliable: 0, uncivil: 0 };
    if (oppositeExists) {
      a[opposite!] = Math.max(0, (a[opposite!] ?? 0) - 1);
    }
    a[attr] = (a[attr] ?? 0) + 1;
    return a;
  });

  // Write the new attribute vote and remove the opposite if shifting.
  await set(specificRef, { at: votedAt });
  if (oppositeExists && oppositeRef) {
    await remove(oppositeRef);
  }

  await refreshCanactScore(toUid);
  return { ok: true };
}

/**
 * Remove (take back) a specific attribute you previously gave. Each attribute
 * has its own 6h cooldown — you must wait before taking back a freshly-given
 * one, but other previously-given attributes can be taken back independently.
 */
export async function removeAttribute(toUid: string, fromUid: string, attr: AttrKey): Promise<{ ok: boolean; waitMs?: number }> {
  const specificRef = ref(db, `votes/${toUid}/${fromUid}/attrs/${attr}`);
  const curSnap = await get(specificRef);
  const cur = curSnap.val() as { at: number } | null;
  if (!cur) return { ok: true }; // already gone

  if (Date.now() - cur.at < SIX_HOURS) {
    return { ok: false, waitMs: SIX_HOURS - (Date.now() - cur.at) };
  }

  await runTransaction(ref(db, `users/${toUid}/attrs`), (a: any) => {
    if (a?.[attr]) a[attr] = Math.max(0, (a[attr] ?? 0) - 1);
    return a;
  });
  await remove(specificRef);
  await refreshCanactScore(toUid);
  return { ok: true };
}

/** Recalculate and persist the Canact score for a user after attr changes.
 *  Sends a push notification when the score changes meaningfully (≥ 5 pts). */
async function refreshCanactScore(uid: string) {
  try {
    const snap = await get(ref(db, `users/${uid}`));
    const profile = snap.val() as UserProfile | null;
    if (!profile) return;
    const oldRating = profile.rating ?? 0;
    const { score, label } = calculateCanactScore(profile);
    const newRating = Math.round(score);
    profile.rating = newRating;
    profile.ratingCount = profile.ratingCount ?? 0;
    await set(ref(db, `users/${uid}/rating`), profile.rating);

    // Notify the user if their score changed meaningfully.
    const delta = newRating - oldRating;
    if (Math.abs(delta) >= 5) {
      import('./sendPush').then(({ sendPush }) => {
        sendPush({
          toUid: uid,
          title: delta > 0
            ? `Your trust score increased to ${newRating} ${label} ↑`
            : `Your trust score changed to ${newRating} ${label}`,
          body: delta > 0
            ? 'Your community presence is growing. Keep it up!'
            : 'Stay consistent — small reliable actions rebuild momentum.',
          url: '/',
          tag: `score:${newRating}`,
        }).catch(() => {});
      }).catch(() => {});
    }
  } catch { /* non-critical */ }
}

function clearVoteCache(key: string) {
  _voteCache.delete(key);
}

export async function giveCard(toUid: string, fromUid: string, card: CardKey) {
  const cref = ref(db, `votes/${toUid}/${fromUid}/cards/${card}`);
  const cardCacheKey = `${toUid}/${fromUid}/cards/${card}`;
  let cur = getCachedVote(cardCacheKey);
  if (cur === undefined) {
    cur = (await get(cref)).val();
    cacheVote(cardCacheKey, cur);
  }
  if (cur) return { ok: false as const, reason: 'already-sent' as const };
  const sentAt = Date.now();
  await runTransaction(ref(db, `users/${toUid}/cardsReceived/${card}`), (n: number) => (n ?? 0) + 1);
  await set(cref, sentAt);
  cacheVote(cardCacheKey, sentAt);
  return { ok: true as const };
}
export async function takeBackCard(toUid: string, fromUid: string, card: CardKey) {
  const cref = ref(db, `votes/${toUid}/${fromUid}/cards/${card}`);
  const cardCacheKey = `${toUid}/${fromUid}/cards/${card}`;
  let cur = getCachedVote(cardCacheKey);
  if (cur === undefined) {
    cur = (await get(cref)).val();
    cacheVote(cardCacheKey, cur);
  }
  if (!cur) return;
  await runTransaction(ref(db, `users/${toUid}/cardsReceived/${card}`), (n: number) => Math.max(0, (n ?? 0) - 1));
  await remove(cref);
}

export function listenMyVote(toUid: string, fromUid: string, cb: (v: any) => void) {
  // not used directly; helper to fetch
  return get(ref(db, `votes/${toUid}/${fromUid}`)).then((s) => cb(s.val()));
}
