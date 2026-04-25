'use client';
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import { useAuth } from '@/lib/auth';
import { listenMyThreads, sendChatMessage, startOrGetThread, threadIdFor } from '@/lib/services/chat';
import type { ChatAttachment, ChatThread } from '@/lib/types';
import { Send } from './icons';

/**
 * Bottom-sheet picker for sharing a post or reel to one of your existing
 * Canact chats. Shows accepted threads with a "Send" button per row.
 */
export function ShareToChatSheet({
  open,
  onClose,
  attachment,
}: {
  open: boolean;
  onClose: () => void;
  attachment: ChatAttachment | null;
}) {
  const { user, profile } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) { setSentTo(new Set()); return; }
    if (!user) return;
    return listenMyThreads(user.uid, setThreads);
  }, [open, user]);

  const visible = threads.filter((t) => t.status === 'accepted' || t.initiator === user?.uid);

  async function shareTo(t: ChatThread) {
    if (!user || !profile || !attachment) return;
    const otherUid = Object.keys(t.members).find((u) => u !== user.uid);
    if (!otherUid) return;
    setSending(t.id);
    try {
      const other = t.participants?.[otherUid];
      await startOrGetThread(
        { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL },
        { uid: otherUid, name: other?.name ?? 'User', photoURL: other?.photoURL },
      );
      const id = threadIdFor(user.uid, otherUid);
      await sendChatMessage(id, user.uid, otherUid, '', { attachment });
      setSentTo((s) => new Set(s).add(t.id));
      toast('Sent', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not send', 'error');
    } finally {
      setSending(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Send to">
      {visible.length === 0 ? (
        <div className="py-8 text-center text-sm text-ink/55">
          You don&apos;t have any chats yet. Start a conversation from someone&apos;s profile.
        </div>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
          {visible.map((t) => {
            const otherUid = Object.keys(t.members).find((u) => u !== user?.uid) ?? '';
            const other = t.participants?.[otherUid];
            const isSent = sentTo.has(t.id);
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <Avatar src={other?.photoURL ?? null} name={other?.name ?? '?'} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-ink">{other?.name ?? 'User'}</div>
                  <div className="text-[11px] text-ink/55">Direct message</div>
                </div>
                <button
                  type="button"
                  disabled={!!sending || isSent}
                  onClick={() => shareTo(t)}
                  className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-extrabold ${
                    isSent ? 'bg-brand-light text-brand' : 'bg-brand text-white'
                  } disabled:opacity-50`}
                >
                  {isSent ? 'Sent' : <><Send size={12} /> Send</>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
