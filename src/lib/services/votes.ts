import { get, ref, runTransaction, set, remove } from 'firebase/database';
import { db } from '../firebase';
import { AttrKey, CardKey, POSITIVE_ATTRS, UserProfile } from '../types';
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
}

export async function setAttribute(toUid: string, fromUid: string, attr: AttrKey): Promise<{ ok: boolean; waitMs?: number }> {
  const attrVoteRef = ref(db, `votes/${toUid}/${fromUid}/attr`);
  const attrCacheKey = `${toUid}/${fromUid}/attr`;
  let cur = getCachedVote(attrCacheKey);
  if (cur === undefined) {
    cur = (await get(attrVoteRef)).val() as { key: AttrKey; at: number } | null;
    cacheVote(attrCacheKey, cur);
  }
  if (cur && Date.now() - cur.at < SIX_HOURS) return { ok: false, waitMs: SIX_HOURS - (Date.now() - cur.at) };

  const mainRef = ref(db, `votes/${toUid}/${fromUid}/main`);
  const mainCacheKey = `${toUid}/${fromUid}/main`;
  let main = getCachedVote(mainCacheKey);
  if (main === undefined) {
    main = (await get(mainRef)).val() as 'like' | 'dislike' | null;
    cacheVote(mainCacheKey, main);
  }
  if (!main) {
    const auto = (POSITIVE_ATTRS as readonly string[]).includes(attr) ? 'like' : 'dislike';
    await setLikeDislike(toUid, fromUid, auto);
  }

  await runTransaction(ref(db, `users/${toUid}/attrs`), (a: any) => {
    a = a ?? { behaviour: 0, reliability: 0, civic_sense: 0, rude: 0, unreliable: 0, uncivil: 0 };
    if (cur?.key) a[cur.key] = Math.max(0, (a[cur.key] ?? 0) - 1);
    a[attr] = (a[attr] ?? 0) + 1;
    return a;
  });
  await set(attrVoteRef, { key: attr, at: Date.now() });
  await refreshCanactScore(toUid);
  return { ok: true };
}

/** Remove an attribute vote (take-back). Enforces the same 6-hour cooldown. */
export async function removeAttribute(toUid: string, fromUid: string): Promise<{ ok: boolean; waitMs?: number }> {
  const attrVoteRef = ref(db, `votes/${toUid}/${fromUid}/attr`);
  const cur = (await get(attrVoteRef)).val() as { key: AttrKey; at: number } | null;
  if (!cur) return { ok: true };
  if (Date.now() - cur.at < SIX_HOURS) return { ok: false, waitMs: SIX_HOURS - (Date.now() - cur.at) };

  await runTransaction(ref(db, `users/${toUid}/attrs`), (a: any) => {
    if (a?.[cur.key]) a[cur.key] = Math.max(0, (a[cur.key] ?? 0) - 1);
    return a;
  });
  await remove(attrVoteRef);
  clearVoteCache(`${toUid}/${fromUid}/attr`);
  await refreshCanactScore(toUid);
  return { ok: true };
}

/** Recalculate and persist the Canact score for a user after attr changes. */
async function refreshCanactScore(uid: string) {
  try {
    const snap = await get(ref(db, `users/${uid}`));
    const profile = snap.val() as UserProfile | null;
    if (!profile) return;
    const { score } = calculateCanactScore(profile);
    profile.rating = Math.round(score);
    profile.ratingCount = profile.ratingCount ?? 0;
    await set(ref(db, `users/${uid}/rating`), profile.rating);
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
  if (cur) return;
  await runTransaction(ref(db, `users/${toUid}/cardsReceived/${card}`), (n: number) => (n ?? 0) + 1);
  await set(cref, Date.now());
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
