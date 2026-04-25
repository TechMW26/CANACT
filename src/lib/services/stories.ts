import { onValue, ref, set, remove, update, push, child } from 'firebase/database';
import { db } from '../firebase';
import type { StoryItem, StoryOverlay, StoryReply } from '../types';

/** Recursively strip undefined values; Firebase RTDB rejects them and that's
 * the most common cause of "Share story" silently throwing. */
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

export async function upsertStory(input: Omit<StoryItem, 'id' | 'createdAt' | 'expiresAt' | 'viewers' | 'likes' | 'replies'>) {
  const story: StoryItem = stripUndef({
    ...input,
    id: input.uid,
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 3600 * 1000,
  });
  await set(ref(db, `stories/${input.uid}`), story);
  return story;
}

export async function deleteStory(uid: string) {
  await remove(ref(db, `stories/${uid}`));
}

export function listenActiveStories(cb: (items: StoryItem[]) => void) {
  return onValue(ref(db, 'stories'), (snap) => {
    const out: StoryItem[] = [];
    snap.forEach((c) => {
      const value = c.val() as StoryItem;
      if (value?.expiresAt > Date.now()) out.push(value);
    });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

export async function markStoryView(storyUid: string, viewer: { uid: string; name: string; photoURL?: string }) {
  if (storyUid === viewer.uid) return;
  await update(ref(db, `stories/${storyUid}/viewers/${viewer.uid}`), {
    uid: viewer.uid,
    name: viewer.name,
    photoURL: viewer.photoURL ?? null,
    at: Date.now(),
  });
}

export async function toggleStoryLike(storyUid: string, viewerUid: string, liked: boolean) {
  await update(ref(db, `stories/${storyUid}`), {
    [`likes/${viewerUid}`]: liked ? Date.now() : null,
    [`viewers/${viewerUid}/liked`]: liked,
  });
}

export async function replyToStory(storyUid: string, reply: Omit<StoryReply, 'id' | 'createdAt'>) {
  const replyRef = push(child(ref(db), `stories/${storyUid}/replies`));
  const item: StoryReply = { ...reply, id: replyRef.key as string, createdAt: Date.now() };
  await set(replyRef, item);
  return item;
}

export function listenStory(uid: string, cb: (story: StoryItem | null) => void) {
  return onValue(ref(db, `stories/${uid}`), (snap) => {
    cb((snap.val() as StoryItem) ?? null);
  });
}

export type { StoryOverlay };
