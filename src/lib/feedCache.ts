// Process-lifetime cache for feed data so navigating away and back
// paints instantly with the last-known data while the live listeners
// re-attach in the background. Keyed by user uid so logging out as a
// different account never spills over the previous user's content.
//
// This is in-memory only; if the WebView is killed by the OS the cache
// resets. That's intentional — staleness across cold starts is a much
// bigger correctness risk than the millisecond cost of re-fetching.

import type { Poll, RateMeSession, ReelItem, StoryItem, WhaPost } from './types';

type FeedSnapshot = {
  uid: string | null;
  wha: WhaPost[];
  polls: Poll[];
  rms: RateMeSession[];
  reels: ReelItem[];
  stories: StoryItem[];
  ts: number;
};

const EMPTY: FeedSnapshot = {
  uid: null, wha: [], polls: [], rms: [], reels: [], stories: [], ts: 0,
};

let snap: FeedSnapshot = { ...EMPTY };

export function readFeedCache(uid: string | null | undefined): FeedSnapshot {
  if (!uid || snap.uid !== uid) return EMPTY;
  return snap;
}

export function writeFeedCachePart<K extends keyof Omit<FeedSnapshot, 'uid' | 'ts'>>(
  uid: string | null | undefined,
  key: K,
  value: FeedSnapshot[K],
) {
  if (!uid) return;
  if (snap.uid !== uid) snap = { ...EMPTY, uid };
  snap = { ...snap, [key]: value, ts: Date.now() };
}

export function clearFeedCache() {
  snap = { ...EMPTY };
}
