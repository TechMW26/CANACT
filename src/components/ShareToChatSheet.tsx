'use client';
import { useEffect, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import { useAuth } from '@/lib/auth';
import { sendChatMessage, startOrGetThread, threadIdFor } from '@/lib/services/chat';
import { listenFriends } from '@/lib/services/friends';
import type { ChatAttachment, FriendEdge } from '@/lib/types';
import { Send } from './icons';

/**
 * Bottom-sheet picker for sharing a post or reel to a friend (mutual accepted
 * connection). Friends-only: ensures the recipient has explicitly accepted you.
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
  const [friends, setFriends] = useState<FriendEdge[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) { setSentTo(new Set()); return; }
    if (!user) return;
    return listenFriends(user.uid, setFriends);
  }, [open, user?.uid]);

  async function shareTo(friend: FriendEdge) {
    if (!user || !profile || !attachment) return;
    setSending(friend.uid);
    try {
      await startOrGetThread(
        { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL },
        { uid: friend.uid, name: friend.name, photoURL: friend.photoURL },
      );
      const id = threadIdFor(user.uid, friend.uid);
      await sendChatMessage(id, user.uid, friend.uid, '', { attachment });
      setSentTo((s) => new Set(s).add(friend.uid));
      toast('Sent', 'success');
    } catch (e: any) {
      toast(e?.message ?? 'Could not send', 'error');
    } finally {
      setSending(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Send to friend">
      {friends.length === 0 ? (
        <div className="py-8 text-center text-sm text-ink/55">
          You don&apos;t have any friends yet. Send a friend request from someone&apos;s profile to share with them.
        </div>
      ) : (
        <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
          {friends.map((f) => {
            const isSent = sentTo.has(f.uid);
            return (
              <li key={f.uid} className="flex items-center gap-3 py-2.5">
                <Avatar src={f.photoURL ?? null} name={f.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-ink">{f.name}</div>
                  <div className="text-[11px] text-ink/55">Friend</div>
                </div>
                <button
                  type="button"
                  disabled={!!sending || isSent}
                  onClick={() => shareTo(f)}
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
