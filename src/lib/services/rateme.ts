import { get, onValue, push, ref, remove, runTransaction, set, update, query, orderByChild, limitToLast } from 'firebase/database';
import { db } from '../firebase';
import { RateMeSession } from '../types';

export async function startRateMe(input: { uid: string; authorName: string; photoURL?: string; hours: number }) {
  const node = push(ref(db, 'ratemeSessions'));
  const session: RateMeSession = {
    id: node.key!,
    uid: input.uid,
    authorName: input.authorName,
    photoURL: input.photoURL,
    startedAt: Date.now(),
    endsAt: Date.now() + Math.min(24, Math.max(1, input.hours)) * 3600 * 1000,
    likes: 0, dislikes: 0,
  };
  await set(node, session);
  await update(ref(db, `users/${input.uid}`), { rateMeOn: true, rateMeUntil: session.endsAt });
  return session;
}

export async function stopRateMe(uid: string, sessionId: string) {
  await update(ref(db, `ratemeSessions/${sessionId}`), { endsAt: Date.now() });
  await update(ref(db, `users/${uid}`), { rateMeOn: false, rateMeUntil: 0 });
}

export async function deleteRateMeSession(sessionId: string, authorUid: string) {
  const [sessionSnap, userSnap] = await Promise.all([
    get(ref(db, `ratemeSessions/${sessionId}`)),
    get(ref(db, `users/${authorUid}`)),
  ]);
  const session = sessionSnap.val() as RateMeSession | null;
  const currentUntil = Number(userSnap.val()?.rateMeUntil ?? 0);
  const shouldClearProfileFlag = !session || currentUntil <= (session.endsAt ?? 0);

  await Promise.all([
    remove(ref(db, `ratemeSessions/${sessionId}`)),
    remove(ref(db, `ratemeComments/${sessionId}`)),
    shouldClearProfileFlag ? update(ref(db, `users/${authorUid}`), { rateMeOn: false, rateMeUntil: 0 }) : Promise.resolve(),
  ]);
}

export function listenActiveRateMe(cb: (items: RateMeSession[]) => void) {
  // We keep ended sessions in the wall (and on the author's profile) so
  // friends can see the final tally. Cap how far back we look (7 days)
  // so the wall doesn't accumulate stale Rate Me cards forever.
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  return onValue(query(ref(db, 'ratemeSessions'), orderByChild('endsAt'), limitToLast(40)), (snap) => {
    const out: RateMeSession[] = [];
    const now = Date.now();
    snap.forEach((c) => {
      const v = c.val() as RateMeSession;
      // Active OR recently-ended (within window) — both surface in the feed.
      if (v.endsAt > now || (v.endsAt && now - v.endsAt < RECENT_WINDOW_MS)) {
        out.push(v);
      }
    });
    // Active first (ascending end time → "ending soonest" up top), then
    // ended sessions descending by end time so newest results lead.
    out.sort((a, b) => {
      const aEnded = a.endsAt <= now ? 1 : 0;
      const bEnded = b.endsAt <= now ? 1 : 0;
      if (aEnded !== bEnded) return aEnded - bEnded;
      return aEnded ? b.endsAt - a.endsAt : a.endsAt - b.endsAt;
    });
    cb(out);
  });
}

export function listenRateMeSession(sessionId: string, cb: (item: RateMeSession | null) => void) {
  return onValue(ref(db, `ratemeSessions/${sessionId}`), (snap) => cb(snap.val() as RateMeSession | null));
}

/**
 * Subscribe to a single user's Rate Me sessions (active + recently
 * ended) so we can surface them on their profile alongside posts. We
 * scan the full session list and filter client-side rather than rely on
 * a server-side query because RTDB only allows one orderBy per query.
 */
export function listenUserRateMe(uid: string, cb: (items: RateMeSession[]) => void) {
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  return onValue(query(ref(db, 'ratemeSessions'), orderByChild('endsAt'), limitToLast(80)), (snap) => {
    const out: RateMeSession[] = [];
    const now = Date.now();
    snap.forEach((c) => {
      const v = c.val() as RateMeSession;
      if (v.uid !== uid) return;
      if (v.endsAt > now || (v.endsAt && now - v.endsAt < RECENT_WINDOW_MS)) {
        out.push(v);
      }
    });
    out.sort((a, b) => b.endsAt - a.endsAt);
    cb(out);
  });
}

export async function voteRateMe(sessionId: string, voterUid: string, kind: 'like' | 'dislike') {
  let rejectReason: string | null = null;
  const result = await runTransaction(ref(db, `ratemeSessions/${sessionId}`), (s: RateMeSession | null) => {
    rejectReason = null;
    if (!s) { rejectReason = 'Session not found'; return; }
    if (s.uid === voterUid) { rejectReason = 'Cannot vote on your own session'; return; }
    if (s.endsAt <= Date.now()) { rejectReason = 'Voting has ended'; return; }
    if (s.votes?.[voterUid]) { rejectReason = 'You have already voted'; return; }
    s.likes = s.likes ?? 0;
    s.dislikes = s.dislikes ?? 0;
    s.votes = s.votes ?? {};
    s.votes[voterUid] = kind;
    s[kind === 'like' ? 'likes' : 'dislikes'] += 1;
    return s;
  });
  if (!result.committed) throw new Error(rejectReason ?? 'Could not vote');
}

export async function commentRateMe(sessionId: string, uid: string, name: string, text: string) {
  const node = push(ref(db, `ratemeComments/${sessionId}`));
  await set(node, { id: node.key, uid, name, text, createdAt: Date.now() });
  await runTransaction(ref(db, `ratemeSessions/${sessionId}/commentCount`), (count: number) => (count ?? 0) + 1);
}

export function listenRateMeComments(sessionId: string, cb: (items: any[]) => void) {
  return onValue(ref(db, `ratemeComments/${sessionId}`), (snap) => {
    const out: any[] = [];
    snap.forEach((child) => { out.push(child.val()); });
    out.sort((a, b) => a.createdAt - b.createdAt);
    cb(out);
  });
}
