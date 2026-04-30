'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { useAuth } from './auth';
import { db } from './firebase';
import type { ChatThread } from './types';

/**
 * Single source of truth for the two counters that drive every inbox-related
 * badge in the app:
 *   - `unread`   total unread messages across accepted (or self-initiated
 *                pending) threads
 *   - `requests` count of pending threads where the current user is the
 *                recipient
 *
 * We can't just use `listenMyThreads()` here because that helper does a
 * one-shot `get()` per thread — so the badge would never update when a new
 * message lands (which only mutates `chatThreads/<id>/unread/<uid>`, not
 * `userThreads/<uid>`). Instead we subscribe to `userThreads/<uid>` for the
 * list of thread ids, and then fan out a live `onValue` subscription for
 * each thread so unread + status changes propagate immediately.
 */
export function useInboxBadges(): { unread: number; requests: number; total: number } {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [requests, setRequests] = useState(0);

  useEffect(() => {
    if (!user) { setUnread(0); setRequests(0); return; }
    const myUid = user.uid;
    // Map of threadId -> latest snapshot. We recompute totals from this map
    // every time any nested listener fires.
    const threads = new Map<string, ChatThread>();
    // Map of threadId -> unsubscribe for the per-thread listener so we can
    // clean up the ones that disappear from `userThreads`.
    const offs = new Map<string, () => void>();

    const recompute = () => {
      let u = 0; let r = 0;
      for (const t of threads.values()) {
        const incoming = t.initiator !== myUid;
        const pending = t.status === 'pending' && incoming;
        if (pending) { r += 1; continue; }
        if (t.status === 'accepted' || (t.status === 'pending' && t.initiator === myUid)) {
          u += t.unread?.[myUid] ?? 0;
        }
      }
      setUnread(u);
      setRequests(r);
    };

    const subscribeThread = (id: string) => {
      if (offs.has(id)) return;
      const stop = onValue(ref(db, `chatThreads/${id}`), (snap) => {
        const v = snap.val() as ChatThread | null;
        if (v) threads.set(id, v); else threads.delete(id);
        recompute();
      });
      offs.set(id, stop);
    };

    const stopList = onValue(ref(db, `userThreads/${myUid}`), (snap) => {
      const ids = new Set<string>();
      snap.forEach((c) => { ids.add(c.key as string); });
      // Add new ids, remove ids that vanished.
      for (const id of ids) subscribeThread(id);
      for (const [id, stop] of offs) {
        if (!ids.has(id)) { stop(); offs.delete(id); threads.delete(id); }
      }
      recompute();
    });

    return () => {
      stopList();
      for (const stop of offs.values()) stop();
      offs.clear();
      threads.clear();
    };
  }, [user?.uid]);

  return { unread, requests, total: unread + requests };
}
