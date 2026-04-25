import { onValue, push, ref, remove, set, update, query, orderByChild, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { ReelItem } from '../types';

export async function createReel(input: Omit<ReelItem, 'id' | 'createdAt' | 'likes' | 'views'>) {
  const node = push(ref(db, 'reels'));
  const reel: ReelItem = {
    ...input,
    id: node.key as string,
    createdAt: Date.now(),
    likes: {},
    views: 0,
  };
  await set(node, reel);
  await set(ref(db, `userReels/${input.uid}/${reel.id}`), reel.createdAt);
  return reel;
}

export function listenReels(cb: (items: ReelItem[]) => void) {
  const r = query(ref(db, 'reels'), orderByChild('createdAt'));
  return onValue(r, (snap) => {
    const out: ReelItem[] = [];
    snap.forEach((c) => { out.push(c.val() as ReelItem); });
    out.sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

export async function toggleReelLike(reelId: string, uid: string) {
  const r = ref(db, `reels/${reelId}/likes/${uid}`);
  await runTransaction(r, (cur) => (cur ? null : Date.now()));
}

export async function bumpReelView(reelId: string) {
  await runTransaction(ref(db, `reels/${reelId}/views`), (n: number) => (n ?? 0) + 1);
}

export async function deleteReel(reelId: string, uid: string) {
  await remove(ref(db, `reels/${reelId}`));
  await remove(ref(db, `userReels/${uid}/${reelId}`));
}
