import { onValue, push, ref, remove, runTransaction, set, update, get, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { WhaPost } from '../types';

export async function createWhaPost(input: Omit<WhaPost, 'id' | 'createdAt' | 'expiresAt' | 'reactions'>) {
  const node = push(ref(db, 'wha'));
  const post: WhaPost = {
    ...input,
    id: node.key!,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 3600 * 1000,
    reactions: { cool: 0, love: 0, wow: 0, sad: 0, angry: 0 },
  };
  await set(node, post);
  await set(ref(db, `userPosts/${input.uid}/${post.id}`), post.createdAt);
  return post;
}

export function listenWhaFeed(cb: (items: WhaPost[]) => void) {
  // Cap to the 60 most-recent posts so the initial RTDB payload stays
  // small even when the global feed has thousands of entries.
  const r = query(ref(db, 'wha'), orderByChild('createdAt'), limitToLast(60));
  return onValue(r, (snap) => {
    const out: WhaPost[] = [];
    snap.forEach((c) => { const v = c.val() as WhaPost; if (v.expiresAt > Date.now()) out.push(v); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

/** Listen for posts authored by a specific user (Instagram-style profile grid).
 * Filters client-side and includes expired posts so the grid does not empty out. */
export function listenUserWhaPosts(uid: string, cb: (items: WhaPost[]) => void) {
  const r = query(ref(db, 'wha'), orderByChild('createdAt'));
  return onValue(r, (snap) => {
    const out: WhaPost[] = [];
    snap.forEach((c) => { const v = c.val() as WhaPost; if (v && v.uid === uid) out.push(v); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

export function listenPost(id: string, cb: (p: WhaPost | null) => void) {
  return onValue(ref(db, `wha/${id}`), (snap) => cb(snap.val()));
}

export async function reactWha(postId: string, uid: string, kind: 'cool' | 'love' | 'wow' | 'sad' | 'angry') {
  const voterRef = ref(db, `wha/${postId}/reactionVoters/${uid}`);
  const cur = (await get(voterRef)).val() as string | null;
  await runTransaction(ref(db, `wha/${postId}/reactions`), (cur2: any) => {
    cur2 = cur2 ?? { cool: 0, love: 0, wow: 0, sad: 0, angry: 0 };
    if (cur && cur in cur2) cur2[cur] = Math.max(0, (cur2[cur] ?? 0) - 1);
    if (cur !== kind) cur2[kind] = (cur2[kind] ?? 0) + 1;
    return cur2;
  });
  if (cur === kind) await remove(voterRef); else await set(voterRef, kind);
}

export async function addComment(postId: string, uid: string, name: string, text: string) {
  const node = push(ref(db, `whaComments/${postId}`));
  await set(node, { id: node.key, uid, name, text, createdAt: Date.now() });
  await runTransaction(ref(db, `wha/${postId}/commentCount`), (c: number) => (c ?? 0) + 1);
}
export function listenComments(postId: string, cb: (items: any[]) => void) {
  return onValue(ref(db, `whaComments/${postId}`), (snap) => {
    const out: any[] = []; snap.forEach((c) => { out.push(c.val()); });
    out.sort((a, b) => a.createdAt - b.createdAt); cb(out);
  });
}
export async function reportPost(postId: string, uid: string, reason: string) {
  await push(ref(db, `reports/wha/${postId}`), { uid, reason, at: Date.now() });
}
export async function deletePost(postId: string, uid: string) {
  await remove(ref(db, `wha/${postId}`));
  await remove(ref(db, `userPosts/${uid}/${postId}`));
}
