'use client';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { db } from '@/lib/firebase';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Avatar, RatingPill } from '@/components/Avatar';
import { HelpStatsPills } from '@/components/HelpStatsPills';
import { LiveLocationEmbed } from '@/components/LiveLocationEmbed';
import { HelpRatingSheet } from '@/components/HelpRatingSheet';
import { useAuth } from '@/lib/auth';
import {
  acceptHelp,
  cancelHelpAccept,
  confirmHelper,
  unconfirmHelper,
  helperCloseHelp,
  requesterCloseHelp,
} from '@/lib/services/help';
import { HelpRequest, UserProfile } from '@/lib/types';
import { timeAgo, formatDistance } from '@/lib/utils';
import { Check, MessageCircle, Phone, MapPin } from '@/components/icons';

/** Subscribe to a single user's profile, returning live snapshots. */
function useProfile(uid?: string) {
  const [p, setP] = useState<UserProfile | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onValue(ref(db, `users/${uid}`), (s) => setP(s.val()));
  }, [uid]);
  return p;
}

export default function HelpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const [h, setH] = useState<HelpRequest | null>(null);
  const [askerToRate, setAskerToRate] = useState<{ uid: string; name: string; photoURL?: string; role: 'asker' | 'helper' } | null>(null);

  useEffect(() => onValue(ref(db, `help/${id}`), (s) => setH(s.val())), [id]);

  const askerProfile = useProfile(h?.uid);

  // Auto-prompt rating when help is closed and the viewer hasn't rated yet.
  useEffect(() => {
    if (!h || !user || h.status !== 'closed') return;
    const isAsker = h.uid === user.uid;
    const isConfirmedHelper = !!h.confirmedHelpers?.[user.uid];
    if (!isAsker && !isConfirmedHelper) return;
    const ratings = h.ratings ?? {};

    if (isAsker) {
      // Asker rates each confirmed helper they haven't rated yet.
      const unrated = Object.keys(h.confirmedHelpers ?? {}).find((helperUid) => !ratings[`${user.uid}__${helperUid}`]);
      if (unrated) {
        const info = h.acceptedBy?.[unrated];
        setAskerToRate({ uid: unrated, name: info?.name ?? 'Helper', photoURL: info?.photoURL, role: 'helper' });
      }
    } else if (isConfirmedHelper) {
      if (!ratings[`${user.uid}__${h.uid}`]) {
        setAskerToRate({ uid: h.uid, name: h.authorName, photoURL: h.authorPhoto, role: 'asker' });
      }
    }
  }, [h, user]);

  if (!h || !user || !profile) return null;
  const mine = h.uid === user.uid;
  const offered = !!h.acceptedBy?.[user.uid];
  const confirmedMe = !!h.confirmedHelpers?.[user.uid];

  return (
    <div className="space-y-3">
      {/* Author header */}
      <Card>
        <div className="flex items-start gap-3">
          <Avatar src={h.authorPhoto} name={h.authorName} size={56} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold">{h.authorName}</span>
              <RatingPill value={askerProfile?.rating ?? h.authorRating ?? 0} />
            </div>
            <div className="text-xs text-muted mt-0.5">
              {timeAgo(h.createdAt)} • {h.audience} • {h.channel} • {formatDistance(h.vicinityMeters)}
            </div>
            <div className="mt-2"><HelpStatsPills uid={h.uid} compact /></div>
            <p className="mt-3 whitespace-pre-wrap">{h.text}</p>
          </div>
        </div>

        {/* Status pill */}
        <div className="mt-3">
          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold ${h.status === 'open' ? 'bg-amber-50 text-amber-700' : h.status === 'inProcess' ? 'bg-emerald-50 text-emerald-700' : 'bg-ink/10 text-ink'}`}>
            {h.status === 'open' && 'Open · waiting for helpers'}
            {h.status === 'inProcess' && 'In progress'}
            {h.status === 'closed' && (h.closeOutcome === 'yes' ? 'Resolved ✓' : h.closeOutcome === 'tried' ? 'Helpers tried' : 'Closed')}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!mine && h.status !== 'closed' && (
            offered ? (
              <>
                <Button variant="outline" onClick={() => cancelHelpAccept(h.id, user.uid)}>
                  {confirmedMe ? 'Withdraw from this help' : 'Cancel my offer'}
                </Button>
                {confirmedMe && (
                  <Button variant="subtle" onClick={() => helperCloseHelp(h.id, user.uid)}>Mark my part done</Button>
                )}
              </>
            ) : (
              <Button onClick={() => acceptHelp(h.id, { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL })}>
                Offer to help
              </Button>
            )
          )}
          {mine && h.status !== 'closed' && (
            <>
              <Button onClick={() => requesterCloseHelp(h.id, 'yes')}>Resolved — Yes</Button>
              <Button variant="subtle" onClick={() => requesterCloseHelp(h.id, 'tried')}>Helpers tried</Button>
              <Button variant="outline" onClick={() => requesterCloseHelp(h.id, 'no').then(() => router.replace('/help'))}>Not resolved</Button>
            </>
          )}
        </div>

        {!mine && offered && !confirmedMe && (
          <div className="mt-3 rounded-2xl bg-amber-50 text-amber-800 text-xs font-semibold p-3">
            Waiting for {h.authorName} to confirm your offer. You'll get a notification when they do.
          </div>
        )}
      </Card>

      {/* Confirmed actions: chat / call / in-person */}
      {confirmedMe && h.status !== 'closed' && (
        <ConfirmedActions help={h} viewer="helper" otherUid={h.uid} />
      )}

      {/* Helpers list */}
      <Card>
        <h3 className="font-bold">Helpers</h3>
        {h.acceptedBy && Object.keys(h.acceptedBy).length ? (
          <ul className="mt-2 space-y-3">
            {Object.entries(h.acceptedBy).map(([uid, info]) => (
              <HelperRow
                key={uid}
                help={h}
                helperUid={uid}
                info={info}
                viewerIsAsker={mine}
                viewerUid={user.uid}
                askerProfile={profile}
              />
            ))}
          </ul>
        ) : <p className="text-muted text-sm mt-2">No one yet. Share with your circle.</p>}
      </Card>

      {askerToRate && (
        <HelpRatingSheet
          open={!!askerToRate}
          onClose={() => setAskerToRate(null)}
          helpId={h.id}
          fromUid={user.uid}
          toUid={askerToRate.uid}
          toName={askerToRate.name}
          toPhoto={askerToRate.photoURL}
          toRole={askerToRate.role}
        />
      )}
    </div>
  );
}

function HelperRow({
  help,
  helperUid,
  info,
  viewerIsAsker,
  viewerUid,
  askerProfile,
}: {
  help: HelpRequest;
  helperUid: string;
  info: { name: string; photoURL?: string; at: number };
  viewerIsAsker: boolean;
  viewerUid: string;
  askerProfile: UserProfile;
}) {
  const helperProfile = useProfile(helperUid);
  const confirmed = !!help.confirmedHelpers?.[helperUid];
  const isMe = helperUid === viewerUid;

  return (
    <li className="rounded-2xl border border-ink/5 bg-white p-3">
      <div className="flex items-start gap-3">
        <Avatar src={info.photoURL} name={info.name} size={44} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/profile/${helperUid}`} className="font-bold truncate">{info.name}</Link>
            <RatingPill value={helperProfile?.rating ?? 0} />
            {confirmed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[10px] font-bold">
                <Check size={10} /> Confirmed
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted mt-0.5">offered {timeAgo(info.at)}</div>
          <div className="mt-2"><HelpStatsPills uid={helperUid} compact /></div>
        </div>
      </div>

      {viewerIsAsker && help.status !== 'closed' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {confirmed ? (
            <Button variant="outline" size="sm" onClick={() => unconfirmHelper(help.id, helperUid)}>
              Unconfirm
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => confirmHelper(
                help.id,
                helperUid,
                { uid: viewerUid, name: askerProfile.fullName, photoURL: askerProfile.photoURL },
                { name: info.name, photoURL: info.photoURL },
              )}
            >
              Confirm this helper
            </Button>
          )}
        </div>
      )}

      {viewerIsAsker && confirmed && help.status !== 'closed' && (
        <div className="mt-3"><ConfirmedActions help={help} viewer="asker" otherUid={helperUid} /></div>
      )}

      {isMe && !confirmed && help.status !== 'closed' && (
        <div className="mt-3 text-[11px] text-muted">You'll be unlocked for chat / call / live location once {help.authorName} confirms.</div>
      )}
    </li>
  );
}

/**
 * Channel-specific action panel that appears once asker has confirmed a
 * helper. Currently:
 *  - chat:     deep-link to inbox with the counterparty
 *  - call:     placeholder (in-app voice in Phase B)
 *  - inPerson: live-location embed using asker's coordinates + native maps link
 */
function ConfirmedActions({
  help,
  viewer,
  otherUid,
}: {
  help: HelpRequest;
  viewer: 'asker' | 'helper';
  otherUid: string;
}) {
  const inboxHref = `/inbox/${otherUid}`;
  const lat = help.lat;
  const lng = help.lng;

  if (help.channel === 'chat') {
    return (
      <Card className="!p-3">
        <Link
          href={inboxHref}
          className="flex items-center justify-between gap-2 rounded-2xl bg-brand text-white px-4 py-3 font-bold"
        >
          <span className="flex items-center gap-2"><MessageCircle size={16} /> Open help chat</span>
          <span className="text-xs opacity-80">→</span>
        </Link>
      </Card>
    );
  }

  if (help.channel === 'call') {
    return (
      <Card className="!p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white"><Phone size={14} /></span>
            <div>
              <div className="font-bold">In-app voice call</div>
              <div className="text-[11px] text-muted">Numbers stay private.</div>
            </div>
          </div>
          <Link href={inboxHref} className="text-brand text-xs font-bold underline">Open chat</Link>
        </div>
        <div className="mt-2 text-[11px] text-muted">
          {viewer === 'helper' ? 'Tap below when ready to ring' : 'Tap below to ring the helper'} — coming in v1.1.
        </div>
        <button
          type="button"
          disabled
          className="mt-2 w-full rounded-2xl bg-ink/10 text-ink/60 py-2.5 text-sm font-bold"
        >
          Start in-app call (soon)
        </button>
      </Card>
    );
  }

  // in-person
  return (
    <div className="space-y-2">
      {typeof lat === 'number' && typeof lng === 'number' ? (
        <LiveLocationEmbed lat={lat} lng={lng} label={viewer === 'helper' ? `${help.authorName}'s location` : 'Your shared location'} />
      ) : (
        <Card className="!p-3 text-sm text-muted flex items-center gap-2">
          <MapPin size={14} /> Location wasn't shared on this request.
        </Card>
      )}
      <Link
        href={inboxHref}
        className="flex items-center justify-between gap-2 rounded-2xl bg-brand-light text-brand px-4 py-3 font-bold"
      >
        <span className="flex items-center gap-2"><MessageCircle size={16} /> Coordinate in chat</span>
        <span className="text-xs opacity-70">→</span>
      </Link>
    </div>
  );
}
