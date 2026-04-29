'use client';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { ArrowLeft, Send, X, CornerUpLeft, Trash2, Pencil, Copy, Phone, Video } from '@/components/icons';
import { Sheet } from '@/components/Sheet';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { get, ref } from 'firebase/database';
import { haptic } from '@/lib/haptics';
import {
  deleteChatMessage,
  editChatMessage,
  listenMessages,
  listenThread,
  markThreadRead,
  reactToChatMessage,
  sendChatMessage,
  setThreadStatus,
  startOrGetThread,
  threadIdFor,
} from '@/lib/services/chat';
import type { ChatAttachment, ChatMessage, ChatThread, UserProfile } from '@/lib/types';
import { MessageBubble, QUICK_REACTIONS } from '@/components/MessageBubble';
import { InAppCallSheet } from '@/components/InAppCallSheet';
import type { CallKind } from '@/lib/services/calls';

export default function InboxThreadPage() {
  const { user, profile } = useAuth();
  const params = useParams<{ uid: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const otherUid = params?.uid as string;

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [other, setOther] = useState<UserProfile | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [actionMsg, setActionMsg] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [editText, setEditText] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [callKind, setCallKind] = useState<CallKind | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Initial attachment provided via deep-link (?sharePostId=… / ?shareReelId=…)
  useEffect(() => {
    if (!search) return;
    const postId = search.get('sharePostId');
    const reelId = search.get('shareReelId');
    if (postId) setPendingAttachment({ kind: 'post', postId });
    else if (reelId) setPendingAttachment({ kind: 'reel', reelId });
  }, [search]);

  useEffect(() => {
    if (!otherUid) return;
    get(ref(db, `users/${otherUid}`)).then((s) => setOther(s.val()));
  }, [otherUid]);

  useEffect(() => {
    if (!user || !profile || !other) return;
    let off: (() => void) | undefined;
    let offMsgs: (() => void) | undefined;
    (async () => {
      await startOrGetThread(
        { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL },
        { uid: other.uid, name: other.fullName, photoURL: other.photoURL },
      );
      const id = threadIdFor(user.uid, other.uid);
      off = listenThread(id, setThread);
      offMsgs = listenMessages(id, setMessages);
      markThreadRead(id, user.uid).catch(() => {});
    })();
    return () => { off?.(); offMsgs?.(); };
  }, [user, profile, other]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, replyTo, pendingAttachment]);

  if (!user || !profile) return null;

  const incomingPending = thread?.status === 'pending' && thread.initiator !== user.uid;
  const outgoingPending = thread?.status === 'pending' && thread.initiator === user.uid;
  const canSend =
    thread?.status === 'accepted' ||
    (thread?.status === 'pending' && thread.initiator === user.uid && messages.length === 0) ||
    !!pendingAttachment;

  function buildReplyTo(m: ChatMessage): ChatMessage['replyTo'] {
    return {
      id: m.id,
      fromUid: m.fromUid,
      text: m.deleted ? 'Deleted message' : m.text || (m.attachment ? (m.attachment.kind === 'post' ? '📎 Post' : '🎬 Reel') : ''),
    };
  }

  async function send() {
    if (!thread || !user) return;
    const t = text.trim();
    if (!t && !pendingAttachment) return;
    if (!canSend) { toast('Wait for them to accept the request', 'error'); return; }
    setBusy(true);
    try {
      await sendChatMessage(thread.id, user.uid, otherUid, t, {
        replyTo: replyTo ? buildReplyTo(replyTo) : undefined,
        attachment: pendingAttachment ?? undefined,
      });
      setText('');
      setReplyTo(null);
      setPendingAttachment(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleReact(m: ChatMessage, emoji: string | null) {
    if (!thread || !user) return;
    haptic('selection');
    await reactToChatMessage(thread.id, m.id, user.uid, emoji);
    setActionMsg(null);
  }

  async function handleDoubleTap(m: ChatMessage) {
    if (!thread || !user) return;
    const current = m.reactions?.[user.uid];
    await reactToChatMessage(thread.id, m.id, user.uid, current === '❤️' ? null : '❤️');
  }

  function startEdit(m: ChatMessage) {
    setEditing(m);
    setEditText(m.text);
    setActionMsg(null);
  }

  async function saveEdit() {
    if (!thread || !editing || !user) return;
    await editChatMessage(thread.id, editing.id, user.uid, editText);
    setEditing(null);
    setEditText('');
  }

  async function handleDelete(m: ChatMessage) {
    if (!thread || !user) return;
    await deleteChatMessage(thread.id, m.id, user.uid);
    setActionMsg(null);
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-candy">
      {/* Header */}
      <header className="safe-top sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-white/95 px-3 py-2 backdrop-blur">
        <button
          type="button"
          onClick={() => router.push('/inbox')}
          aria-label="Back"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-ink hover:bg-brand-light/40"
        >
          <ArrowLeft size={20} />
        </button>
        <Link href={`/profile/${otherUid}`} className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar src={other?.photoURL ?? null} name={other?.fullName ?? '?'} size={38} />
          <div className="min-w-0">
            <div className="truncate text-base font-extrabold text-ink">{other?.fullName ?? 'User'}</div>
            <div className="text-[11px] text-ink/55">
              {thread?.status === 'pending' ? 'Pending request' : 'Active now'}
            </div>
          </div>
        </Link>
        {thread?.status === 'accepted' && other && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { haptic('selection'); setCallKind('audio'); }}
              aria-label="Voice call"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-brand hover:bg-brand-light/40"
            >
              <Phone size={20} />
            </button>
            <button
              type="button"
              onClick={() => { haptic('selection'); setCallKind('video'); }}
              aria-label="Video call"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-brand hover:bg-brand-light/40"
            >
              <Video size={20} />
            </button>
          </div>
        )}
      </header>

      {/* Messages — anchored to bottom */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ overscrollBehavior: 'contain' }}
      >
        <div className="flex min-h-full flex-col justify-end">
        {incomingPending && (
          <div className="mx-auto mb-4 max-w-sm rounded-2xl bg-brand-light/60 p-3 text-center text-sm">
            <div className="font-extrabold text-ink">Chat request</div>
            <div className="mt-1 text-ink/70">Accept to start chatting.</div>
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={async () => { if (thread) await setThreadStatus(thread.id, 'accepted'); }}
                className="rounded-full bg-brand px-4 py-2 text-xs font-extrabold text-white"
              >
                Accept
              </button>
              <button
                onClick={async () => {
                  if (!thread) return;
                  await setThreadStatus(thread.id, 'declined');
                  router.replace('/inbox');
                }}
                className="rounded-full border border-line bg-white px-4 py-2 text-xs font-extrabold text-ink"
              >
                Decline
              </button>
            </div>
          </div>
        )}
        {outgoingPending && messages.length === 0 && (
          <div className="mx-auto mb-4 max-w-sm rounded-2xl bg-candy p-3 text-center text-xs text-ink/60">
            Send your first message — it&apos;ll go as a chat request.
          </div>
        )}

        <ul className="flex flex-col gap-2 pb-2">
          {messages.length === 0 && !incomingPending && (
            <li className="py-12 text-center text-xs text-ink/45">No messages yet — say hi.</li>
          )}
          {messages.map((m, i) => {
            const mine = m.fromUid === user.uid;
            const prev = messages[i - 1];
            const showGap = !prev || (m.createdAt - prev.createdAt) > 5 * 60 * 1000;
            return (
              <li key={m.id} className={showGap ? 'mt-3' : ''}>
                <MessageBubble
                  message={m}
                  mine={mine}
                  myUid={user.uid}
                  onReply={(msg) => { setReplyTo(msg); inputRef.current?.focus(); }}
                  onReact={handleReact}
                  onLongPress={(msg) => setActionMsg(msg)}
                  onDoubleTap={handleDoubleTap}
                />
              </li>
            );
          })}
        </ul>
        </div>
      </div>

      {/* Composer */}
      <div className="safe-bottom border-t border-line bg-white/95 px-3 py-2 backdrop-blur">
        {pendingAttachment && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-line bg-candy px-2 py-1.5 text-xs">
            <span className="font-extrabold text-brand">
              {pendingAttachment.kind === 'post' ? '📎 Sharing a post' : '🎬 Sharing a reel'}
            </span>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-ink/60 hover:bg-brand-light/40"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {replyTo && (
          <div className="mb-2 flex items-start gap-2 rounded-xl border-l-2 border-brand bg-brand-light/40 px-2 py-1.5 text-xs">
            <CornerUpLeft size={14} className="mt-0.5 text-brand" />
            <div className="min-w-0 flex-1">
              <div className="font-extrabold text-brand">
                Replying to {replyTo.fromUid === user.uid ? 'yourself' : other?.fullName ?? 'them'}
              </div>
              <div className="line-clamp-2 text-ink/70">{replyTo.text || 'Attachment'}</div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink/60 hover:bg-brand-light/40"
            >
              <X size={14} />
            </button>
          </div>
        )}
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={canSend ? 'Message…' : 'Awaiting acceptance'}
            disabled={!canSend || busy}
            rows={1}
            className="max-h-32 flex-1 resize-none rounded-3xl border border-line bg-candy px-4 py-2.5 text-sm shadow-sm outline-none focus:border-brand"
          />
          <button
            type="submit"
            disabled={!canSend || busy || (!text.trim() && !pendingAttachment)}
            aria-label="Send"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand text-white disabled:opacity-50"
          >
            <Send size={18} />
          </button>
        </form>
      </div>

      {/* Long-press action sheet */}
      <Sheet open={!!actionMsg} onClose={() => setActionMsg(null)} title="">
        {actionMsg && (
          <div className="space-y-4">
            <div className="rounded-3xl bg-white p-2 shadow-[0_8px_24px_-12px_rgba(10,10,10,0.18)] ring-1 ring-line">
              <div className="flex items-center justify-between gap-1">
                {QUICK_REACTIONS.map((emoji, i) => {
                  const active = actionMsg.reactions?.[user.uid] === emoji;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleReact(actionMsg, active ? null : emoji)}
                      style={{ animationDelay: `${i * 28}ms` }}
                      className={`canact-reaction-pop inline-flex h-12 w-12 items-center justify-center rounded-full text-[26px] leading-none transition active:scale-95 ${
                        active ? 'bg-brand-light scale-110' : 'hover:bg-brand-light/50'
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="space-y-1">
              <ActionRow
                icon={<CornerUpLeft size={18} />}
                label="Reply"
                onClick={() => { setReplyTo(actionMsg); setActionMsg(null); inputRef.current?.focus(); }}
              />
              {actionMsg.text && !actionMsg.deleted && (
                <ActionRow
                  icon={<Copy size={18} />}
                  label="Copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(actionMsg.text).catch(() => {});
                    toast('Copied', 'success');
                    setActionMsg(null);
                  }}
                />
              )}
              {actionMsg.fromUid === user.uid && !actionMsg.deleted && actionMsg.text && (
                <ActionRow icon={<Pencil size={18} />} label="Edit" onClick={() => startEdit(actionMsg)} />
              )}
              {actionMsg.fromUid === user.uid && !actionMsg.deleted && (
                <ActionRow
                  icon={<Trash2 size={18} className="text-brand" />}
                  label="Delete"
                  danger
                  onClick={() => handleDelete(actionMsg)}
                />
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* Edit modal */}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit message">
        <div className="space-y-3">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-2xl border border-line bg-candy px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-full border border-line bg-white px-4 py-2 text-xs font-extrabold text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveEdit}
              className="rounded-full bg-brand px-4 py-2 text-xs font-extrabold text-white"
            >
              Save
            </button>
          </div>
        </div>
      </Sheet>

      {callKind && other && (
        <InAppCallSheet
          open={!!callKind}
          onClose={() => setCallKind(null)}
          me={{ uid: user.uid, name: profile.fullName, photoURL: profile.photoURL ?? undefined }}
          peer={{ uid: other.uid, name: other.fullName, photoURL: other.photoURL ?? undefined }}
          initialKind={callKind}
        />
      )}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-extrabold ${
        danger ? 'text-brand hover:bg-brand-light/40' : 'text-ink hover:bg-brand-light/30'
      }`}
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-candy">{icon}</span>
      {label}
    </button>
  );
}
