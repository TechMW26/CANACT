'use client';
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import { listenMyThreads } from './services/chat';

/**
 * Single source of truth for the two counters that drive every inbox-related
 * badge in the app: total unread messages across accepted threads, and the
 * number of pending incoming chat requests. Mounted independently per
 * component (header, sidebar, inbox page) but each subscription is cheap
 * — RTDB de-dupes the underlying socket frames.
 */
export function useInboxBadges(): { unread: number; requests: number; total: number } {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    if (!user) { setUnread(0); setRequests(0); return; }
    return listenMyThreads(user.uid, (threads) => {
      let u = 0; let r = 0;
      for (const t of threads) {
        const incoming = t.initiator !== user.uid;
        const pending = t.status === 'pending' && incoming;
        if (pending) { r += 1; continue; }
        if (t.status === 'accepted' || (t.status === 'pending' && t.initiator === user.uid)) {
          u += t.unread?.[user.uid] ?? 0;
        }
      }
      setUnread(u);
      setRequests(r);
    });
  }, [user?.uid]);

  return { unread, requests, total: unread + requests };
}
