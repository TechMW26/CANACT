'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet } from './Sheet';
import { toast } from './Toaster';
import { useAuth } from '@/lib/auth';
import { sendChatMessage, startOrGetThread, threadIdFor } from '@/lib/services/chat';
import { listenFriends } from '@/lib/services/friends';
import type { ChatAttachment, FriendEdge } from '@/lib/types';
import { Check, Loader2, Search, Send, Share2 } from './icons';
import { shareExternal } from '@/lib/shareExternal';

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
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSentTo(new Set());
      setSelected(new Set());
      setQuery('');
      return;
    }
    if (!user) return;
    return listenFriends(user.uid, setFriends);
  }, [open, user?.uid]);

  const filteredFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((friend) => friend.name.toLowerCase().includes(q));
  }, [friends, query]);

  const selectedFriends = useMemo(
    () => friends.filter((friend) => selected.has(friend.uid) && !sentTo.has(friend.uid)),
    [friends, selected, sentTo],
  );

  function toggleFriend(uid: string) {
    if (sentTo.has(uid) || sending) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }

  async function sendOne(friend: FriendEdge) {
    if (!user || !profile || !attachment) return;
    await startOrGetThread(
      { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL },
      { uid: friend.uid, name: friend.name, photoURL: friend.photoURL },
    );
    const id = threadIdFor(user.uid, friend.uid);
    await sendChatMessage(id, user.uid, friend.uid, '', { attachment });
    setSentTo((current) => new Set(current).add(friend.uid));
  }

  async function sendSelected() {
    if (!selectedFriends.length || sending) return;
    setSending(true);
    try {
      for (const friend of selectedFriends) await sendOne(friend);
      toast(selectedFriends.length === 1 ? 'Sent' : `Sent to ${selectedFriends.length} friends`, 'success');
      setSelected(new Set());
    } catch (e: any) {
      toast(e?.message ?? 'Could not send', 'error');
    } finally {
      setSending(false);
    }
  }

  async function shareOutsideCanact() {
    if (!attachment) return;
    const path = attachment.kind === 'post' ? `/post/${attachment.postId}`
      : attachment.kind === 'reel' ? `/reel/${attachment.reelId}`
        : attachment.kind === 'poll' ? `/poll/${attachment.pollId}`
          : attachment.kind === 'rateme' ? `/rateme/${attachment.sessionId}`
            : '';
    if (!path) return toast('This attachment cannot be shared externally.', 'error');
    try {
      const result = await shareExternal({
        title: 'Shared from Canact',
        text: 'See this on Canact',
        url: `${window.location.origin}${path}`,
      });
      if (result === 'copied') toast('Link copied', 'success');
    } catch (error: any) {
      if (error?.name !== 'AbortError') toast(error?.message ?? 'Could not share', 'error');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} topmost>
      <div className="canact-share-sheet mx-auto flex w-full max-w-[360px] flex-col pb-2 text-ink">
        <div className="mb-4 grid grid-cols-[40px_1fr_40px] items-center">
          <span aria-hidden />
          <h2 className="text-center text-[1.25em] font-black tracking-tight">Share</h2>
        </div>

        <label className="mb-4 flex h-11 items-center gap-2 border-b border-line text-ink/70">
          <Search size={20} className="shrink-0" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="min-w-0 flex-1 border-0 bg-transparent text-[0.95em] font-semibold outline-none placeholder:text-ink/35"
          />
        </label>

        {friends.length === 0 ? (
          <div className="py-7 text-center text-sm font-semibold text-ink/55">
            You don&apos;t have any friends yet.
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="py-7 text-center text-sm font-semibold text-ink/55">No friends found.</div>
        ) : (
          <div className="canact-share-grid max-h-[min(44svh,360px)] overflow-y-auto overscroll-contain pb-2 pr-1 [-webkit-overflow-scrolling:touch]">
            {filteredFriends.map((friend) => {
              const isSelected = selected.has(friend.uid);
              const isSent = sentTo.has(friend.uid);
              return (
                <button
                  key={friend.uid}
                  type="button"
                  disabled={sending || isSent}
                  onClick={() => toggleFriend(friend.uid)}
                  className="group min-w-0 rounded-2xl px-1.5 py-1.5 text-center transition active:scale-95 disabled:opacity-60"
                  aria-pressed={isSelected}
                >
                  <span className={`relative mx-auto mb-2 block h-14 w-14 overflow-hidden rounded-full bg-brand-light ring-2 transition ${isSelected ? 'ring-brand' : isSent ? 'ring-emerald-400' : 'ring-transparent'}`}>
                    <Avatar src={friend.photoURL ?? null} name={friend.name} size={56} className="h-full w-full rounded-full" />
                    {(isSelected || isSent) && (
                      <span className={`absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-white ${isSent ? 'bg-emerald-500' : 'bg-brand'}`}>
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="mx-auto block max-w-[76px] truncate text-[0.74em] font-extrabold leading-tight text-ink">{friend.name}</span>
                  {isSent ? <span className="mt-0.5 block text-[0.66em] font-bold text-emerald-600">Sent</span> : null}
                </button>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={sendSelected}
          disabled={!selectedFriends.length || sending}
          className="canact-share-send mx-auto mt-5 inline-flex min-w-36 items-center justify-center gap-2 rounded-2xl bg-brand px-8 py-3.5 text-sm font-black text-white transition active:scale-95 disabled:opacity-45"
        >
          {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          {selectedFriends.length > 1 ? `Send ${selectedFriends.length}` : 'Send'}
        </button>
        <button type="button" onClick={shareOutsideCanact} className="mx-auto mt-2 inline-flex min-w-36 items-center justify-center gap-2 rounded-2xl border border-brand/25 bg-white px-6 py-3 text-sm font-black text-brand">
          <Share2 size={17} /> Share outside Canact
        </button>
      </div>
    </Sheet>
  );
}
