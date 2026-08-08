import { onValue, push, ref, runTransaction, set, get, query, orderByChild, limitToLast, remove } from 'firebase/database';
import { db } from '../firebase';
import { Poll, PollOption } from '../types';
import { uid as rid } from '../utils';
import { recordOnboardingSignal } from './onboarding';
import { dailyActivityClaim, nextContentReactionVersion, recordScoreActivity, recordUniqueAuthorContentFeedback, syncAuthorContentReaction } from './scoreActivity';

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
    photoURL: input.photoURL,
    lqip: input.lqip,
    options,
    openEnded: input.openEnded,
    createdAt: Date.now(),
    endsAt: input.endsAt,
    likes: 0, dislikes: 0,
    lat: input.lat, lng: input.lng,
  };
  await set(node, poll);
  await set(ref(db, `userPolls/${input.uid}/${poll.id}`), poll.createdAt);
  await recordOnboardingSignal(input.uid, 'create-post');
  await recordScoreActivity(input.uid, dailyActivityClaim('create:poll'));
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
  let rejectReason: string | null = null;
  const result = await runTransaction(ref(db, `polls/${pollId}`), (poll: Poll | null) => {
    rejectReason = null;
    if (!poll) { rejectReason = 'Poll not found'; return; }
    if (poll.endsAt <= Date.now()) { rejectReason = 'Poll has ended'; return; }
    if (poll.voters?.[uid]) { rejectReason = 'You have already voted'; return; }
    const list = normalizeOptions(poll.options);
    if (!list.length || poll.openEnded) { rejectReason = 'Poll has no options'; return; }
    if (!list.some((option) => option.id === optionId)) { rejectReason = 'Invalid option'; return; }
    poll.options = list.map((option) => ({
      ...option,
      votes: (option.votes ?? 0) + (option.id === optionId ? 1 : 0),
    }));
    poll.voters = poll.voters ?? {};
    poll.voters[uid] = optionId;
    return poll;
  });
  if (!result.committed) throw new Error(rejectReason ?? 'Could not vote');
  // T4: Vote counts as a like-equivalent for the poll author
  try {
    const pollSnap = await get(ref(db, `polls/${pollId}`));
    const authorUid = (pollSnap.val() as Poll | null)?.uid;
    if (authorUid && authorUid !== uid) {
      await recordOnboardingSignal(uid, 'engage-post');
      await recordUniqueAuthorContentFeedback(authorUid, uid, `poll:${pollId}:vote`);
      await recordScoreActivity(uid, `poll:${pollId}:vote`);
    }
  } catch { /* non-fatal */ }
}

export async function reactPoll(pollId: string, uid: string, kind: 'like' | 'dislike') {
  const reactionVersion = nextContentReactionVersion();
  let previous: 'like' | 'dislike' | null = null;
  const result = await runTransaction(ref(db, `polls/${pollId}`), (p: Poll | null) => {
    if (!p) return p;
    p.likes = p.likes ?? 0; p.dislikes = p.dislikes ?? 0;
    p.reactionVoters = p.reactionVoters ?? {};
    previous = p.reactionVoters[uid] ?? null;
    if (previous === 'like') p.likes = Math.max(0, p.likes - 1);
    if (previous === 'dislike') p.dislikes = Math.max(0, p.dislikes - 1);
    if (previous !== kind) {
      const k = kind === 'like' ? 'likes' : 'dislikes';
      p[k] = (p[k] ?? 0) + 1;
      p.reactionVoters[uid] = kind;
    } else {
      delete p.reactionVoters[uid];
    }
    return p;
  });
  if (!result.committed) throw new Error('Poll not found');
  const poll = result.snapshot.val() as Poll;
  const authorUid = poll.uid;
  const next = previous === kind ? null : kind;

  // T4: Wire reaction to author's content score
  if (authorUid && authorUid !== uid) {
    await syncAuthorContentReaction(authorUid, uid, `poll:${pollId}:reaction`, previous, next, reactionVersion);
  }

  // T4: Voter engagement reward
  if (authorUid && uid !== authorUid && next) {
    await Promise.all([
      recordScoreActivity(uid, `poll:${pollId}:reaction`),
      recordOnboardingSignal(uid, 'engage-post'),
    ]);
  }
}

export async function commentPoll(pollId: string, uid: string, name: string, text: string) {
  const n = push(ref(db, `pollComments/${pollId}`));
  await set(n, { id: n.key, uid, name, text, createdAt: Date.now() });
  await runTransaction(ref(db, `polls/${pollId}/commentCount`), (c: number) => (c ?? 0) + 1);
  // T4: Comment counts as like-equivalent for poll author + voter engagement
  try {
    const pollSnap = await get(ref(db, `polls/${pollId}`));
    const authorUid = (pollSnap.val() as Poll | null)?.uid;
    if (authorUid && authorUid !== uid) {
      await recordOnboardingSignal(uid, 'engage-post');
      await Promise.all([
        recordScoreActivity(uid, `poll:${pollId}:comment`),
        recordUniqueAuthorContentFeedback(authorUid, uid, `poll:${pollId}:comment`),
      ]);
    }
  } catch { /* non-fatal */ }
}
export function listenPollComments(pollId: string, cb: (items: any[]) => void) {
  return onValue(ref(db, `pollComments/${pollId}`), (snap) => {
    const out: any[] = []; snap.forEach((c) => { out.push(c.val()); });
    out.sort((a, b) => a.createdAt - b.createdAt); cb(out);
  });
}

/** Stream the polls authored by a single user, newest first. */
export function listenUserPolls(authorUid: string, cb: (items: Poll[]) => void) {
  return onValue(ref(db, `userPolls/${authorUid}`), async (snap) => {
    const ids: string[] = [];
    snap.forEach((c) => { if (c.key) ids.push(c.key); });
    if (ids.length === 0) { cb([]); return; }
    const polls = await Promise.all(ids.map((id) => get(ref(db, `polls/${id}`)).then((s) => normalizePoll(s.val()))));
    const out = polls.filter((p): p is Poll => !!p).sort((a, b) => b.createdAt - a.createdAt);
    cb(out);
  });
}

/** Owner-only delete: removes the poll, the user-poll index entry, and any
 *  comments. We don't enforce ownership here \u2014 the caller does. */
export async function deletePoll(pollId: string, authorUid: string) {
  await Promise.all([
    remove(ref(db, `polls/${pollId}`)),
    remove(ref(db, `userPolls/${authorUid}/${pollId}`)),
    remove(ref(db, `pollComments/${pollId}`)),
  ]);
}
