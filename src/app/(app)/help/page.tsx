'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useGeo } from '@/lib/useGeo';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { HelpStatsPills } from '@/components/HelpStatsPills';
import { listenHelpFeed } from '@/lib/services/help';
import { HelpRequest, HelpStatus } from '@/lib/types';
import { formatDistance, haversineMeters, timeAgo } from '@/lib/utils';
import { LifeBuoy } from '@/components/icons';

const TYPE_COLOR = { red: 'bg-red2', orange: 'bg-orange2', yellow: 'bg-yellow2' } as const;
const TYPE_LABEL = { red: 'Red', orange: 'Orange', yellow: 'Yellow' } as const;

type HelpFilter = 'all' | Exclude<HelpStatus, 'closed'> | 'mine';

export default function HelpFeed() {
  const { coords } = useGeo();
  const { user } = useAuth();
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [filter, setFilter] = useState<HelpFilter>('all');

  useEffect(() => listenHelpFeed(setItems), []);

  // The "Mine" tab is the user's own roster — we deliberately bypass the
  // closed/vicinity filters there so they always see every request they've
  // ever raised (including resolved ones), without it polluting the public
  // feeds where users were getting confused between others' and their own.
  const isMine = filter === 'mine';
  const visible = items
    .filter((h) => (isMine ? h.uid === user?.uid : h.uid !== user?.uid && h.status !== 'closed'))
    .filter((h) => isMine || filter === 'all' || h.status === filter)
    .filter((h) => {
      if (isMine) return true;
      if (h.lat == null || h.lng == null || !coords) return true;
      return haversineMeters(coords, { lat: h.lat, lng: h.lng }) <= h.vicinityMeters;
    });

  return (
    <div className="space-y-3">
      {/* Sticky single CTA */}
      <div className="sticky top-[68px] z-20 -mx-4 md:-mx-6 px-4 md:px-6 pt-1 pb-2 bg-candy/85 backdrop-blur-md">
        <Link href="/help/create" className="block">
          <button className="w-full h-12 rounded-full bg-brand text-white font-bold inline-flex items-center justify-center gap-2 shadow-[0_8px_20px_-8px_rgba(200,16,46,0.55)] hover:bg-brand-dark active:scale-[0.99] transition">
            <LifeBuoy size={20} strokeWidth={2.4} /> Request Help
          </button>
        </Link>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {(['all', 'open', 'inProcess', 'mine'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap rounded-full px-4 h-9 text-sm font-semibold border transition ${filter === s ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line hover:border-ink/30'}`}>
            {s === 'all' ? 'All' : s === 'inProcess' ? 'In Process' : s === 'mine' ? 'My Requests' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="pt-2 flex flex-col gap-4">
        {visible.length === 0 && (
          <Card className="text-center text-muted py-10">
            <div className="text-2xl mb-1">{isMine ? '📝' : '🤝'}</div>
            {isMine
              ? "You haven't raised any help requests yet."
              : 'No help requests in your area right now.'}
          </Card>
        )}

        {visible.map((h) => (
          <Link key={h.id} href={`/help/${h.id}`} className="block">
            <Card className="hover:shadow-md transition">
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
  );
}
