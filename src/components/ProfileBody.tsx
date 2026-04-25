'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AttrKey, CARD_KEYS, CARD_LABELS, CardKey, NEGATIVE_ATTRS, POSITIVE_ATTRS, ReelItem, UserProfile, WhaPost } from '@/lib/types';
import { setAttribute, setLikeDislike, giveCard, takeBackCard, SIX_HOURS } from '@/lib/services/votes';
import { listenUserWhaPosts } from '@/lib/services/wha';
import { listenUserReels } from '@/lib/services/reels';
import { toast } from '@/components/Toaster';
import { requestFollow } from '@/lib/services/favourites';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  listenFriendStatus,
  sendFriendRequest,
  unfriend,
} from '@/lib/services/friends';
import {
  Award,
  CheckCircle2,
  Crown,
  Mail,
  MapPin,
  ThumbsDown,
  ThumbsUp,
  Camera,
  Film,
  Bookmark,
  Settings as SettingsIcon,
} from '@/components/icons';

export function ProfileBody({ uid, isSelf }: { uid: string; isSelf: boolean }) {
  const { user, profile: me } = useAuth();
  const [u, setU] = useState<UserProfile | null>(null);
  const [myVote, setMyVote] = useState<{ main?: 'like' | 'dislike'; attr?: { key: AttrKey; at: number }; cards?: Record<string, number> } | null>(null);
  const [friendStatus, setFriendStatus] = useState<'none' | 'requested' | 'incoming' | 'friends'>('none');

  useEffect(() => {
    return onValue(ref(db, `users/${uid}`), (s) => setU(s.val()));
  }, [uid]);

  useEffect(() => {
    if (!user || isSelf) return;
    return onValue(ref(db, `votes/${uid}/${user.uid}`), (s) => setMyVote(s.val() ?? {}));
  }, [uid, user?.uid, isSelf]);

  useEffect(() => {
    if (!user || isSelf) return;
    return listenFriendStatus(user.uid, uid, setFriendStatus);
  }, [uid, user?.uid, isSelf]);

  // Instagram-style posts grid (user's authored WHA posts).
  const [posts, setPosts] = useState<WhaPost[]>([]);
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [tab, setTab] = useState<'posts' | 'reels' | 'tagged'>('posts');
  useEffect(() => {
    return listenUserWhaPosts(uid, setPosts);
  }, [uid]);
  useEffect(() => {
    return listenUserReels(uid, setReels);
  }, [uid]);

  if (!u) {
    return (
      <div className="space-y-4">
        <Card className="overflow-hidden border border-[#F1D7DC]">
          <div className="flex items-start gap-4">
            <div className="h-24 w-24 shrink-0 animate-pulse rounded-3xl bg-brand-light" />
            <div className="flex-1 space-y-3">
              <div className="h-5 w-44 animate-pulse rounded bg-brand-light" />
              <div className="flex gap-2">
                <div className="h-6 w-16 animate-pulse rounded-full bg-brand-light/70" />
                <div className="h-6 w-20 animate-pulse rounded-full bg-brand-light/70" />
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[0,1,2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-brand-light/60" />)}
          </div>
        </Card>
        <Card className="!p-0">
          <div className="grid grid-cols-3 gap-[2px] bg-line">
            {[0,1,2,3,4,5].map((i) => <div key={i} className="aspect-square animate-pulse bg-brand-light/60" />)}
          </div>
        </Card>
      </div>
    );
  }

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

  const statCards = [
    { label: 'Rating', value: (u.rating ?? 0).toFixed(1), tone: 'text-brand bg-brand-light/70' },
    { label: 'Likes', value: String(u.likesCount ?? 0), tone: 'text-emerald-700 bg-emerald-50' },
    { label: 'Cards', value: String(CARD_KEYS.reduce((sum, key) => sum + (u.cardsReceived?.[key] ?? 0), 0)), tone: 'text-amber-700 bg-amber-50' },
  ];
  const locationText = [u.city, u.country].filter(Boolean).join(', ');
  const isVerified = !!u.profileVerified;

  return (
    <div className="space-y-4">
      <Card className="relative overflow-hidden border border-[#F1D7DC] bg-[radial-gradient(circle_at_top_left,_rgba(255,216,221,0.9),_rgba(255,248,248,0.96)_44%,_rgba(255,255,255,1)_100%)] shadow-[0_24px_60px_-28px_rgba(200,16,46,0.35)]">
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-brand/10 blur-2xl" />
        <div className="pointer-events-none absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-amber-200/30 blur-2xl" />
        <div className="relative">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="flex items-center gap-4 md:flex-col md:items-start">
              <div className="rounded-[28px] bg-white/80 p-1.5 shadow-[0_10px_24px_-12px_rgba(10,10,10,0.25)] ring-1 ring-white/70">
                <Avatar src={u.photoURL} name={u.fullName} size={96} />
              </div>
              <div className="flex-1 min-w-0 md:hidden">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-2xl font-black tracking-tight truncate">{u.fullName}</h2>
                  {isVerified ? <VerifiedBadge /> : null}
                </div>
                <div className="mt-1 flex items-center gap-2 flex-wrap">
                  <RatingPill value={u.rating ?? 0} />
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold text-ink/70">{u.likesCount ?? 0} likes</span>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold text-ink/70">{u.dislikesCount ?? 0} dislikes</span>
                </div>
              </div>
            </div>

            <div className="hidden flex-1 min-w-0 md:block">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-3xl font-black tracking-tight truncate">{u.fullName}</h2>
                {isVerified ? <VerifiedBadge /> : null}
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <RatingPill value={u.rating ?? 0} />
                <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold text-ink/70">{u.likesCount ?? 0} likes</span>
                <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold text-ink/70">{u.dislikesCount ?? 0} dislikes</span>
                {isSelf && u.mobile ? <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold text-ink/70">+91 {u.mobile}</span> : null}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {statCards.map((item) => (
              <div key={item.label} className={`rounded-2xl px-3 py-3 ${item.tone}`}>
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">{item.label}</div>
                <div className="mt-1 text-xl font-black leading-none">{item.value}</div>
              </div>
            ))}
          </div>

          {/* Personal info — only visible to the owner */}
          {isSelf ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <InfoPill icon={<MapPin size={14} />} label={locationText || 'Location not set'} />
              <InfoPill icon={<Mail size={14} />} label={u.email || 'Email private'} />
              <InfoPill icon={<Award size={14} />} label={u.dateOfBirth ? `DOB ${u.dateOfBirth}` : 'DOB not verified'} />
              <InfoPill icon={<Crown size={14} />} label={u.address || 'Address not verified'} />
            </div>
          ) : null}

          {isSelf && u.bio ? <p className="mt-4 text-sm leading-6 text-ink/75 whitespace-pre-wrap">{u.bio}</p> : null}
          {isSelf && u.tags?.length ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {u.tags.map((t) => (
                <span key={t} className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11px] font-bold text-brand shadow-sm">
                  {t}
                </span>
              ))}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            {isSelf ? (
              <Link href="/profile/settings" prefetch>
                <Button variant="outline" size="sm" icon={<SettingsIcon size={14} />}>Profile settings</Button>
              </Link>
            ) : (
              <>
                <Button size="sm" variant={myVote?.main === 'like' ? 'primary' : 'outline'} onClick={() => user && setLikeDislike(uid, user.uid, 'like')}>
                  <ThumbsUp size={14} className="mr-1" /> Like
                </Button>
                <Button size="sm" variant={myVote?.main === 'dislike' ? 'danger' : 'outline'} onClick={() => user && setLikeDislike(uid, user.uid, 'dislike')}>
                  <ThumbsDown size={14} className="mr-1" /> Dislike
                </Button>
                <Button size="sm" variant="subtle" onClick={async () => { if (user && me) { await requestFollow(user.uid, me.fullName, uid); toast('Request sent', 'success'); } }}>+ Favourite</Button>
                <FriendButton
                  status={friendStatus}
                  onSend={async () => {
                    if (!user || !me) return;
                    await sendFriendRequest(
                      { uid: user.uid, name: me.fullName, photoURL: me.photoURL },
                      { uid: u.uid, name: u.fullName, photoURL: u.photoURL },
                    );
                    toast('Friend request sent', 'success');
                  }}
                  onCancel={async () => { if (user) await cancelFriendRequest(user.uid, uid); }}
                  onAccept={async () => {
                    if (!user || !me) return;
                    await acceptFriendRequest(
                      user.uid,
                      { name: me.fullName, photoURL: me.photoURL },
                      uid,
                      { name: u.fullName, photoURL: u.photoURL },
                    );
                    toast('You are now friends', 'success');
                  }}
                  onDecline={async () => { if (user) await declineFriendRequest(user.uid, uid); }}
                  onUnfriend={async () => { if (user) await unfriend(user.uid, uid); }}
                />
                <Link href={`/inbox/${uid}`} prefetch>
                  <Button size="sm" variant="outline">Message</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Instagram-style posts grid */}
      <Card className="!p-0 overflow-hidden">
        <div className="grid grid-cols-3 border-b border-line">
          {([
            { id: 'posts', label: 'Posts', Icon: Camera, count: posts.length },
            { id: 'reels', label: 'Reels', Icon: Film, count: reels.length },
            { id: 'tagged', label: 'Tagged', Icon: Bookmark, count: 0 },
          ] as const).map(({ id, label, Icon, count }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`relative flex items-center justify-center gap-2 py-3 text-xs font-bold uppercase tracking-[0.18em] transition ${active ? 'text-brand' : 'text-ink/45 hover:text-ink/70'}`}
              >
                <Icon size={14} strokeWidth={2.2} />
                <span className="hidden sm:inline">{label}</span>
                <span>{count}</span>
                {active ? <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-brand" /> : null}
              </button>
            );
          })}
        </div>
        {tab === 'posts' ? (
          posts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink/15 text-ink/40">
                <Camera size={20} />
              </span>
              <div className="text-sm font-bold text-ink">No posts yet</div>
              <div className="text-xs text-muted">{isSelf ? 'Tap + to share something.' : 'Nothing here yet.'}</div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-[2px] bg-line">
              {posts.map((p) => {
                const cover = p.mediaUrls?.[0];
                return (
                  <Link
                    key={p.id}
                    href={`/post/${p.id}`}
                    className="relative aspect-square overflow-hidden bg-brand-light"
                  >
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-light to-white p-2 text-center text-[11px] font-semibold leading-tight text-ink/70">
                        <span className="line-clamp-5">{p.text || 'Untitled'}</span>
                      </div>
                    )}
                    {p.mediaUrls && p.mediaUrls.length > 1 ? (
                      <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {p.mediaUrls.length}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          )
        ) : tab === 'reels' ? (
          reels.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink/15 text-ink/40">
                <Film size={20} />
              </span>
              <div className="text-sm font-bold text-ink">No reels yet</div>
              <div className="text-xs text-muted">{isSelf ? 'Tap + to share a reel.' : 'Nothing here yet.'}</div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-[2px] bg-line">
              {reels.map((r) => (
                <Link
                  key={r.id}
                  href="/reels"
                  className="relative aspect-[9/16] overflow-hidden bg-black"
                >
                  {r.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <video
                      src={r.videoUrl}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    <Film size={10} className="inline -mt-0.5 mr-0.5" />
                  </span>
                </Link>
              ))}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink/15 text-ink/40">
              <Bookmark size={20} />
            </span>
            <div className="text-sm font-bold text-ink">Coming soon</div>
            <div className="text-xs text-muted">This tab will light up soon.</div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="font-black tracking-tight">Attributes</h3>
          {cooldownLeft > 0 && !isSelf && <span className="text-xs text-muted">Cooldown {Math.ceil(cooldownLeft / 60000)} min</span>}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <AttrGroup title="Positive" items={POSITIVE_ATTRS} u={u} mine={myVote?.attr?.key} disabled={isSelf || cooldownLeft > 0} onPick={handleAttr} positive />
          <AttrGroup title="Negative" items={NEGATIVE_ATTRS} u={u} mine={myVote?.attr?.key} disabled={isSelf || cooldownLeft > 0} onPick={handleAttr} positive={false} />
        </div>
      </Card>

      <Card>
        <h3 className="font-black tracking-tight">Cards</h3>
        <p className="text-xs text-muted">Tap to give. Tap again to take back. One card per pair.</p>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {CARD_KEYS.map((c) => {
            const given = !!myVote?.cards?.[c];
            return (
              <button key={c} disabled={isSelf} onClick={() => handleCard(c)}
                className={`rounded-2xl p-3 border text-left transition ${given ? 'bg-brand text-white border-brand shadow-[0_10px_24px_-14px_rgba(200,16,46,0.65)]' : 'bg-white text-ink border-line hover:border-brand-light'} disabled:opacity-70`}>
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

function FriendButton({
  status,
  onSend,
  onCancel,
  onAccept,
  onDecline,
  onUnfriend,
}: {
  status: 'none' | 'requested' | 'incoming' | 'friends';
  onSend: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onAccept: () => void | Promise<void>;
  onDecline: () => void | Promise<void>;
  onUnfriend: () => void | Promise<void>;
}) {
  if (status === 'friends') {
    return <Button size="sm" variant="outline" onClick={() => onUnfriend()}>✓ Friends</Button>;
  }
  if (status === 'requested') {
    return <Button size="sm" variant="outline" onClick={() => onCancel()}>Requested</Button>;
  }
  if (status === 'incoming') {
    return (
      <>
        <Button size="sm" onClick={() => onAccept()}>Accept</Button>
        <Button size="sm" variant="ghost" onClick={() => onDecline()}>Decline</Button>
      </>
    );
  }
  return <Button size="sm" onClick={() => onSend()}>Add friend</Button>;
}

function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-100 font-bold text-emerald-800 ${compact ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1 text-xs'}`}>
      <CheckCircle2 size={compact ? 12 : 14} /> Verified
    </span>
  );
}

function InfoPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 text-sm text-ink/75 shadow-[0_8px_20px_-16px_rgba(10,10,10,0.3)]">
      <span className="shrink-0 text-brand">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

function LockedField(_: { label: string; value: string; className?: string }) { return null; }

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
