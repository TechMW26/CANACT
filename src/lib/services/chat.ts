import { onValue, ref, set, update, push, get, child, query, orderByChild, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import type { ChatMessage, ChatThread } from '../types';

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('__');
}

export async function startOrGetThread(me: { uid: string; name: string; photoURL?: string }, other: { uid: string; name: string; photoURL?: string }) {
  const id = threadIdFor(me.uid, other.uid);
  const r = ref(db, `chatThreads/${id}`);
  const snap = await get(r);
  if (snap.exists()) return snap.val() as ChatThread;
  const thread: ChatThread = {
    id,
    members: { [me.uid]: true, [other.uid]: true },
    initiator: me.uid,
    status: 'pending',
    createdAt: Date.now(),
    lastMessageAt: Date.now(),
    participants: {
      [me.uid]: { uid: me.uid, name: me.name, photoURL: me.photoURL },
      [other.uid]: { uid: other.uid, name: other.name, photoURL: other.photoURL },
    },
  };
  await set(r, thread);
  await update(ref(db, `userThreads/${me.uid}/${id}`), { id, at: Date.now() });
  await update(ref(db, `userThreads/${other.uid}/${id}`), { id, at: Date.now() });
  return thread;
}

export async function setThreadStatus(threadId: string, status: 'accepted' | 'declined') {
  await update(ref(db, `chatThreads/${threadId}`), { status });
}

export function listenThread(threadId: string, cb: (t: ChatThread | null) => void) {
  return onValue(ref(db, `chatThreads/${threadId}`), (snap) => cb(snap.val()));
}

export function listenMyThreads(uid: string, cb: (threads: ChatThread[]) => void) {
  return onValue(ref(db, `userThreads/${uid}`), async (snap) => {
    const ids: string[] = [];
    snap.forEach((c) => { ids.push(c.key as string); });
    const out: ChatThread[] = [];
    await Promise.all(ids.map(async (id) => {
      const s = await get(ref(db, `chatThreads/${id}`));
      const v = s.val() as ChatThread | null;
      if (v) out.push(v);
    }));
    out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    cb(out);
  });
}

export async function sendChatMessage(threadId: string, fromUid: string, toUid: string, text: string) {
  const node = push(ref(db, `chatMessages/${threadId}`));
  const msg: ChatMessage = {
    id: node.key as string,
    fromUid,
    toUid,
    text,
    createdAt: Date.now(),
  };
  await set(node, msg);
  await update(ref(db, `chatThreads/${threadId}`), {
    lastMessageAt: msg.createdAt,
    lastMessageText: text,
  });
  await runTransaction(ref(db, `chatThreads/${threadId}/unread/${toUid}`), (n: number) => (n ?? 0) + 1);
  return msg;
}

export async function markThreadRead(threadId: string, uid: string) {
  await set(ref(db, `chatThreads/${threadId}/unread/${uid}`), 0);
}

export function listenMessages(threadId: string, cb: (messages: ChatMessage[]) => void) {
  const r = query(ref(db, `chatMessages/${threadId}`), orderByChild('createdAt'));
  return onValue(r, (snap) => {
    const out: ChatMessage[] = [];
    snap.forEach((c) => { out.push(c.val() as ChatMessage); });
    out.sort((a, b) => a.createdAt - b.createdAt);
    cb(out);
  });
}

export { threadIdFor };
