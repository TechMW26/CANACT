'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { listenNotifications, markRead } from '@/lib/services/notifications';
import { NotificationItem } from '@/lib/types';
import { timeAgo } from '@/lib/utils';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  useEffect(() => { if (user) return listenNotifications(user.uid, setItems); }, [user?.uid]);
  if (!user) return null;
  return (
    <div className="divide-y divide-[#E4E7E2] px-4 pt-2">
      {items.length === 0 && <div className="py-12 text-center text-muted">No notifications yet.</div>}
      {items.map((n) => {
        const href = (() => {
          const d = n.data;
          // Explicit URL provided by the server
          if (typeof d?.url === 'string') return d.url;
          // Help request
          if (n.kind === 'help' && d?.helpId) return `/help/${d.helpId}`;
          // Follow / favourites request
          if (n.kind === 'follow' && d?.fromUid) return `/profile/${d.fromUid}`;
          // Connection card gift
          if (n.kind === 'gift' && d?.fromUid) return `/profile/${d.fromUid}`;
          // Profile reaction — open own profile
          if (n.kind === 'react' && !d?.url && !d?.helpId && !d?.fromUid) return '/profile';
          // Fallback
          return '/notifications';
        })();
        const accent = n.read ? 'border-l-[#E4E7E2]' : 'border-l-brand';
        return (
          <Link
            key={n.id}
            href={href}
            onClick={() => markRead(user.uid, n.id)}
            className={`block border-l-[3px] py-3.5 pl-4 pr-1 transition active:bg-[#f5f5f5] ${accent} ${n.read ? 'opacity-60' : ''}`}
          >
            <div className="text-[14px] font-semibold leading-snug text-ink">{n.title}</div>
            {n.body && <div className="mt-0.5 text-[12px] leading-snug text-muted">{n.body}</div>}
            <div className="mt-1.5 text-[11px] font-medium text-ink/40">{timeAgo(n.createdAt)}</div>
          </Link>
        );
      })}
    </div>
  );
}
