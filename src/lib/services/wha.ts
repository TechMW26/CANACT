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
 * Caches locally to avoid re-filtering all posts on every listen. */
const _userPostCache = new Map<string, { unsub: () => void; data: WhaPost[] }>();
export function listenUserWhaPosts(uid: string, cb: (items: WhaPost[]) => void) {
  if (_userPostCache.has(uid)) {
    const cached = _userPostCache.get(uid)!;
    cb(cached.data);
    return cached.unsub;
  }
  const r = query(ref(db, 'wha'), orderByChild('createdAt'));
  const data: WhaPost[] = [];
  const unsub = onValue(r, (snap) => {
    data.length = 0;
    snap.forEach((c) => {
      const v = c.val() as WhaPost;
      if (v && v.uid === uid) data.push(v);
    });
    data.sort((a, b) => b.createdAt - a.createdAt);
    cb(data);
  });
  const cleanup = () => {
    unsub();
    _userPostCache.delete(uid);
  };
  _userPostCache.set(uid, { unsub: cleanup, data });
  return cleanup;
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
  // Read the post first so we can tell the service worker which media URLs
  // to drop from the on-device cache (those CDN objects will 404 once
  // we wipe the RTDB record). Best-effort \u2014 if the read fails for any
  // reason we still proceed with the delete; cache will GC by TTL.
  let urls: string[] = [];
  try {
    const snap = await get(ref(db, `wha/${postId}`));
    const v = snap.val() as WhaPost | null;
    if (v) {
      if (Array.isArray(v.mediaUrls)) urls = urls.concat(v.mediaUrls.filter(Boolean));
      if (Array.isArray(v.mediaPosters)) urls = urls.concat(v.mediaPosters.filter(Boolean));
    }
  } catch { /* ignore \u2014 deletion is the priority */ }

  await Promise.all([
    remove(ref(db, `wha/${postId}`)),
    remove(ref(db, `userPosts/${uid}/${postId}`)),
    remove(ref(db, `whaComments/${postId}`)),
  ]);

  if (urls.length && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls });
    } catch { /* ignore */ }
  }
}
