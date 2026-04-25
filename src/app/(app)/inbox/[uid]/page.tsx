'use client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { ArrowLeft, Send } from '@/components/icons';
import { toast } from '@/components/Toaster';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { get, ref } from 'firebase/database';
import {
  listenMessages,
  listenThread,
  markThreadRead,
  sendChatMessage,
  setThreadStatus,
  startOrGetThread,
  threadIdFor,
} from '@/lib/services/chat';
import type { ChatMessage, ChatThread, UserProfile } from '@/lib/types';

export default function InboxThreadPage() {
  const { user, profile } = useAuth();
  const params = useParams<{ uid: string }>();
  const router = useRouter();
  const otherUid = params?.uid as string;

  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [other, setOther] = useState<UserProfile | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
  }, [messages.length]);

  if (!user || !profile) return null;

  const incomingPending = thread?.status === 'pending' && thread.initiator !== user.uid;
  const outgoingPending = thread?.status === 'pending' && thread.initiator === user.uid;
  const canSend = thread?.status === 'accepted' || (thread?.status === 'pending' && thread.initiator === user.uid && messages.length === 0);

  return (
    <div className="mx-auto flex h-[calc(100vh-220px)] max-w-2xl flex-col">
      <header className="mb-3 flex items-center gap-2">
        <Link href="/inbox" aria-label="Back" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line shadow-sm">
          <ArrowLeft size={18} />
        </Link>
        <Avatar src={other?.photoURL ?? null} name={other?.fullName ?? '?'} size={36} />
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold text-ink">{other?.fullName ?? 'User'}</div>
          <div className="text-[11px] text-ink/55">{thread?.status === 'pending' ? 'Pending request' : 'Direct message'}</div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-[24px] bg-white/92 p-3 ring-1 ring-[#F1D7DC]">
        {incomingPending && (
          <div className="mb-3 rounded-2xl bg-brand-light/60 p-3 text-center text-sm">
            <div className="font-extrabold text-ink">Chat request</div>
            <div className="mt-1 text-ink/70">Accept to start chatting.</div>
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={async () => {
                  if (!thread) return;
                  await setThreadStatus(thread.id, 'accepted');
                }}
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
          <div className="mb-3 rounded-2xl bg-candy p-3 text-center text-xs text-ink/60">
            Send your first message — it&apos;ll go as a chat request.
          </div>
        )}

        <ul className="space-y-2">
          {messages.map((m) => {
            const mine = m.fromUid === user.uid;
            return (
              <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand text-white' : 'bg-brand-light/60 text-ink'}`}>
                  {m.text}
                </div>
              </li>
            );
          })}
          {messages.length === 0 && !incomingPending && (
            <li className="py-8 text-center text-xs text-ink/45">No messages yet — say hi.</li>
          )}
        </ul>
      </div>

      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!thread || !text.trim() || !canSend) {
            if (!canSend) toast('Wait for them to accept the request', 'error');
            return;
          }
          setBusy(true);
          try {
            await sendChatMessage(thread.id, user.uid, otherUid, text.trim());
            setText('');
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={canSend ? 'Message…' : 'Awaiting acceptance'}
          disabled={!canSend || busy}
          className="flex-1 rounded-full border border-line bg-white px-4 py-3 text-sm shadow-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={!canSend || busy || !text.trim()}
          aria-label="Send"
          className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand text-white disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
