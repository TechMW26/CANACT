'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref, get } from 'firebase/database';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AttrKey, CARD_KEYS, CARD_LABELS, CardKey, NEGATIVE_ATTRS, POSITIVE_ATTRS, UserProfile } from '@/lib/types';
import { setAttribute, setLikeDislike, giveCard, takeBackCard, SIX_HOURS } from '@/lib/services/votes';
import { toast } from '@/components/Toaster';
import { requestFollow } from '@/lib/services/favourites';
import { ThumbsUp, ThumbsDown } from '@/components/icons';

export function ProfileBody({ uid, isSelf }: { uid: string; isSelf: boolean }) {
  const { user, profile: me } = useAuth();
  const [u, setU] = useState<UserProfile | null>(null);
  const [myVote, setMyVote] = useState<{ main?: 'like' | 'dislike'; attr?: { key: AttrKey; at: number }; cards?: Record<string, number> } | null>(null);

  useEffect(() => {
    return onValue(ref(db, `users/${uid}`), (s) => setU(s.val()));
  }, [uid]);

  useEffect(() => {
    if (!user || isSelf) return;
    return onValue(ref(db, `votes/${uid}/${user.uid}`), (s) => setMyVote(s.val() ?? {}));
  }, [uid, user?.uid, isSelf]);

  if (!u) return <div className="h-32 flex items-center justify-center text-muted">Loading…</div>;

  const cooldownLeft = (() => {
    if (!myVote?.attr) return 0;
    const left = SIX_HOURS - (Date.now() - myVote.attr.at);
    return left > 0 ? left : 0;
  })();

  const handleAttr = async (k: AttrKey) => {
    if (isSelf || !user) return;
    const r = await setAttribute(uid, user.uid, k);
    if (!r.ok) {
      const m = Math.ceil((r.waitMs ?? 0) / 60000);
      toast(`Wait ${Math.ceil(m / 60)}h to vote attributes again`, 'error');
    } else toast('Attribute updated', 'success');
  };

  const handleCard = async (c: CardKey) => {
    if (isSelf || !user) return;
    if (myVote?.cards?.[c]) await takeBackCard(uid, user.uid, c);
    else await giveCard(uid, user.uid, c);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-4">
          <Avatar src={u.photoURL} name={u.fullName} size={72} />
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-extrabold truncate">{u.fullName}</h2>
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <RatingPill value={u.rating ?? 0} />
              <span className="text-xs text-muted">{u.likesCount ?? 0} likes • {u.dislikesCount ?? 0} dislikes</span>
            </div>
            {u.city || u.country ? <p className="text-xs text-muted mt-1">{[u.city, u.country].filter(Boolean).join(', ')}</p> : null}
          </div>
        </div>
        {u.bio && <p className="mt-3 text-sm text-muted whitespace-pre-wrap">{u.bio}</p>}
        {u.tags?.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {u.tags.map((t) => <span key={t} className="text-[11px] rounded-full bg-brand-light text-brand px-2 py-0.5 font-bold">{t}</span>)}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {isSelf ? (
            <>
              <Link href="/edit-profile"><Button variant="outline" size="sm">Edit profile</Button></Link>
              <Link href="/rateme/start"><Button size="sm">Start Rate Me</Button></Link>
              <Link href="/underground"><Button variant="ghost" size="sm">Underground</Button></Link>
            </>
          ) : (
            <>
              <Button size="sm" variant={myVote?.main === 'like' ? 'primary' : 'outline'} onClick={() => user && setLikeDislike(uid, user.uid, 'like')}>
                <ThumbsUp size={14} className="mr-1" /> Like
              </Button>
              <Button size="sm" variant={myVote?.main === 'dislike' ? 'danger' : 'outline'} onClick={() => user && setLikeDislike(uid, user.uid, 'dislike')}>
                <ThumbsDown size={14} className="mr-1" /> Dislike
              </Button>
              <Button size="sm" variant="subtle" onClick={async () => { if (user && me) { await requestFollow(user.uid, me.fullName, uid); toast('Request sent', 'success'); } }}>+ Favourite</Button>
            </>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Attributes</h3>
          {cooldownLeft > 0 && !isSelf && <span className="text-xs text-muted">Cooldown {Math.ceil(cooldownLeft / 60000)} min</span>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AttrGroup title="Positive" items={POSITIVE_ATTRS} u={u} mine={myVote?.attr?.key} disabled={isSelf || cooldownLeft > 0} onPick={handleAttr} positive />
          <AttrGroup title="Negative" items={NEGATIVE_ATTRS} u={u} mine={myVote?.attr?.key} disabled={isSelf || cooldownLeft > 0} onPick={handleAttr} positive={false} />
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">Cards</h3>
        <p className="text-xs text-muted">Tap to give. Tap again to take back. One card per pair.</p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CARD_KEYS.map((c) => {
            const given = !!myVote?.cards?.[c];
            return (
              <button key={c} disabled={isSelf} onClick={() => handleCard(c)}
                className={`rounded-2xl p-3 border text-left ${given ? 'bg-brand text-white border-brand' : 'bg-white text-ink border-line'} disabled:opacity-70`}>
                <div className="text-xs font-bold uppercase tracking-wide opacity-80">Card</div>
                <div className="font-bold">{CARD_LABELS[c]}</div>
                <div className="mt-1 text-xs">{u.cardsReceived?.[c] ?? 0} received</div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function AttrGroup({ title, items, u, mine, disabled, onPick, positive }: { title: string; items: readonly AttrKey[]; u: UserProfile; mine?: AttrKey; disabled: boolean; onPick: (k: AttrKey) => void; positive: boolean }) {
  return (
    <div className={`rounded-xl p-3 border ${positive ? 'border-brand-light bg-white' : 'border-line bg-white'}`}>
      <h4 className={`text-xs font-bold mb-2 ${positive ? 'text-brand' : 'text-muted'}`}>{title}</h4>
      <div className="flex flex-col gap-1.5">
        {items.map((k) => {
          const selected = mine === k;
          return (
            <button key={k} disabled={disabled} onClick={() => onPick(k)}
              className={`text-left text-sm rounded-full px-3 h-9 border ${selected ? 'bg-brand text-white border-brand' : 'bg-candy text-ink border-line'} disabled:opacity-60`}>
              <span className="capitalize">{k}</span>
              <span className="float-right text-xs opacity-80">{u.attrs?.[k] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
