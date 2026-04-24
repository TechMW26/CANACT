'use client';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Avatar, RatingPill } from '@/components/Avatar';
import { useAuth } from '@/lib/auth';
import { acceptHelp, cancelHelpAccept, helperCloseHelp, requesterCloseHelp } from '@/lib/services/help';
import { HelpRequest } from '@/lib/types';
import { timeAgo, formatDistance } from '@/lib/utils';

export default function HelpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [h, setH] = useState<HelpRequest | null>(null);
  useEffect(() => onValue(ref(db, `help/${id}`), (s) => setH(s.val())), [id]);
  if (!h || !user || !profile) return null;
  const mine = h.uid === user.uid;
  const accepted = !!h.acceptedBy?.[user.uid];

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-start gap-3">
          <Avatar src={h.authorPhoto} name={h.authorName} size={56} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-extrabold">{h.authorName}</span>
              <RatingPill value={h.authorRating ?? 0} />
            </div>
            <div className="text-xs text-muted mt-0.5">{timeAgo(h.createdAt)} • {h.audience} • {h.channel} • {formatDistance(h.vicinityMeters)}</div>
            <p className="mt-3 whitespace-pre-wrap">{h.text}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {!mine && h.status !== 'closed' && (
            accepted ? (
              <>
                <Button variant="outline" onClick={() => cancelHelpAccept(h.id, user.uid)}>Cancel my acceptance</Button>
                <Button variant="subtle" onClick={() => helperCloseHelp(h.id, user.uid)}>Mark my part done</Button>
              </>
            ) : <Button onClick={() => acceptHelp(h.id, { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL })}>Accept &amp; help</Button>
          )}
          {mine && h.status !== 'closed' && (
            <>
              <Button onClick={() => requesterCloseHelp(h.id, 'yes').then(() => router.replace('/help'))}>Resolved — Yes</Button>
              <Button variant="subtle" onClick={() => requesterCloseHelp(h.id, 'tried').then(() => router.replace('/help'))}>Helpers tried</Button>
              <Button variant="outline" onClick={() => requesterCloseHelp(h.id, 'no').then(() => router.replace('/help'))}>Not resolved</Button>
            </>
          )}
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">Helpers</h3>
        {h.acceptedBy && Object.keys(h.acceptedBy).length ? (
          <ul className="mt-2 space-y-2">
            {Object.entries(h.acceptedBy).map(([uid, info]) => (
              <li key={uid} className="flex items-center gap-3">
                <Avatar src={info.photoURL} name={info.name} />
                <div className="flex-1">
                  <div className="font-semibold">{info.name}</div>
                  <div className="text-xs text-muted">accepted {timeAgo(info.at)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted text-sm mt-2">No one yet. Share with your circle.</p>}
      </Card>
    </div>
  );
}
