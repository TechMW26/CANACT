'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/Card';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { acceptFollow, blockUser, listenFavourites, listenFollowRequests, rejectFollow } from '@/lib/services/favourites';
import {
  acceptFriendRequest, declineFriendRequest, listenFriends, listenIncomingRequests, unfriend,
} from '@/lib/services/friends';
import type { FriendEdge, UserProfile } from '@/lib/types';
import { Star } from '@/components/icons';

type Tab = 'friends' | 'favourites';

export default function FavouritesPage() {
  const { user, profile } = useAuth();
  const [tab, setTab] = useState<Tab>('friends');

  const [friends, setFriends] = useState<FriendEdge[]>([]);
  const [friendReqs, setFriendReqs] = useState<FriendEdge[]>([]);
  const [favs, setFavs] = useState<UserProfile[]>([]);
  const [favReqs, setFavReqs] = useState<{ fromUid: string; fromName: string; createdAt: number; profile?: UserProfile }[]>([]);

  useEffect(() => { if (user) return listenFriends(user.uid, setFriends); }, [user?.uid]);
  useEffect(() => { if (user) return listenIncomingRequests(user.uid, setFriendReqs); }, [user?.uid]);

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
      setFavReqs(out);
    });
  }, [user?.uid]);

  if (!user) return null;
  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-1 rounded-full bg-white p-1 ring-1 ring-line">
        <PillTab active={tab === 'friends'} onClick={() => setTab('friends')} label="Friends" badge={friendReqs.length} />
        <PillTab active={tab === 'favourites'} onClick={() => setTab('favourites')} label="Favourites" badge={favReqs.length} />
      </div>

      {tab === 'friends' ? (
        <>
          <Card>
            <h3 className="font-bold">Pending friend requests</h3>
            {friendReqs.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No pending requests.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {friendReqs.map((r) => (
                  <li key={r.uid} className="flex items-center gap-3">
                    <Link href={`/profile/${r.uid}`} prefetch><Avatar src={r.photoURL} name={r.name} /></Link>
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{r.name}</div></div>
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!profile) return;
                        await acceptFriendRequest(
                          user.uid,
                          { name: profile.fullName, photoURL: profile.photoURL },
                          r.uid,
                          { name: r.name, photoURL: r.photoURL },
                        );
                      }}
                    >Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => declineFriendRequest(user.uid, r.uid)}>Decline</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-bold">My friends</h3>
            {friends.length === 0 ? (
              <p className="mt-1 text-sm text-muted">You don&apos;t have any friends yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {friends.map((f) => (
                  <li key={f.uid} className="flex items-center gap-3">
                    <Link href={`/profile/${f.uid}`} prefetch><Avatar src={f.photoURL} name={f.name} /></Link>
                    <Link href={`/profile/${f.uid}`} prefetch className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{f.name}</div>
                    </Link>
                    <Link href={`/inbox/${f.uid}`} prefetch><Button size="sm" variant="subtle">Message</Button></Link>
                    <Button size="sm" variant="outline" onClick={() => unfriend(user.uid, f.uid)}>Unfriend</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <>
          <Card>
            <h3 className="font-bold">Pending favourite requests</h3>
            {favReqs.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No pending requests.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {favReqs.map((r) => (
                  <li key={r.fromUid} className="flex items-center gap-3">
                    <Avatar src={r.profile?.photoURL} name={r.profile?.fullName ?? r.fromName} />
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{r.profile?.fullName ?? r.fromName}</div></div>
                    <Button size="sm" onClick={() => acceptFollow(user.uid, r.fromUid)}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={() => rejectFollow(user.uid, r.fromUid)}>Reject</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-bold">My favourites</h3>
            {favs.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Search for users to add them.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {favs.map((u) => (
                  <li key={u.uid} className="flex items-center gap-3">
                    <Link href={`/profile/${u.uid}`} prefetch><Avatar src={u.photoURL} name={u.fullName} /></Link>
                    <Link href={`/profile/${u.uid}`} prefetch className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{u.fullName}</div>
                      <div className="inline-flex items-center gap-1 text-xs text-muted">
                        <Star size={11} fill="currentColor" strokeWidth={0} className="text-brand" /> {(u.rating ?? 0).toFixed(1)}
                      </div>
                    </Link>
                    <Button size="sm" variant="outline" onClick={() => blockUser(user.uid, u.uid)}>Block</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function PillTab({ active, onClick, label, badge }: { active: boolean; onClick: () => void; label: string; badge: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 rounded-full px-4 py-2 text-sm font-extrabold transition ${active ? 'bg-brand text-white' : 'text-ink/60 hover:text-ink'}`}
    >
      {label}
      {badge > 0 && (
        <span className={`ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-extrabold ${active ? 'bg-white text-brand' : 'bg-brand text-white'}`}>
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}
