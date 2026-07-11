'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Avatar, RatingPill } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { LeaderScope, listenLeaderboard } from '@/lib/services/leaderboard';
import { UserProfile } from '@/lib/types';
import { Crown, Trophy } from '@/components/icons';

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
    <div className="pb-8 pt-4">
      <header className="mb-6 flex items-end justify-between px-1">
        <div><p className="mb-1 text-[11px] font-extrabold uppercase tracking-[.2em] text-brand">Community impact</p><h1 className="text-[32px] font-black tracking-[-.04em] text-ink">Leaderboard</h1></div>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e7e1d1] text-brand"><Trophy size={24} /></span>
      </header>
      <div className="-mx-2 overflow-x-auto no-scrollbar">
        <div className="flex w-max gap-2 px-2">
          {SCOPES.map((s) => (
            <button key={s.id} onClick={() => setScope(s.id)}
              className={`h-10 shrink-0 whitespace-nowrap rounded-full px-5 text-sm font-bold transition ${scope === s.id ? 'bg-brand text-white' : 'bg-white text-ink/60'}`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <div className="mt-8 rounded-[28px] bg-white px-6 py-12 text-center text-muted">No one to show in this scope yet.</div> : null}

      {rows.length ? (
        <section className="mt-8 grid grid-cols-3 items-end gap-2 rounded-[32px] bg-[linear-gradient(145deg,#e5ded0,#f7f4ec)] px-3 pb-5 pt-7">
          {[rows[1], rows[0], rows[2]].map((u, visualIndex) => {
            if (!u) return <div key={`empty-${visualIndex}`} />;
            const rank = visualIndex === 0 ? 2 : visualIndex === 1 ? 1 : 3;
            return <Link key={u.uid} href={`/profile/${u.uid}`} className={`relative flex flex-col items-center rounded-[24px] bg-white px-2 pb-4 pt-5 text-center ${rank === 1 ? 'min-h-[190px] -translate-y-3' : 'min-h-[160px]'}`}>
              {rank === 1 ? <Crown size={24} className="absolute -top-4 text-[#b48a37]" fill="currentColor" /> : null}
              <span className="mb-3 grid h-7 w-7 place-items-center rounded-full bg-[#1a3d2b] text-xs font-black text-white">{rank}</span>
              <Avatar src={u.photoURL} name={u.fullName} size={rank === 1 ? 66 : 54} />
              <strong className="mt-3 line-clamp-1 text-sm">{u.firstName || u.fullName}</strong>
              <span className="mt-1 text-xs font-extrabold text-brand">{Math.round(u.rating || 0)} pts</span>
            </Link>;
          })}
        </section>
      ) : null}

      <ul className="mt-6 space-y-3">
        {rows.slice(3).map((u, i) => (
          <li key={u.uid}>
            <Link href={`/profile/${u.uid}`}>
              <div className="flex items-center gap-4 rounded-[22px] bg-white p-4">
                <span className="w-7 text-center text-sm font-black text-brand">{i + 4}</span>
                <Avatar src={u.photoURL} name={u.fullName} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-extrabold truncate">{u.fullName}</div>
                  <div className="text-xs text-muted truncate">{[u.city, u.country].filter(Boolean).join(', ')}</div>
                </div>
                <RatingPill value={u.rating ?? 0} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
