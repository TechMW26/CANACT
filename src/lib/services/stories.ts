import { onValue, ref, set, remove, update, push, child, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { StoryItem, StoryOverlay, StoryReply } from '../types';
import { recordOnboardingSignal } from './onboarding';
import { pushNotification } from './notifications';
import { dailyActivityClaim, nextContentReactionVersion, recordScoreActivity, syncAuthorContentReaction } from './scoreActivity';

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

/** Append a new story for the user. Each user can have many active stories
 *  at once (24h window) — they're stored under `stories/{uid}/{storyId}`
 *  where storyId is a Firebase push key. The legacy single-doc layout
 *  (`stories/{uid}` holding one StoryItem directly) is still readable by
 *  `listenActiveStories`, but every newly-posted story now lands in the
 *  per-user collection so adding a second story before the first expires
 *  no longer overwrites it. */
export async function addStory(
  input: Omit<StoryItem, 'id' | 'createdAt' | 'expiresAt' | 'viewers' | 'likes' | 'replies'>,
) {
  const storyRef = push(child(ref(db), `stories/${input.uid}`));
  const id = storyRef.key as string;
  const durationHours = [12, 24, 48, 72].includes(Number(input.durationHours))
    ? Number(input.durationHours) as 12 | 24 | 48 | 72
    : 24;
  const story: StoryItem = stripUndef({
    ...input,
    durationHours,
    id,
    createdAt: Date.now(),
    expiresAt: Date.now() + durationHours * 3600 * 1000,
  });
  await set(storyRef, story);
  await recordOnboardingSignal(input.uid, 'create-post');
  await recordScoreActivity(input.uid, dailyActivityClaim('create:story'));
  return story;
}

/** Back-compat alias used by the create-story page. */
export const upsertStory = addStory;

/** Delete one specific story belonging to `authorUid`. When `storyId` is
 *  omitted (or matches the uid) we treat it as the legacy single-doc
 *  layout and remove the entire user node. */
export async function deleteStory(authorUid: string, storyId?: string) {
  if (!storyId || storyId === authorUid) {
    await remove(ref(db, `stories/${authorUid}`));
    return;
  }
  await remove(ref(db, `stories/${authorUid}/${storyId}`));
}

/** Stream all active stories from every user. Handles both schemas:
 *  - new: `stories/{uid}/{storyId}` → object with `id`, `uid`, `mediaUrl`…
 *  - legacy: `stories/{uid}` → a single StoryItem directly under the uid
 *  Each user's stories are sorted oldest-first so the segmented progress
 *  bar plays them in posting order; users are sorted by their newest
 *  story (latest first) so fresh creators surface to the left.
 *
 *  Rendering is capped at 30 most-recent users and 100 total stories. The
 *  current mixed legacy/new schema still requires one root snapshot; moving
 *  to a timestamp-indexed flat feed is required to cap network reads too. */
export function listenActiveStories(cb: (items: StoryItem[]) => void) {
  return onValue(ref(db, 'stories'), (snap) => {
    const now = Date.now();
    const groups: Array<{ uid: string; latest: number; items: StoryItem[] }> = [];
    snap.forEach((userNode) => {
      const uid = userNode.key as string;
      const value = userNode.val();
      if (!value || typeof value !== 'object') return;
      const list: StoryItem[] = [];
      // Detect legacy single-doc: the value itself looks like a StoryItem.
      if (typeof (value as any).mediaUrl === 'string' && typeof (value as any).expiresAt === 'number') {
        const v = value as StoryItem;
        if (v.expiresAt > now) list.push({ ...v, id: v.id || uid, uid });
      } else {
        for (const [storyId, raw] of Object.entries(value as Record<string, StoryItem>)) {
          if (!raw || typeof raw !== 'object') continue;
          if (typeof (raw as any).mediaUrl !== 'string' || typeof (raw as any).expiresAt !== 'number') continue;
          if (raw.expiresAt > now) list.push({ ...raw, id: raw.id || storyId, uid });
        }
      }
      if (list.length === 0) return;
      list.sort((a, b) => a.createdAt - b.createdAt);
      groups.push({ uid, latest: list[list.length - 1].createdAt, items: list });
    });
    // Client-side render cap: 30 most-recent users, 100 total stories max.
    groups.sort((a, b) => b.latest - a.latest);
    const topGroups = groups.slice(0, 30);
    const out: StoryItem[] = [];
    for (const g of topGroups) {
      for (const item of g.items) {
        out.push(item);
        if (out.length >= 100) break;
      }
      if (out.length >= 100) break;
    }
    cb(out);
  });
}

/** Stream one profile's currently active stories without loading the global
 * story feed. Supports the legacy single-story node and the current collection. */
export function listenUserStories(uid: string, cb: (items: StoryItem[]) => void) {
  return onValue(ref(db, `stories/${uid}`), (snap) => {
    const now = Date.now();
    const value = snap.val();
    if (!value || typeof value !== 'object') return cb([]);
    if (typeof value.mediaUrl === 'string' && Number(value.expiresAt) > now) {
      cb([{ ...value, id: value.id || uid, uid } as StoryItem]);
      return;
    }
    const items = Object.entries(value as Record<string, StoryItem>)
      .flatMap(([id, story]) => story && typeof story.mediaUrl === 'string' && story.expiresAt > now
        ? [{ ...story, id: story.id || id, uid }]
        : [])
      .sort((a, b) => a.createdAt - b.createdAt);
    cb(items);
  });
}

/** Path resolver that handles both schemas — legacy single-doc lives at
 *  `stories/{uid}`, new collection at `stories/{uid}/{storyId}`. */
function storyPath(authorUid: string, storyId: string): string {
  if (storyId === authorUid) return `stories/${authorUid}`;
  return `stories/${authorUid}/${storyId}`;
}

export async function markStoryView(
  authorUid: string,
  storyId: string,
  viewer: { uid: string; name: string; photoURL?: string },
) {
  if (authorUid === viewer.uid) return;
  await update(ref(db, `${storyPath(authorUid, storyId)}/viewers/${viewer.uid}`), {
    uid: viewer.uid,
    name: viewer.name,
    photoURL: viewer.photoURL ?? null,
    at: Date.now(),
  });
}

export async function toggleStoryLike(
  authorUid: string,
  storyId: string,
  viewerUid: string,
  liked: boolean,
) {
  const reactionVersion = nextContentReactionVersion();
  let wasLiked = false;
  const result = await runTransaction(ref(db, storyPath(authorUid, storyId)), (story: StoryItem | null) => {
    if (!story) return story;
    story.likes = story.likes ?? {};
    wasLiked = !!story.likes[viewerUid];
    if (wasLiked === liked) return story;
    if (liked) story.likes[viewerUid] = Date.now();
    else delete story.likes[viewerUid];
    if (story.viewers?.[viewerUid]) story.viewers[viewerUid].liked = liked;
    return story;
  });
  if (!result.committed || wasLiked === liked || authorUid === viewerUid) return;
  await syncAuthorContentReaction(
    authorUid,
    viewerUid,
    `story:${authorUid}:${storyId}:reaction`,
    wasLiked ? 'like' : null,
    liked ? 'like' : null,
    reactionVersion,
  );
  if (liked) {
    await recordScoreActivity(viewerUid, `story:${authorUid}:${storyId}:reaction`);
    await pushNotification(authorUid, {
      kind: 'react',
      title: 'Someone liked your story',
      body: 'Open your profile to see your active stories.',
      data: { url: `/profile/${authorUid}` },
    });
  }
}

export async function replyToStory(
  authorUid: string,
  storyId: string,
  reply: Omit<StoryReply, 'id' | 'createdAt'>,
) {
  const replyRef = push(child(ref(db), `${storyPath(authorUid, storyId)}/replies`));
  const item: StoryReply = { ...reply, id: replyRef.key as string, createdAt: Date.now() };
  await set(replyRef, item);
  if (authorUid !== reply.fromUid) {
    await recordScoreActivity(reply.fromUid, `story:${authorUid}:${storyId}:reply`);
    await pushNotification(authorUid, {
      kind: 'comment',
      title: `${reply.fromName} replied to your story`,
      body: reply.text.slice(0, 100),
      data: { url: `/profile/${authorUid}` },
    });
  }
  return item;
}

export function listenStory(
  authorUid: string,
  storyId: string,
  cb: (story: StoryItem | null) => void,
) {
  return onValue(ref(db, storyPath(authorUid, storyId)), (snap) => {
    cb((snap.val() as StoryItem) ?? null);
  });
}

export type { StoryOverlay };
