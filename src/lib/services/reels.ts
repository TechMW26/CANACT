import { get, onValue, push, ref, remove, set, update, query, orderByChild, limitToLast, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { ReelItem } from '../types';
import { recordOnboardingSignal } from './onboarding';
import { recordScoreActivity } from './scoreActivity';

function stripUndef<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndef).filter((x) => x !== undefined) as unknown as T;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v as any)) {
      if (val === undefined) continue;
      out[k] = stripUndef(val as any);
    }
    return out as T;
  }
  return v;
}

export async function createReel(input: Omit<ReelItem, 'id' | 'createdAt' | 'likes' | 'views'>) {
  const node = push(ref(db, 'reels'));
  const reel: ReelItem = stripUndef({
    ...input,
    id: node.key as string,
    createdAt: Date.now(),
    likes: {},
    views: 0,
  });
  await set(node, reel);
  await set(ref(db, `userReels/${input.uid}/${reel.id}`), reel.createdAt);
  await recordOnboardingSignal(input.uid, 'create-post');
  await recordScoreActivity(input.uid);
  return reel;
}

export function listenReels(cb: (items: ReelItem[]) => void) {
  const r = query(ref(db, 'reels'), orderByChild('createdAt'), limitToLast(40));
  return onValue(r, (snap) => {
    const out: ReelItem[] = [];
    snap.forEach((c) => { out.push(c.val() as ReelItem); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

export function listenUserReels(uid: string, cb: (items: ReelItem[]) => void) {
  // Read full reels list and filter by uid client-side. Avoids needing an index
  // on `uid` in RTDB rules. Reel volume is small.
  const r = query(ref(db, 'reels'), orderByChild('createdAt'));
  return onValue(r, (snap) => {
    const out: ReelItem[] = [];
    snap.forEach((c) => {
      const v = c.val() as ReelItem;
      if (v && v.uid === uid) out.push(v);
    });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

export async function toggleReelLike(reelId: string, uid: string) {
  const r = ref(db, `reels/${reelId}/likes/${uid}`);
  const [likeSnap, reelSnap] = await Promise.all([get(r), get(ref(db, `reels/${reelId}`))]);
  const wasLiked = likeSnap.exists();
  const authorUid = (reelSnap.val() as ReelItem | null)?.uid;
  await runTransaction(r, (cur) => (cur ? null : Date.now()));
  await recordOnboardingSignal(uid, 'engage-post');
  if (!wasLiked) await recordScoreActivity(uid);
  if (authorUid && authorUid !== uid) {
    await runTransaction(ref(db, `users/${authorUid}/contentLikes`), (count: number | null) => Math.max(0, Number(count || 0) + (wasLiked ? -1 : 1)));
  }
}

export async function bumpReelView(reelId: string) {
  await runTransaction(ref(db, `reels/${reelId}/views`), (n: number) => (n ?? 0) + 1);
}

export async function deleteReel(reelId: string, uid: string) {
  await Promise.all([
    remove(ref(db, `reels/${reelId}`)),
    remove(ref(db, `userReels/${uid}/${reelId}`)),
    remove(ref(db, `reelComments/${reelId}`)),
  ]);
}

export async function addReelComment(reelId: string, uid: string, name: string, photoURL: string | undefined, text: string) {
  const node = push(ref(db, `reelComments/${reelId}`));
  await set(node, stripUndef({ id: node.key, uid, name, photoURL, text, createdAt: Date.now() }));
  await runTransaction(ref(db, `reels/${reelId}/commentCount`), (c: number) => (c ?? 0) + 1);
  await recordOnboardingSignal(uid, 'engage-post');
  await recordScoreActivity(uid);

  const reel = (await get(ref(db, `reels/${reelId}`))).val() as ReelItem | null;
  if (reel?.uid && reel.uid !== uid) {
    await runTransaction(ref(db, `users/${reel.uid}/contentLikes`), (count: number | null) => Number(count || 0) + 1);
  }
}

export function listenReelComments(reelId: string, cb: (items: any[]) => void) {
  return onValue(ref(db, `reelComments/${reelId}`), (snap) => {
    const out: any[] = [];
    snap.forEach((c) => { out.push(c.val()); });
    out.sort((a, b) => a.createdAt - b.createdAt);
    cb(out);
  });
}
