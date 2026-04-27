'use client';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';
import type { UserProfile } from '@/lib/types';
import { LifeBuoy, ThumbsUp, Users } from './icons';

/**
 * Compact pills showing a user's help track record:
 *  • Asked = total help requests posted
 *  • Resolved = times their offer was confirmed and closed as resolved
 *  • Offered = total offers extended
 * Subscribes to `users/{uid}` so the values stay live without parent plumbing.
 */
export function HelpStatsPills({ uid, compact }: { uid: string; compact?: boolean }) {
  const [stats, setStats] = useState<UserProfile['helpStats']>(undefined);
  useEffect(() => onValue(ref(db, `users/${uid}/helpStats`), (s) => setStats(s.val() ?? undefined)), [uid]);
  const asked = stats?.asked ?? 0;
  const resolved = stats?.resolved ?? 0;
  const offered = stats?.offered ?? 0;
  const size = compact ? 'text-[10px] px-2 py-0.5 gap-1' : 'text-[11px] px-2.5 py-1 gap-1';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={`inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 font-bold ${size}`}>
        <ThumbsUp size={compact ? 9 : 11} /> {resolved} resolved
      </span>
      <span className={`inline-flex items-center rounded-full bg-amber-50 text-amber-700 font-bold ${size}`}>
        <Users size={compact ? 9 : 11} /> {offered} offered
      </span>
      <span className={`inline-flex items-center rounded-full bg-rose-50 text-brand font-bold ${size}`}>
        <LifeBuoy size={compact ? 9 : 11} /> {asked} asked
      </span>
    </div>
  );
}
