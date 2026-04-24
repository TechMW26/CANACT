'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { acceptFollow, blockUser, listenFavourites, listenFollowRequests, rejectFollow } from '@/lib/services/favourites';
import { UserProfile } from '@/lib/types';
import { Star } from '@/components/icons';

export default function FavouritesPage() {
  const { user } = useAuth();
  const [favs, setFavs] = useState<UserProfile[]>([]);
  const [reqs, setReqs] = useState<{ fromUid: string; fromName: string; createdAt: number; profile?: UserProfile }[]>([]);

  useEffect(() => {
    if (!user) return;
    return listenFavourites(user.uid, async (uids) => {
      const out: UserProfile[] = [];
      await Promise.all(uids.map(async (uid) => {
        const s = await new Promise<UserProfile | null>((res) => {
          const off = onValue(ref(db, `users/${uid}`), (snap) => { off(); res(snap.val()); }, { onlyOnce: true });
        });
        if (s) out.push(s);
      }));
      setFavs(out);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    return listenFollowRequests(user.uid, async (rs) => {
      const out: any[] = [];
      await Promise.all(rs.map(async (r) => {
        const s = await new Promise<UserProfile | null>((res) => {
          const off = onValue(ref(db, `users/${r.fromUid}`), (snap) => { off(); res(snap.val()); }, { onlyOnce: true });
        });
        out.push({ ...r, profile: s });
      }));
      setReqs(out);
    });
  }, [user?.uid]);

  if (!user) return null;
  return (
    <div className="space-y-3">
      <Card>
        <h3 className="font-bold">Pending requests</h3>
        {reqs.length === 0 ? <p className="text-sm text-muted mt-1">No pending requests.</p> : (
          <ul className="mt-2 space-y-2">
            {reqs.map((r) => (
              <li key={r.fromUid} className="flex items-center gap-3">
                <Avatar src={r.profile?.photoURL} name={r.profile?.fullName ?? r.fromName} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{r.profile?.fullName ?? r.fromName}</div>
                </div>
                <Button size="sm" onClick={() => acceptFollow(user.uid, r.fromUid)}>Accept</Button>
                <Button size="sm" variant="outline" onClick={() => rejectFollow(user.uid, r.fromUid)}>Reject</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h3 className="font-bold">My favourites</h3>
        {favs.length === 0 ? <p className="text-sm text-muted mt-1">Search for users to add them.</p> : (
          <ul className="mt-2 space-y-2">
            {favs.map((u) => (
              <li key={u.uid} className="flex items-center gap-3">
                <Link href={`/profile/${u.uid}`}><Avatar src={u.photoURL} name={u.fullName} /></Link>
                <Link href={`/profile/${u.uid}`} className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{u.fullName}</div>
                   <div className="text-xs text-muted inline-flex items-center gap-1"><Star size={11} fill="currentColor" strokeWidth={0} className="text-brand" /> {(u.rating ?? 0).toFixed(1)}</div>
                </Link>
                <Button size="sm" variant="outline" onClick={() => blockUser(user.uid, u.uid)}>Block</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
