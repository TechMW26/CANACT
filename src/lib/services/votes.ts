import { get, onValue, ref, runTransaction, set, remove, update } from 'firebase/database';
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
import { recordOnboardingSignal } from './onboarding';

export const SIX_HOURS = 6 * 3600 * 1000;

export type AttributeVote = { at: number };
export type AttributeVoteMap = Partial<Record<AttrKey, AttributeVote>>;
export type AttributeVoteState = { attrs: AttributeVoteMap; cooldowns: AttributeVoteMap };
export type AttributeMutationResult = {
  ok: boolean;
  action?: 'given' | 'replaced' | 'removed';
  reason?: 'cooldown' | 'already-given';
  waitMs?: number;
};

export function listenAttributeVotes(toUid: string, fromUid: string, callback: (votes: AttributeVoteMap) => void) {
  return onValue(ref(db, `votes/${toUid}/${fromUid}/attrs`), (snapshot) => {
    callback((snapshot.val() ?? {}) as AttributeVoteMap);
  });
}

export function listenAttributeVoteState(toUid: string, fromUid: string, callback: (state: AttributeVoteState) => void) {
  return onValue(ref(db, `votes/${toUid}/${fromUid}`), (snapshot) => {
    const value = snapshot.val() ?? {};
    callback({
      attrs: (value.attrs ?? {}) as AttributeVoteMap,
      cooldowns: (value.attrCooldowns ?? {}) as AttributeVoteMap,
    });
  });
}

export function getAttributeCooldownMs(votes: AttributeVoteMap, attr: AttrKey, now = Date.now()) {
  const at = Number(votes[attr]?.at || 0);
  return at ? Math.max(0, SIX_HOURS - (now - at)) : 0;
}

/** One bipolar slider is one voting unit. Any action on either side locks the
 * entire pair, including the neutral state after taking a signal back. */
export function getAttributePairCooldownMs(
  votes: AttributeVoteMap,
  cooldowns: AttributeVoteMap,
  attr: AttrKey,
  now = Date.now(),
) {
  const opposite = ATTR_OPPOSITES[attr] as AttrKey | undefined;
  const keys = opposite ? [attr, opposite] : [attr];
  const latestActionAt = Math.max(...keys.flatMap((key) => [
    Number(votes[key]?.at || 0),
    Number(cooldowns[key]?.at || 0),
  ]));
  return latestActionAt ? Math.max(0, SIX_HOURS - (now - latestActionAt)) : 0;
}

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
  const votedAtRef = ref(db, `votes/${toUid}/${fromUid}/votedAt`);
  const cacheKey = `${toUid}/${fromUid}/main`;
  let prev = getCachedVote(cacheKey);
  if (prev === undefined) {
    prev = (await get(myVoteRef)).val() as 'like' | 'dislike' | null;
    cacheVote(cacheKey, prev);
  }

  // ── 6‑hour cooldown: you can like/dislike the same person once every 6h ──
  const lastVotedAt = (await get(votedAtRef)).val() as number | null;
  if (lastVotedAt && Date.now() - lastVotedAt < SIX_HOURS) {
    const remaining = SIX_HOURS - (Date.now() - lastVotedAt);
    throw new Error(`COOLDOWN:${remaining}`);
  }

  if (prev === kind) {
    await recordOnboardingSignal(fromUid, 'rate-profile');
    return;
  }
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
  await set(votedAtRef, Date.now());
  await recordOnboardingSignal(fromUid, 'rate-profile');

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
 * attributes to the same person — one per bipolar pair. An active attribute
 * can never be counted twice. Removal, re-adding, and switching sides all obey
 * the pair's shared six-hour ledger across every UI entry point.
 */
export async function setAttribute(toUid: string, fromUid: string, attr: AttrKey): Promise<AttributeMutationResult> {
  if (!toUid || !fromUid || toUid === fromUid) throw new Error('Invalid attribute recipient');
  const pairRef = ref(db, `votes/${toUid}/${fromUid}`);
  const votedAt = Date.now();
  const opposite = ATTR_OPPOSITES[attr] as AttrKey | undefined;
  let removedOpposite: AttrKey | null = null;
  let reason: AttributeMutationResult['reason'];
  let waitMs = 0;

  const result = await runTransaction(pairRef, (current: any) => {
    const state = current ?? {};
    const attrs: AttributeVoteMap = { ...(state.attrs ?? {}) };
    const cooldowns: AttributeVoteMap = { ...(state.attrCooldowns ?? {}) };
    const existing = attrs[attr];
    if (existing) {
      reason = 'already-given';
      waitMs = getAttributeCooldownMs(attrs, attr, votedAt);
      return;
    }
    const pairWait = getAttributePairCooldownMs(attrs, cooldowns, attr, votedAt);
    if (pairWait > 0) {
      reason = 'cooldown';
      waitMs = pairWait;
      return;
    }
    if (opposite && attrs[opposite]) {
      delete attrs[opposite];
      cooldowns[opposite] = { at: votedAt };
      removedOpposite = opposite;
    }
    attrs[attr] = { at: votedAt };
    cooldowns[attr] = { at: votedAt };
    state.attrs = attrs;
    state.attrCooldowns = cooldowns;
    delete state.attr;
    return state;
  });

  if (!result.committed) return { ok: false, reason: reason ?? 'cooldown', waitMs };

  await runTransaction(ref(db, `users/${toUid}/attrs`), (a: any) => {
    a = a ?? { behaviour: 0, reliability: 0, civic_sense: 0, rude: 0, unreliable: 0, uncivil: 0 };
    if (removedOpposite) {
      a[removedOpposite] = Math.max(0, (a[removedOpposite] ?? 0) - 1);
    }
    a[attr] = (a[attr] ?? 0) + 1;
    return a;
  });
  await recordOnboardingSignal(fromUid, 'rate-profile');

  const mainRef = ref(db, `votes/${toUid}/${fromUid}/main`);
  if (!(await get(mainRef)).exists()) {
    await setLikeDislike(toUid, fromUid, (POSITIVE_ATTRS as readonly string[]).includes(attr) ? 'like' : 'dislike');
  }
  await refreshCanactScore(toUid);
  return { ok: true, action: removedOpposite ? 'replaced' : 'given' };
}

/**
 * Remove (take back) a specific attribute you previously gave. Each bipolar
 * pair has one 6h cooldown; the opposite side remains locked after removal.
 */
export async function removeAttribute(toUid: string, fromUid: string, attr: AttrKey): Promise<AttributeMutationResult> {
  if (!toUid || !fromUid || toUid === fromUid) throw new Error('Invalid attribute recipient');
  const changedAt = Date.now();
  let waitMs = 0;
  let alreadyAbsent = false;
  const result = await runTransaction(ref(db, `votes/${toUid}/${fromUid}`), (current: any) => {
    if (!current?.attrs?.[attr]) { alreadyAbsent = true; return; }
    const remaining = getAttributePairCooldownMs(
      current.attrs ?? {},
      current.attrCooldowns ?? {},
      attr,
      changedAt,
    );
    if (remaining > 0) { waitMs = remaining; return; }
    const attrs = { ...current.attrs };
    delete attrs[attr];
    return {
      ...current,
      attrs,
      attrCooldowns: { ...(current.attrCooldowns ?? {}), [attr]: { at: changedAt } },
    };
  });

  if (!result.committed) return alreadyAbsent ? { ok: true } : { ok: false, reason: 'cooldown', waitMs };

  await runTransaction(ref(db, `users/${toUid}/attrs`), (a: any) => {
    if (a?.[attr]) a[attr] = Math.max(0, (a[attr] ?? 0) - 1);
    return a;
  });
  await refreshCanactScore(toUid);
  return { ok: true, action: 'removed' };
}

/** Recalculate and persist the Canact score for a user after attr changes.
 *  Sends a push notification when the score changes meaningfully (≥ 5 pts). */
async function refreshCanactScore(uid: string) {
  try {
    const snap = await get(ref(db, `users/${uid}`));
    const profile = snap.val() as UserProfile | null;
    if (!profile) return;
    const oldScore = profile.canactScore ?? calculateCanactScore(profile).score;
    const { score, label } = calculateCanactScore(profile);
    const newScore = Math.round(score);
    await update(ref(db, `users/${uid}`), {
      canactScore: newScore,
      canactScoreUpdatedAt: Date.now(),
    });

    // Notify the user if their score changed meaningfully.
    const delta = newScore - oldScore;
    if (Math.abs(delta) >= 5) {
      import('./sendPush').then(({ sendPush }) => {
        sendPush({
          toUid: uid,
          title: delta > 0
            ? `Your trust score increased to ${newScore} ${label} ↑`
            : `Your trust score changed to ${newScore} ${label}`,
          body: delta > 0
            ? 'Your community presence is growing. Keep it up!'
            : 'Stay consistent — small reliable actions rebuild momentum.',
          url: '/',
          tag: `score:${newScore}`,
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
