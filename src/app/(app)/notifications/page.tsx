'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
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
    <div className="space-y-2 pt-4">
      {items.length === 0 && <Card className="text-center text-muted">No notifications yet.</Card>}
      {items.map((n) => {
        const href = typeof n.data?.url === 'string'
          ? n.data.url
          : n.kind === 'help' ? `/help/${n.data?.helpId}`
            : n.kind === 'follow' ? `/profile/${n.data?.fromUid}`
              : '/notifications';
        return (
          <Link key={n.id} href={href} onClick={() => markRead(user.uid, n.id)}>
            <Card className={`border-l-4 ${n.read ? 'border-line opacity-70' : 'border-brand'}`}>
              <div className="font-bold">{n.title}</div>
              {n.body && <div className="text-sm text-muted mt-0.5">{n.body}</div>}
              <div className="text-[11px] text-subtle mt-1">{timeAgo(n.createdAt)}</div>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}
