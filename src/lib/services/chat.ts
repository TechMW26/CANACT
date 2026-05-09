import { onValue, ref, set, update, push, get, query, orderByChild, runTransaction, remove } from 'firebase/database';
import { db } from '../firebase';
import type { ChatAttachment, ChatMessage, ChatThread } from '../types';
import { sendPush } from './sendPush';

function threadIdFor(a: string, b: string) {
  return [a, b].sort().join('__');
}
export { threadIdFor };

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
  let cancelled = false;
  const unsub = onValue(ref(db, `userThreads/${uid}`), (snap) => {
    const ids: string[] = [];
    snap.forEach((c) => { ids.push(c.key as string); });
    const out: ChatThread[] = [];
    let resolved = 0;
    if (ids.length === 0) { cb([]); return; }
    ids.forEach((id) => {
      get(ref(db, `chatThreads/${id}`)).then((s) => {
        if (cancelled) return;
        const v = s.val() as ChatThread | null;
        if (v) out.push(v);
        resolved += 1;
        if (resolved === ids.length) {
          out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
          cb(out);
        }
      }).catch(() => {
        resolved += 1;
        if (resolved === ids.length) {
          out.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
          cb(out);
        }
      });
    });
  });
  return () => {
    cancelled = true;
    unsub();
  };
}

export async function sendChatMessage(
  threadId: string,
  fromUid: string,
  toUid: string,
  text: string,
  extras?: { replyTo?: ChatMessage['replyTo']; attachment?: ChatAttachment },
) {
  const node = push(ref(db, `chatMessages/${threadId}`));
  const msg: ChatMessage = {
    id: node.key as string,
    fromUid,
    toUid,
    text,
    createdAt: Date.now(),
  };
  if (extras?.replyTo) msg.replyTo = extras.replyTo;
  if (extras?.attachment) msg.attachment = extras.attachment;
  await set(node, msg);
  const previewText = extras?.attachment
    ? extras.attachment.kind === 'post'
      ? '📎 Shared a post'
      : '🎬 Shared a reel'
    : text;
  await update(ref(db, `chatThreads/${threadId}`), {
    lastMessageAt: msg.createdAt,
    lastMessageText: previewText,
  });
  await runTransaction(ref(db, `chatThreads/${threadId}/unread/${toUid}`), (n: number) => (n ?? 0) + 1);

  // Best-effort web push to the recipient. Body is sanitized server-side and
  // emojis stripped per product policy.
  const threadSnap = await get(ref(db, `chatThreads/${threadId}`));
  const thread = threadSnap.val() as ChatThread | null;
  const fromName = thread?.participants?.[fromUid]?.name || 'Someone';
  sendPush({
    toUid,
    title: `New message from ${fromName}`,
    body: previewText,
    url: `/inbox/${fromUid}`,
    tag: `chat:${threadId}`,
  });

  return msg;
}

export async function reactToChatMessage(threadId: string, messageId: string, uid: string, emoji: string | null) {
  const r = ref(db, `chatMessages/${threadId}/${messageId}/reactions/${uid}`);
  if (emoji) await set(r, emoji);
  else await remove(r);
}

export async function editChatMessage(threadId: string, messageId: string, uid: string, text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const r = ref(db, `chatMessages/${threadId}/${messageId}`);
  const snap = await get(r);
  const msg = snap.val() as ChatMessage | null;
  if (!msg || msg.fromUid !== uid || msg.deleted) return;
  await update(r, { text: trimmed, editedAt: Date.now() });
}

export async function deleteChatMessage(threadId: string, messageId: string, uid: string) {
  const r = ref(db, `chatMessages/${threadId}/${messageId}`);
  const snap = await get(r);
  const msg = snap.val() as ChatMessage | null;
  if (!msg || msg.fromUid !== uid) return;
  await update(r, { deleted: true, text: '' });
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
