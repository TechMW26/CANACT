import { onValue, push, ref, runTransaction, set, get, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { Poll, PollOption } from '../types';
import { uid as rid } from '../utils';

function normalizeOptions(raw: any): PollOption[] {
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') {
    return Object.values(raw).filter(Boolean) as PollOption[];
  }
  return [];
}

function normalizePoll(raw: any): Poll | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    ...raw,
    options: normalizeOptions(raw.options),
    likes: raw.likes ?? 0,
    dislikes: raw.dislikes ?? 0,
    createdAt: raw.createdAt ?? Date.now(),
    endsAt: raw.endsAt ?? Date.now(),
  } as Poll;
}

export async function createPoll(input: Omit<Poll, 'id' | 'createdAt' | 'options'> & { options: string[] }) {
  const node = push(ref(db, 'polls'));
  const options: PollOption[] = input.options.filter(Boolean).map((t) => ({ id: rid('o_'), text: t, votes: 0 }));
  const poll: Poll = {
    id: node.key!,
    uid: input.uid,
    authorName: input.authorName,
    question: input.question,
    options,
    openEnded: input.openEnded,
    createdAt: Date.now(),
    endsAt: input.endsAt,
    likes: 0, dislikes: 0,
    lat: input.lat, lng: input.lng,
  };
  await set(node, poll);
  await set(ref(db, `userPolls/${input.uid}/${poll.id}`), poll.createdAt);
  return poll;
}

export function listenPollFeed(cb: (items: Poll[]) => void) {
  return onValue(query(ref(db, 'polls'), orderByChild('createdAt'), limitToLast(40)), (snap) => {
    const out: Poll[] = [];
    snap.forEach((c) => {
      const p = normalizePoll(c.val());
      if (p) out.push(p);
    });
    out.sort((a, b) => b.createdAt - a.createdAt); cb(out);
  });
}
export function listenPoll(id: string, cb: (p: Poll | null) => void) {
  return onValue(ref(db, `polls/${id}`), (s) => cb(normalizePoll(s.val())));
}

export async function votePoll(pollId: string, uid: string, optionId: string) {
  const voterRef = ref(db, `polls/${pollId}/voters/${uid}`);
  const prev = (await get(voterRef)).val() as string | null;
  if (prev === optionId) return;
  await runTransaction(ref(db, `polls/${pollId}/options`), (opts: PollOption[] | Record<string, PollOption> | null) => {
    const list = normalizeOptions(opts);
    if (!list.length) return list;
    return list.map((o) => {
      let v = o.votes ?? 0;
      if (prev && o.id === prev) v = Math.max(0, v - 1);
      if (o.id === optionId) v += 1;
      return { ...o, votes: v };
    });
  });
  await set(voterRef, optionId);
}

export async function reactPoll(pollId: string, uid: string, kind: 'like' | 'dislike') {
  const voterRef = ref(db, `polls/${pollId}/reactionVoters/${uid}`);
  const prev = (await get(voterRef)).val() as 'like' | 'dislike' | null;
  await runTransaction(ref(db, `polls/${pollId}`), (p: Poll | null) => {
    if (!p) return p;
    p.likes = p.likes ?? 0; p.dislikes = p.dislikes ?? 0;
    if (prev === 'like') p.likes = Math.max(0, p.likes - 1);
    if (prev === 'dislike') p.dislikes = Math.max(0, p.dislikes - 1);
    if (prev !== kind) {
      const k = kind === 'like' ? 'likes' : 'dislikes';
      p[k] = (p[k] ?? 0) + 1;
    }
    return p;
  });
  await set(voterRef, prev === kind ? null : kind);
}

export async function commentPoll(pollId: string, uid: string, name: string, text: string) {
  const n = push(ref(db, `pollComments/${pollId}`));
  await set(n, { id: n.key, uid, name, text, createdAt: Date.now() });
  await runTransaction(ref(db, `polls/${pollId}/commentCount`), (c: number) => (c ?? 0) + 1);
}
export function listenPollComments(pollId: string, cb: (items: any[]) => void) {
  return onValue(ref(db, `pollComments/${pollId}`), (snap) => {
    const out: any[] = []; snap.forEach((c) => { out.push(c.val()); });
    out.sort((a, b) => a.createdAt - b.createdAt); cb(out);
  });
}
