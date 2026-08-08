'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { ArrowLeft, MessageSquare } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { listenMyThreads } from '@/lib/services/chat';
import type { ChatThread } from '@/lib/types';

export default function InboxPage() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'chats' | 'requests'>('chats');

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    return listenMyThreads(user.uid, (nextThreads) => {
      setThreads(nextThreads);
      setLoading(false);
    });
  }, [user]);

  const filtered = useMemo(() => {
    if (!user) return [];
    return threads.filter((t) => {
      const incoming = t.initiator !== user.uid;
      if (tab === 'requests') return t.status === 'pending' && incoming;
      return t.status === 'accepted' || (t.status === 'pending' && t.initiator === user.uid);
    });
  }, [threads, tab, user]);

  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 pb-8 pt-4">
      <header className="mb-3 flex items-center gap-2 [&_svg]:block [&_svg]:shrink-0">
        <Link href="/feed" aria-label="Back" className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 ring-1 ring-line">
          <ArrowLeft size={22} />
        </Link>
        <div>
          <div className="text-xl font-black tracking-tight text-ink">Inbox</div>
          <div className="text-xs text-ink/55">Direct messages & requests</div>
        </div>
      </header>

      <div className="mb-3 inline-flex rounded-full bg-white/80 p-1 ring-1 ring-line">
        {(['chats', 'requests'] as const).map((k) => {
          // Per-tab counters so the pill itself shows where the
          // attention is needed, not just the global header bubble.
          const count = k === 'chats'
            ? threads.reduce((acc, t) => {
                const incoming = t.initiator !== user.uid;
                if (t.status === 'pending' && incoming) return acc;
                return acc + (t.unread?.[user.uid] ?? 0);
              }, 0)
            : threads.filter((t) => t.status === 'pending' && t.initiator !== user.uid).length;
          const active = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`relative inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-extrabold capitalize ${active ? 'bg-brand text-white' : 'text-ink/70'}`}
            >
              <span>{k}</span>
              {count > 0 && (
                <span className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold leading-none ${active ? 'bg-white text-brand' : 'bg-brand text-white'}`}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="rounded-[28px] bg-white/92 p-2 ring-1 ring-[#E4E7E2]">
        {loading ? (
          <InboxRowsSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquare size={28} className="text-brand" />
            <div className="text-sm font-extrabold text-ink">
              {tab === 'requests' ? 'No requests' : 'No chats yet'}
            </div>
            <div className="max-w-xs text-xs text-ink/55">
              Open someone&apos;s profile and start a conversation.
            </div>
          </div>
        ) : (
          <ul>
            {filtered.map((t) => {
              const otherUid = Object.keys(t.members).find((uid) => uid !== user.uid) ?? '';
              const other = t.participants?.[otherUid];
              const unread = t.unread?.[user.uid] ?? 0;
              return (
                <li key={t.id}>
                  <Link
                    href={`/inbox/${otherUid}`}
                    className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-brand-light/40"
                  >
                    <Avatar src={other?.photoURL ?? null} name={other?.name ?? '?'} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-extrabold text-ink">{other?.name ?? 'User'}</div>
                        {t.status === 'pending' && (
                          <span className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold text-brand">
                            Request
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-ink/60">{t.lastMessageText ?? 'Tap to chat'}</div>
                    </div>
                    {unread > 0 && (
                      <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold text-white">
                        {unread}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function InboxRowsSkeleton() {
  return (
    <div className="space-y-1" aria-label="Loading conversations" aria-busy="true">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex h-[68px] items-center gap-3 rounded-2xl px-3">
          <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-brand-light/70" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className={`h-3 animate-pulse rounded-full bg-brand-light/80 ${row % 2 ? 'w-28' : 'w-36'}`} />
            <div className={`h-2.5 animate-pulse rounded-full bg-candy ${row % 2 ? 'w-40' : 'w-48'}`} />
          </div>
          <div className="h-5 w-5 animate-pulse rounded-full bg-candy" />
        </div>
      ))}
    </div>
  );
}
