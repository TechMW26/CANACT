'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGeo } from '@/lib/useGeo';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/Card';
import { Sheet } from '@/components/Sheet';
import { Avatar, RatingPill } from '@/components/Avatar';
import { HelpStatsPills } from '@/components/HelpStatsPills';
import { listenHelpFeed } from '@/lib/services/help';
import { HelpRequest, HelpStatus } from '@/lib/types';
import { formatDistance, haversineMeters, timeAgo } from '@/lib/utils';
import { Check, HeartHandshake, Search, SlidersHorizontal, X } from '@/components/icons';

const TYPE_COLOR = { red: 'bg-red2', orange: 'bg-orange2', yellow: 'bg-yellow2' } as const;
const TYPE_LABEL = { red: 'Red', orange: 'Orange', yellow: 'Yellow' } as const;

type HelpFilter = 'all' | Exclude<HelpStatus, 'closed'> | 'mine';

const HELP_FILTERS: Array<{ id: HelpFilter; label: string; description: string; color: string; tint: string }> = [
  { id: 'all', label: 'All helps', description: 'Every active request around you', color: '#1f6b55', tint: '#e4f2ec' },
  { id: 'open', label: 'Open requests', description: 'Still waiting for someone to help', color: '#d64545', tint: '#fde8e8' },
  { id: 'inProcess', label: 'In process', description: 'Someone is currently helping', color: '#a86b08', tint: '#fff1cf' },
  { id: 'mine', label: 'My requests', description: 'Every help request you posted', color: '#4d67a8', tint: '#e9edfb' },
];

function normalizeSearch(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function fuzzyHelpMatch(request: HelpRequest, rawQuery: string) {
  const query = normalizeSearch(rawQuery);
  if (!query) return true;
  const status = request.status === 'inProcess' ? 'in process being helped' : request.status;
  const haystack = normalizeSearch([
    request.text,
    request.authorName,
    request.type,
    TYPE_LABEL[request.type],
    status,
    request.audience,
    request.channel,
  ].join(' '));
  if (haystack.includes(query)) return true;
  const words = haystack.split(' ').filter(Boolean);
  return query.split(' ').every((token) => words.some((word) => {
    if (word.includes(token) || token.includes(word)) return true;
    if (token.length < 3) return false;
    const tolerance = token.length >= 7 ? 2 : 1;
    return Math.abs(word.length - token.length) <= tolerance && editDistance(token, word) <= tolerance;
  }));
}

export default function HelpFeed() {
  const { coords } = useGeo();
  const { user } = useAuth();
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [filter, setFilter] = useState<HelpFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [requestActionMounted, setRequestActionMounted] = useState(false);

  useEffect(() => listenHelpFeed(setItems), []);
  useEffect(() => { setRequestActionMounted(true); }, []);

  // The "Mine" tab is the user's own roster — we deliberately bypass the
  // closed/vicinity filters there so they always see every request they've
  // ever raised (including resolved ones), without it polluting the public
  // feeds where users were getting confused between others' and their own.
  const isMine = filter === 'mine';
  const visible = useMemo(() => items
    .filter((h) => (isMine ? h.uid === user?.uid : h.uid !== user?.uid && h.status !== 'closed'))
    .filter((h) => isMine || filter === 'all' || h.status === filter)
    .filter((h) => {
      if (isMine) return true;
      if (h.lat == null || h.lng == null || !coords) return true;
      return haversineMeters(coords, { lat: h.lat, lng: h.lng }) <= h.vicinityMeters;
    })
    .filter((h) => fuzzyHelpMatch(h, query)), [coords, filter, isMine, items, query, user?.uid]);
  const activeFilter = HELP_FILTERS.find((item) => item.id === filter) ?? HELP_FILTERS[0];

  return (
    <>
    <div className="space-y-3 px-4 pb-20 pt-4">
      {/* Search and filters */}
      <div className="sticky top-[68px] z-20 -mx-4 px-4 pb-2 pt-1 md:-mx-6 md:px-6">
        <div className="flex items-center gap-2">
          <div className="relative flex h-12 min-w-0 flex-1 items-center rounded-full border border-line bg-white shadow-sm focus-within:border-brand/40 focus-within:ring-2 focus-within:ring-brand/10">
            <label htmlFor="help-request-search" className="sr-only">Search help requests</label>
            <Search size={17} className="ml-4 shrink-0 text-muted" aria-hidden="true" />
            <input
              id="help-request-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search helps"
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm font-semibold text-ink outline-none placeholder:font-medium placeholder:text-muted"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear help search" className="mr-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-line/60">
                <X size={14} />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={`Filter help requests. Current filter: ${activeFilter.label}`}
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-line bg-white text-brand shadow-sm transition active:scale-95"
          >
            <SlidersHorizontal size={18} />
            {filter !== 'all' ? <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-white" style={{ backgroundColor: activeFilter.color }} /> : null}
          </button>

        </div>
      </div>

      <Sheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter help requests">
        <div className="flex flex-col gap-3 pb-3">
          {HELP_FILTERS.map((item) => {
            const selected = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected}
                onClick={() => { setFilter(item.id); setFiltersOpen(false); }}
                className="flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99]"
                style={{
                  backgroundColor: selected ? item.color : item.tint,
                  borderColor: selected ? item.color : `${item.color}30`,
                  color: selected ? '#fff' : item.color,
                }}
              >
                <span className="h-3 w-3 shrink-0 rounded-full bg-current" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm font-black">{item.label}</strong>
                  <small className={`mt-0.5 block text-[11px] font-semibold ${selected ? 'text-white/75' : 'opacity-70'}`}>{item.description}</small>
                </span>
                {selected ? <Check size={18} strokeWidth={3} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </Sheet>

      <div className="pt-2 flex flex-col gap-4">
        {visible.length === 0 && (
          <Card className="text-center text-muted py-10">
            <div className="text-2xl mb-1">{isMine ? '📝' : '🤝'}</div>
            {query.trim()
              ? `No help requests match “${query.trim()}”.`
              : isMine
                ? "You haven't raised any help requests yet."
                : 'No help requests in your area right now.'}
          </Card>
        )}

        {visible.map((h) => (
          <Link key={h.id} href={`/help/${h.id}`} className="block">
            <Card className="transition-colors hover:border-brand-light">
              <div className="flex items-start gap-3">
                <span className={`mt-1 inline-flex items-center justify-center w-3 h-3 rounded-full ${TYPE_COLOR[h.type]}`} aria-label={TYPE_LABEL[h.type]} />
                <Avatar src={h.authorPhoto ?? null} name={h.authorName} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold truncate">{h.authorName}</span>
                    <RatingPill value={h.authorRating ?? 0} />
                  </div>
                  <div className="mt-1"><HelpStatsPills uid={h.uid} compact /></div>
                  <p className="text-sm mt-1 line-clamp-3">{h.text}</p>
                  <div className="mt-1 text-[11px] text-muted flex items-center gap-2 flex-wrap">
                    <span>{timeAgo(h.createdAt)}</span>
                    <span>• {formatDistance(h.vicinityMeters)} radius</span>
                    <span>• {h.audience}</span>
                    <span>• {h.channel}</span>
                    <span className={`ml-auto rounded-full px-2 py-0.5 font-bold ${h.status === 'open' ? 'bg-emerald-100 text-emerald-700' : h.status === 'inProcess' ? 'bg-amber-100 text-amber-700' : 'bg-line text-muted'}`}>
                      {h.status === 'inProcess' ? 'In Process' : h.status[0].toUpperCase() + h.status.slice(1)}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
    {requestActionMounted ? createPortal(
      <Link
        href="/help/create"
        data-canact-help-request-action="true"
        className="fixed bottom-[calc(var(--canact-bottom-nav-height)+12px)] left-1/2 z-[39] inline-flex h-12 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-[#e34d4d] px-5 text-sm font-bold text-white shadow-[0_10px_28px_rgba(151,38,38,0.24)] transition hover:bg-[#c53030] active:scale-[0.99] lg:bottom-6"
      >
        <HeartHandshake size={20} strokeWidth={2.4} /> Request Help
      </Link>,
      document.body,
    ) : null}
    </>
  );
}
