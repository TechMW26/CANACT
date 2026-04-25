'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { LeaderScope, listenLeaderboard } from '@/lib/services/leaderboard';
import { UserProfile } from '@/lib/types';

const SCOPES: { id: LeaderScope; label: string }[] = [
  { id: 'favourites', label: 'Favourites' },
  { id: 'city', label: 'City' },
  { id: 'country', label: 'Country' },
  { id: 'app', label: 'Worldwide' },
];

export default function LeaderboardPage() {
  const { profile } = useAuth();
  const [scope, setScope] = useState<LeaderScope>('city');
  const [rows, setRows] = useState<UserProfile[]>([]);
  useEffect(() => listenLeaderboard(scope, profile, setRows), [scope, profile]);

  return (
    <div className="space-y-3">
      <div className="-mx-4 overflow-x-auto no-scrollbar md:-mx-6">
        <div className="flex w-max gap-2 px-4 md:px-6">
          {SCOPES.map((s) => (
            <button key={s.id} onClick={() => setScope(s.id)}
              className={`whitespace-nowrap shrink-0 rounded-full px-4 h-9 text-sm font-semibold border ${scope === s.id ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 && <Card className="text-center text-muted">No one to show in this scope yet.</Card>}
      <ul className="space-y-2">
        {rows.map((u, i) => (
          <li key={u.uid}>
            <Link href={`/profile/${u.uid}`}>
              <Card className="flex items-center gap-3">
                <span className="w-7 text-center font-extrabold text-brand">{i + 1}</span>
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
