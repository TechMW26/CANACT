import { onValue, push, ref, runTransaction, set, update, get, query, orderByChild, limitToLast } from 'firebase/database';
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

export function listenActiveRateMe(cb: (items: RateMeSession[]) => void) {
  return onValue(query(ref(db, 'ratemeSessions'), orderByChild('endsAt'), limitToLast(40)), (snap) => {
    const out: RateMeSession[] = []; snap.forEach((c) => { const v = c.val() as RateMeSession; if (v.endsAt > Date.now()) out.push(v); });
    out.sort((a, b) => a.endsAt - b.endsAt); cb(out);
  });
}

export async function voteRateMe(sessionId: string, voterUid: string, kind: 'like' | 'dislike') {
  const sessSnap = await get(ref(db, `ratemeSessions/${sessionId}`));
  const sess = sessSnap.val() as RateMeSession | null;
  if (!sess) throw new Error('Session not found');
  if (sess.uid === voterUid) throw new Error('Cannot vote on your own session');
  const voterRef = ref(db, `ratemeSessions/${sessionId}/votes/${voterUid}`);
  const prev = (await get(voterRef)).val() as 'like' | 'dislike' | null;
  if (prev === kind) return;
  await runTransaction(ref(db, `ratemeSessions/${sessionId}`), (s: RateMeSession | null) => {
    if (!s) return s;
    s.likes = s.likes ?? 0; s.dislikes = s.dislikes ?? 0;
    if (prev === 'like') s.likes = Math.max(0, s.likes - 1);
    if (prev === 'dislike') s.dislikes = Math.max(0, s.dislikes - 1);
    s[kind === 'like' ? 'likes' : 'dislikes'] += 1;
    return s;
  });
  await set(voterRef, kind);
}
