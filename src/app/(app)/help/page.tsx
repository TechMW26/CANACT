'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { listenHelpFeed } from '@/lib/services/help';
import { HelpRequest, HelpStatus } from '@/lib/types';
import { formatDistance, haversineMeters, timeAgo } from '@/lib/utils';
import { ShieldAlert, AlertTriangle, CircleHelp } from '@/components/icons';

const TYPE_COLOR = { red: 'bg-red2', orange: 'bg-orange2', yellow: 'bg-yellow2' } as const;

export default function HelpFeed() {
  const { coords } = useGeo();
  const [items, setItems] = useState<HelpRequest[]>([]);
  const [filter, setFilter] = useState<'all' | HelpStatus>('all');

  useEffect(() => listenHelpFeed(setItems), []);

  const visible = items.filter((h) => filter === 'all' || h.status === filter)
    .filter((h) => {
      if (h.lat == null || h.lng == null || !coords) return true;
      return haversineMeters(coords, { lat: h.lat, lng: h.lng }) <= h.vicinityMeters;
    });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Link href="/help/create?type=red">
          <Button full className="h-14 bg-red2 hover:bg-red2/90 text-white inline-flex items-center justify-center gap-2">
            <ShieldAlert size={20} /> Red
          </Button>
        </Link>
        <Link href="/help/create?type=orange">
          <Button full className="h-14 bg-orange2 hover:bg-orange2/90 text-white inline-flex items-center justify-center gap-2">
            <AlertTriangle size={20} /> Orange
          </Button>
        </Link>
        <Link href="/help/create?type=yellow">
          <Button full className="h-14 bg-yellow2 hover:bg-yellow2/90 text-ink inline-flex items-center justify-center gap-2">
            <CircleHelp size={20} /> Yellow
          </Button>
        </Link>
      </div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {(['all', 'open', 'inProcess', 'closed'] as const).map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`whitespace-nowrap rounded-full px-4 h-9 text-sm font-semibold border ${filter === s ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'}`}>
            {s === 'all' ? 'All' : s === 'inProcess' ? 'In Process' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {visible.length === 0 && <Card className="text-center text-muted">No help requests in your area.</Card>}
      {visible.map((h) => (
        <Link key={h.id} href={`/help/${h.id}`}>
          <Card className="hover:shadow-md transition">
            <div className="flex items-start gap-3">
              <span className={`mt-1 inline-block w-3 h-3 rounded-full ${TYPE_COLOR[h.type]}`} />
              <Avatar src={h.authorPhoto} name={h.authorName} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold truncate">{h.authorName}</span>
                  <RatingPill value={h.authorRating ?? 0} />
                </div>
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
  );
}
