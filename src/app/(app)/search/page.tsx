'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Input } from '@/components/Input';
import { searchUsers } from '@/lib/services/leaderboard';
import { UserProfile } from '@/lib/types';

export default function SearchPage() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<UserProfile[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => setRows(await searchUsers(q)), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-3">
      <Input placeholder="Search by name, city, mobile or email" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {q && rows.length === 0 && <Card className="text-center text-muted">No matches.</Card>}
      <ul className="space-y-2">
        {rows.map((u) => (
          <li key={u.uid}>
            <Link href={`/profile/${u.uid}`}>
              <Card className="flex items-center gap-3">
                <Avatar src={u.photoURL} name={u.fullName} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{u.fullName}</div>
                  <div className="text-xs text-muted truncate">{[u.city, u.country].filter(Boolean).join(', ')}</div>
                </div>
                <RatingPill value={u.rating ?? 0} />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
