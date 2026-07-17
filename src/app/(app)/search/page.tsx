'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { RatingPill } from '@/components/Avatar';
import { Search } from '@/components/icons';
import { listenLeaderboard, searchUsers } from '@/lib/services/leaderboard';
import type { UserProfile } from '@/lib/types';

const CARD_HEIGHTS = [158, 200, 220, 200, 180, 170, 160, 210];

function slugFor(user: UserProfile) {
  const source = user.fullName || user.email || user.mobile || 'canact';
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'canact';
}

function roleFor(user: UserProfile) {
  if (user.tags?.[0]) return user.tags[0];
  const location = [user.city, user.country].filter(Boolean).join(', ');
  return location || `${(user.rating ?? 0).toFixed(1)} rated`;
}

function displayNameLines(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [name || 'CANACT User'];
  return [parts[0], parts.slice(1).join(' ')];
}

function SearchUserCard({ user, index }: { user: UserProfile; index: number }) {
  const height = CARD_HEIGHTS[index % CARD_HEIGHTS.length];
  const name = user.fullName || 'CANACT User';
  const lines = displayNameLines(name);
  const handle = `@${slugFor(user)}`;
  const role = roleFor(user);

  return (
    <Link
      href={`/profile/${user.uid}`}
      prefetch
      className="relative block w-full flex-shrink-0 overflow-hidden rounded-3xl bg-[#FFE4E6] active:scale-[0.98] transition"
      style={{ height }}
    >
      {user.photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.photoURL} alt={name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#FFB3B8] via-[#FFE4E6] to-white text-4xl font-black text-[#FF6B7A]">
          {name[0]?.toUpperCase() ?? '?'}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

      <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-0.5 backdrop-blur-sm">
        <span className="max-w-[92px] truncate text-[9px] text-white/90">{handle}</span>
      </div>

      <div className="absolute bottom-2.5 left-3 right-2">
        <div className="text-[15px] font-bold leading-tight text-white">
          {lines.map((line) => <div key={line}>{line}</div>)}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <div className="min-w-0 truncate text-[10px] text-white/70">{role}</div>
          <span className="shrink-0 rounded-full bg-white/90 px-1.5 py-0.5">
            <RatingPill value={user.rating ?? 0} />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [discoverRows, setDiscoverRows] = useState<UserProfile[]>([]);
  const [searchRows, setSearchRows] = useState<UserProfile[]>([]);
  const [loadingSearch, setLoadingSearch] = useState(false);

  useEffect(() => listenLeaderboard('app', null, (rows) => setDiscoverRows(rows.slice(0, 200))), []);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setSearchRows([]);
      setLoadingSearch(false);
      return;
    }
    setLoadingSearch(true);
    const timer = setTimeout(async () => {
      try {
        setSearchRows(await searchUsers(text));
      } finally {
        setLoadingSearch(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const filters = useMemo(() => {
    const seen = new Set<string>();
    const dynamic = discoverRows.flatMap((user) => [user.tags?.[0], user.city, user.country])
      .filter((item): item is string => !!item && item.trim().length > 0)
      .filter((item) => {
        const key = item.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);
    return ['All', ...dynamic];
  }, [discoverRows]);

  const visibleRows = useMemo(() => {
    const base = query.trim() ? searchRows : discoverRows;
    if (activeFilter === 'All') return base;
    const needle = activeFilter.toLowerCase();
    return base.filter((user) => [user.tags?.[0], user.city, user.country]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase() === needle));
  }, [activeFilter, discoverRows, query, searchRows]);

  const leftCol = visibleRows.filter((_, index) => index % 2 === 0);
  const rightCol = visibleRows.filter((_, index) => index % 2 === 1);

  return (
    <div className="relative left-1/2 min-h-[var(--canact-viewport-height)] w-screen -translate-x-1/2 bg-[#FAF8F2] lg:left-auto lg:w-full lg:translate-x-0">
      <div className="bg-[#FAF8F2]">
        <div className="relative z-10 bg-[#FAF8F2] px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 rounded-2xl bg-[#F5F5F5] px-3 py-2.5">
              <Search size={14} className="shrink-0 text-neutral-400" />
              <input
                type="text"
                placeholder="Start Search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-700 outline-none placeholder:text-neutral-400"
              />
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 no-scrollbar">
            {filters.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className="shrink-0 rounded-full px-3.5 py-1.5 text-xs transition-all"
                style={{
                  background: activeFilter === filter ? '#FF6B7A' : '#F5F5F5',
                  color: activeFilter === filter ? '#fff' : '#555',
                  fontWeight: activeFilter === filter ? 600 : 400,
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="px-3 pb-6">
          {query.trim() && !loadingSearch && visibleRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#FFE4E6] px-6 py-12 text-center text-sm text-neutral-500">
              No matches.
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="animate-pulse rounded-3xl bg-[#F5F5F5]" style={{ height: CARD_HEIGHTS[index % CARD_HEIGHTS.length] }} />
              ))}
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-3">
                {leftCol.map((user, index) => <SearchUserCard key={user.uid} user={user} index={index * 2} />)}
              </div>
              <div className="flex flex-1 flex-col gap-3">
                {rightCol.map((user, index) => <SearchUserCard key={user.uid} user={user} index={index * 2 + 1} />)}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
