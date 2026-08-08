import { onValue, push, ref, remove, runTransaction, set, update, get, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { WhaPost } from '../types';
import { recordOnboardingSignal } from './onboarding';
import { dailyActivityClaim, nextContentReactionVersion, recordScoreActivity, recordUniqueAuthorContentFeedback, syncAuthorContentReaction } from './scoreActivity';

function notify(receiverUid: string, kind: 'react' | 'comment', title: string, body: string, url: string) {
  Promise.all([import('./sendPush'), import('./notifications')]).then(([{ sendPush }, { pushNotification }]) => {
    sendPush({ toUid: receiverUid, title, body, url, tag: url }).catch(() => {});
    pushNotification(receiverUid, { kind, title, body, data: { url } }).catch(() => {});
  }).catch(() => {});
}

export async function createWhaPost(input: Omit<WhaPost, 'id' | 'createdAt' | 'expiresAt' | 'reactions'>) {
  const node = push(ref(db, 'wha'));
  const post: WhaPost = {
    ...input,
    id: node.key!,
    createdAt: Date.now(),
    reactions: { cool: 0, love: 0, wow: 0, sad: 0, angry: 0 },
  };
  await set(node, post);
  await set(ref(db, `userPosts/${input.uid}/${post.id}`), post.createdAt);
  await recordOnboardingSignal(input.uid, 'create-post');
  await recordScoreActivity(input.uid, dailyActivityClaim('create:wha'));
  return post;
}

export function listenWhaFeed(cb: (items: WhaPost[]) => void) {
  // Cap to the 60 most-recent posts so the initial RTDB payload stays
  // small even when the global feed has thousands of entries.
  const r = query(ref(db, 'wha'), orderByChild('createdAt'), limitToLast(60));
  return onValue(r, (snap) => {
    const out: WhaPost[] = [];
    // Posts remain part of the feed permanently. Map surfaces apply their
    // own 24-hour discovery window from `createdAt`.
    snap.forEach((c) => { const v = c.val() as WhaPost; if (v) out.push(v); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

/** Shared per-user listeners. Every subscriber receives future updates and the
 * root Firebase listener is released when the last profile view unmounts. */
type UserPostSubscription = {
  data: WhaPost[];
  listeners: Set<(items: WhaPost[]) => void>;
  unsubscribe: () => void;
};
const _userPostCache = new Map<string, UserPostSubscription>();
export function listenUserWhaPosts(uid: string, cb: (items: WhaPost[]) => void) {
  const cached = _userPostCache.get(uid);
  if (cached) {
    cached.listeners.add(cb);
    cb([...cached.data]);
    return () => {
      cached.listeners.delete(cb);
      if (cached.listeners.size === 0) {
        cached.unsubscribe();
        _userPostCache.delete(uid);
      }
    };
  }
  const r = query(ref(db, 'wha'), orderByChild('createdAt'));
  const entry: UserPostSubscription = { data: [], listeners: new Set([cb]), unsubscribe: () => {} };
  const unsub = onValue(r, (snap) => {
    const data: WhaPost[] = [];
    snap.forEach((c) => {
      const v = c.val() as WhaPost;
      if (v && v.uid === uid) data.push(v);
    });
    data.sort((a, b) => b.createdAt - a.createdAt);
    entry.data = data;
    entry.listeners.forEach((listener) => listener([...data]));
  });
  entry.unsubscribe = unsub;
  _userPostCache.set(uid, entry);
  return () => {
    entry.listeners.delete(cb);
    if (entry.listeners.size === 0) {
      entry.unsubscribe();
      _userPostCache.delete(uid);
    }
  };
}

export function listenPost(id: string, cb: (p: WhaPost | null) => void) {
  return onValue(ref(db, `wha/${id}`), (snap) => cb(snap.val()));
}

export async function reactWha(postId: string, uid: string, kind: 'cool' | 'love' | 'wow' | 'sad' | 'angry') {
  const reactionVersion = nextContentReactionVersion();
  let previous: 'cool' | 'love' | 'wow' | 'sad' | 'angry' | null = null;
  const result = await runTransaction(ref(db, `wha/${postId}`), (post: WhaPost | null) => {
    if (!post) return post;
    post.reactions = post.reactions ?? { cool: 0, love: 0, wow: 0, sad: 0, angry: 0 };
    post.reactionVoters = post.reactionVoters ?? {};
    const stored = post.reactionVoters[uid];
    previous = stored === 'cool' || stored === 'love' || stored === 'wow' || stored === 'sad' || stored === 'angry'
      ? stored
      : null;
    if (previous) post.reactions[previous] = Math.max(0, Number(post.reactions[previous] || 0) - 1);
    if (previous === kind) delete post.reactionVoters[uid];
    else {
      post.reactions[kind] = Number(post.reactions[kind] || 0) + 1;
      post.reactionVoters[uid] = kind;
    }
    return post;
  });
  if (!result.committed) throw new Error('Post not found');
  const post = result.snapshot.val() as WhaPost;
  const authorUid = post.uid;
  const next = previous === kind ? null : kind;

  // T4: Wire reaction to author's content score
  if (authorUid && authorUid !== uid) {
    const positiveKinds = ['cool', 'love', 'wow'];
    await syncAuthorContentReaction(
      authorUid,
      uid,
      `wha:${postId}:reaction`,
      previous ? (positiveKinds.includes(previous) ? 'like' : 'dislike') : null,
      next ? (positiveKinds.includes(next) ? 'like' : 'dislike') : null,
      reactionVersion,
    );
  }

  // Notify the post author about the reaction.
  if (authorUid && authorUid !== uid && next) {
    const emoji = { cool: '😎', love: '❤️', wow: '😮', sad: '😢', angry: '😡' }[kind];
    notify(authorUid, 'react', `${emoji} Someone reacted to your post`, 'Tap to see the reaction.', `/post/${postId}`);
  }
  if (authorUid && authorUid !== uid && next) {
    await recordOnboardingSignal(uid, 'engage-post');
    await recordScoreActivity(uid, `wha:${postId}:reaction`);
  }
}

export async function addComment(postId: string, uid: string, name: string, text: string) {
  const node = push(ref(db, `whaComments/${postId}`));
  await set(node, { id: node.key, uid, name, text, createdAt: Date.now() });
  await runTransaction(ref(db, `wha/${postId}/commentCount`), (c: number) => (c ?? 0) + 1);
  // T4 + notify the post author.
  try {
    const postSnap = await get(ref(db, `wha/${postId}`));
    const authorUid = (postSnap.val() as WhaPost | null)?.uid;
    if (authorUid && authorUid !== uid) {
      await recordOnboardingSignal(uid, 'engage-post');
      await Promise.all([
        recordScoreActivity(uid, `wha:${postId}:comment`),
        recordUniqueAuthorContentFeedback(authorUid, uid, `wha:${postId}:comment`),
      ]);
      notify(authorUid, 'comment', `${name} commented on your post`, text.slice(0, 100), `/post/${postId}`);
    }
  } catch { /* non-fatal */ }
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
