'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FastAverageColor } from 'fast-average-color';
import { onValue, ref } from 'firebase/database';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AttrKey, CARD_KEYS, CARD_LABELS, CardKey, NEGATIVE_ATTRS, POSITIVE_ATTRS, Poll, RateMeSession, ReelItem, UserProfile, WhaPost } from '@/lib/types';
import { setAttribute, setLikeDislike, giveCard, takeBackCard, SIX_HOURS } from '@/lib/services/votes';
import { deletePost, listenUserWhaPosts } from '@/lib/services/wha';
import { deleteReel, listenUserReels } from '@/lib/services/reels';
import { listenUserPolls, deletePoll } from '@/lib/services/poll';
import { deleteRateMeSession, listenUserRateMe, voteRateMe } from '@/lib/services/rateme';
import { toast } from '@/components/Toaster';
import { PostMenu } from '@/components/PostMenu';
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
  Heart,
  BarChart3,
  Pencil,
  Star,
  Users as UsersIcon,
  Settings as SettingsIcon,
  Bookmark,
  Send,
  MoreHorizontal,
  ShoppingBag,
  AlignLeft,
  Video,
} from '@/components/icons';

export function ProfileBody({ uid, isSelf }: { uid: string; isSelf: boolean }) {
  const { user, profile: me } = useAuth();
  const [u, setU] = useState<UserProfile | null>(null);
  const [myVote, setMyVote] = useState<{ main?: 'like' | 'dislike'; attr?: { key: AttrKey; at: number }; cards?: Record<string, number> } | null>(null);
  const [friendStatus, setFriendStatus] = useState<'none' | 'requested' | 'incoming' | 'friends'>('none');
  const [profileVoteBusy, setProfileVoteBusy] = useState(false);

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
  const [polls, setPolls] = useState<Poll[]>([]);
  const [tab, setTab] = useState<'posts' | 'reels' | 'polls' | 'rateme'>('posts');
  useEffect(() => {
    return listenUserWhaPosts(uid, setPosts);
  }, [uid]);
  useEffect(() => {
    return listenUserReels(uid, setReels);
  }, [uid]);
  useEffect(() => {
    return listenUserPolls(uid, setPolls);
  }, [uid]);
  // Surface the user's Rate Me sessions on their profile so a finished
  // round still has a permanent home (matches the wall behaviour). We
  // include both active and recently-ended sessions; voting is locked
  // automatically once `endsAt` passes.
  const [ratemes, setRatemes] = useState<RateMeSession[]>([]);
  useEffect(() => {
    return listenUserRateMe(uid, setRatemes);
  }, [uid]);

  // Friends count (self only) — used in the redesigned clean hero stats
  // card. Non-self profiles don't show a friend count to avoid the
  // privacy concern of broadcasting your social graph size.
  const [friendsCount, setFriendsCount] = useState(0);
  useEffect(() => {
    if (!isSelf) return;
    return onValue(ref(db, `friends/${uid}`), (s) => {
      let n = 0; s.forEach(() => { n += 1; });
      setFriendsCount(n);
    });
  }, [uid, isSelf]);

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

  const locationText = [u.city, u.country].filter(Boolean).join(', ');
  const isVerified = !!u.profileVerified;

  // Compute age from dateOfBirth (stored as YYYY-MM-DD or similar). Used in
  // the clean self-hero "Name · 26" line in the reference design.
  const age = (() => {
    if (!u.dateOfBirth) return undefined;
    const d = new Date(u.dateOfBirth);
    if (Number.isNaN(d.getTime())) return undefined;
    const diff = Date.now() - d.getTime();
    const a = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
    return a > 0 && a < 130 ? a : undefined;
  })();

  const supportersCount = isSelf
    ? Math.max(friendsCount, u.likesCount ?? 0)
    : (u.likesCount ?? 0);

  const handleProfileSupport = async () => {
    if (isSelf || !user || !me) return;
    try {
      if (friendStatus === 'incoming') {
        await acceptFriendRequest(
          user.uid,
          { name: me.fullName, photoURL: me.photoURL },
          uid,
          { name: u.fullName, photoURL: u.photoURL },
        );
        toast('You are now friends', 'success');
        return;
      }
      if (friendStatus === 'none') {
        await sendFriendRequest(
          { uid: user.uid, name: me.fullName, photoURL: me.photoURL },
          { uid: u.uid, name: u.fullName, photoURL: u.photoURL },
        );
        await setLikeDislike(uid, user.uid, 'like');
        toast('Support sent', 'success');
        return;
      }
      if (friendStatus === 'friends') {
        await requestFollow(user.uid, me.fullName, uid);
        toast('Added to favourites', 'success');
        return;
      }
      toast('Request already sent', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not support profile', 'error');
    }
  };

  const handleProfileBookmark = async () => {
    if (isSelf || !user || !me) return;
    try {
      await requestFollow(user.uid, me.fullName, uid);
      toast('Request sent', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not send request', 'error');
    }
  };

  const handleProfileVote = async (kind: 'like' | 'dislike') => {
    if (isSelf || !user || profileVoteBusy) return;
    const previousVote = myVote?.main;
    setProfileVoteBusy(true);
    setMyVote((current) => ({ ...(current ?? {}), main: kind }));
    try {
      await setLikeDislike(uid, user.uid, kind);
      toast(kind === 'like' ? 'Liked profile' : 'Disliked profile', 'success');
    } catch (error: any) {
      setMyVote((current) => ({ ...(current ?? {}), main: previousVote }));
      toast(error?.message ?? 'Could not update vote', 'error');
    } finally {
      setProfileVoteBusy(false);
    }
  };

  return (
    <CanactPagesProfileUI
      userProfile={u}
      isSelf={isSelf}
      isVerified={isVerified}
      age={age}
      locationText={locationText}
      supportersCount={supportersCount}
      tab={tab}
      setTab={setTab}
      posts={posts}
      reels={reels}
      polls={polls}
      ratemes={ratemes}
      onSupport={handleProfileSupport}
      onBookmark={handleProfileBookmark}
      onProfileVote={handleProfileVote}
      profileVote={myVote?.main}
      profileVoteBusy={profileVoteBusy}
      friendStatus={friendStatus}
    />
  );
}

type ProfileTabKey = 'posts' | 'reels' | 'polls' | 'rateme';

function profileSlug(user: UserProfile) {
  return String(user.fullName || user.email || user.mobile || 'canact')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 18) || 'canact';
}

function splitProfileName(name?: string | null) {
  const safeName = String(name || '').trim();
  const parts = safeName.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [safeName || 'CANACT', 'Profile'];
  return [parts[0], parts.slice(1).join(' ')];
}

function BrandDot({ color, letter }: { color: string; letter: string }) {
  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-[2px] ring-black/40"
      style={{ background: color, fontSize: 9, fontWeight: 800, color: '#fff' }}
    >
      {letter}
    </div>
  );
}

type ProfileThumb = {
  id: string;
  href: string;
  src?: string | null;
  video?: string | null;
  label: string;
};

type ChromeTone = 'light' | 'dark';

const PROFILE_CHROME_FALLBACK: { top: ChromeTone; bottom: ChromeTone } = { top: 'light', bottom: 'dark' };
const PROFILE_CHROME_VARS = [
  '--canact-profile-top-rgb',
  '--canact-profile-bottom-rgb',
  '--canact-profile-top-ink',
  '--canact-profile-bottom-ink',
  '--canact-profile-top-light-opacity',
  '--canact-profile-top-dark-opacity',
  '--canact-profile-bottom-light-opacity',
  '--canact-profile-bottom-dark-opacity',
];

function toneToRgb(tone: ChromeTone) {
  return tone === 'light' ? '255 255 255' : '0 0 0';
}

function toneToInk(tone: ChromeTone) {
  return tone === 'light' ? '10 10 10' : '255 255 255';
}

function applyProfileChrome(top: ChromeTone, bottom: ChromeTone) {
  const root = document.documentElement;
  root.style.setProperty('--canact-profile-top-rgb', toneToRgb(top));
  root.style.setProperty('--canact-profile-bottom-rgb', toneToRgb(bottom));
  root.style.setProperty('--canact-profile-top-ink', toneToInk(top));
  root.style.setProperty('--canact-profile-bottom-ink', toneToInk(bottom));
  root.style.setProperty('--canact-profile-top-light-opacity', top === 'light' ? '1' : '0');
  root.style.setProperty('--canact-profile-top-dark-opacity', top === 'dark' ? '1' : '0');
  root.style.setProperty('--canact-profile-bottom-light-opacity', bottom === 'light' ? '1' : '0');
  root.style.setProperty('--canact-profile-bottom-dark-opacity', bottom === 'dark' ? '1' : '0');
}

function clearProfileChrome() {
  const root = document.documentElement;
  PROFILE_CHROME_VARS.forEach((property) => root.style.removeProperty(property));
}

function toneFromLuma(luma: number) {
  return luma >= 154 ? 'light' : 'dark';
}

function imageCoverRect(image: HTMLImageElement, viewportWidth: number, viewportHeight: number) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const viewportAspect = viewportWidth / viewportHeight;
  const imageAspect = imageWidth / imageHeight;
  if (imageAspect > viewportAspect) {
    const sourceWidth = imageHeight * viewportAspect;
    return { sx: (imageWidth - sourceWidth) / 2, sy: 0, sw: sourceWidth, sh: imageHeight };
  }
  const sourceHeight = imageWidth / viewportAspect;
  return { sx: 0, sy: (imageHeight - sourceHeight) / 2, sw: imageWidth, sh: sourceHeight };
}

let profileAverageColor: FastAverageColor | null = null;

function getProfileAverageColor() {
  if (!profileAverageColor) profileAverageColor = new FastAverageColor();
  return profileAverageColor;
}

function loadProfileImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = src;
  });
}

function lumaFromRgba(colorValue: [number, number, number, number]) {
  const alpha = colorValue[3] / 255;
  if (alpha <= 0) return 0;
  return (0.2126 * colorValue[0] + 0.7152 * colorValue[1] + 0.0722 * colorValue[2]) * alpha;
}

async function sampleProfileImageTones(src: string): Promise<{ top: ChromeTone; bottom: ChromeTone }> {
  try {
    const image = await loadProfileImage(src);
    const viewportWidth = Math.max(window.innerWidth || 1, 1);
    const viewportHeight = Math.max(window.innerHeight || 1, 1);
    const rect = imageCoverRect(image, viewportWidth, viewportHeight);
    const fac = getProfileAverageColor();
    const topColor = await fac.getColorAsync(image, {
      left: rect.sx,
      top: rect.sy,
      width: rect.sw,
      height: Math.max(1, rect.sh * 0.22),
      algorithm: 'sqrt',
    });
    const bottomColor = await fac.getColorAsync(image, {
      left: rect.sx,
      top: rect.sy + (rect.sh * 0.76),
      width: rect.sw,
      height: Math.max(1, rect.sh * 0.24),
      algorithm: 'sqrt',
    });
    const topLuma = lumaFromRgba(topColor.value as [number, number, number, number]);
    const bottomLuma = lumaFromRgba(bottomColor.value as [number, number, number, number]) * 0.68;
    return { top: toneFromLuma(topLuma), bottom: toneFromLuma(bottomLuma) };
  } catch {
    return PROFILE_CHROME_FALLBACK;
  }
}

function useAdaptiveProfileChrome(heroSrc: string | null) {
  const [tone, setTone] = useState(PROFILE_CHROME_FALLBACK);

  useLayoutEffect(() => {
    let cancelled = false;
    setTone(PROFILE_CHROME_FALLBACK);
    applyProfileChrome(PROFILE_CHROME_FALLBACK.top, PROFILE_CHROME_FALLBACK.bottom);
    if (heroSrc) {
      sampleProfileImageTones(heroSrc).then((nextTone) => {
        if (!cancelled) {
          setTone(nextTone);
          applyProfileChrome(nextTone.top, nextTone.bottom);
        }
      });
    }
    return () => {
      cancelled = true;
      clearProfileChrome();
    };
  }, [heroSrc]);

  return tone;
}

function postCover(post: WhaPost) {
  return post.mediaPosters?.[0] || post.mediaUrls?.[0] || null;
}

function profileHeroImage(userProfile: UserProfile, posts: WhaPost[], reels: ReelItem[], ratemes: RateMeSession[]) {
  return userProfile.photoURL
    || posts.map(postCover).find(Boolean)
    || reels.map((reel) => reel.posterUrl).find(Boolean)
    || ratemes.map((item) => item.photoURL).find(Boolean)
    || null;
}

function profileThumbnails(tab: ProfileTabKey, posts: WhaPost[], reels: ReelItem[], polls: Poll[], ratemes: RateMeSession[]): ProfileThumb[] {
  if (tab === 'reels') {
    return reels.slice(0, 8).map((reel) => ({
      id: reel.id,
      href: `/reel/${reel.id}`,
      src: reel.posterUrl,
      video: reel.videoUrl,
      label: reel.caption || 'Reel',
    }));
  }
  if (tab === 'polls' || tab === 'rateme') {
    return [
      ...polls.slice(0, 4).map((poll) => ({
        id: poll.id,
        href: `/poll/${poll.id}`,
        src: poll.photoURL,
        label: poll.question || 'Poll',
      })),
      ...ratemes.slice(0, 4).map((item) => ({
        id: item.id,
        href: `/rateme/${item.id}`,
        src: item.photoURL,
        label: 'Rate Me',
      })),
    ].slice(0, 8);
  }
  return posts.slice(0, 8).map((post) => ({
    id: post.id,
    href: `/post/${post.id}`,
    src: postCover(post),
    label: post.text || 'Post',
  }));
}

function ProfileVotePill({
  vote,
  busy,
  onVote,
  topTone,
}: {
  vote?: 'like' | 'dislike';
  busy: boolean;
  onVote: (kind: 'like' | 'dislike') => Promise<void>;
  topTone: ChromeTone;
}) {
  const lightTop = topTone === 'light';
  const buttonClass = (kind: 'like' | 'dislike') => {
    const active = vote === kind;
    if (active && kind === 'like') return 'bg-white text-emerald-600';
    if (active && kind === 'dislike') return 'bg-white text-rose-600';
    return lightTop
      ? 'text-black/70 hover:bg-black/8 active:bg-black/14'
      : 'text-white/72 hover:bg-white/12 active:bg-white/18';
  };

  const node = (
    <div className={`fixed right-4 top-[calc(env(safe-area-inset-top,0px)+86px)] z-[31] inline-flex items-center gap-1 rounded-full p-1 backdrop-blur-md lg:top-6 ${lightTop ? 'border border-black/25 bg-white/70' : 'border border-white/25 bg-black/18'}`}>
      <button
        type="button"
        disabled={busy}
        aria-label="Dislike profile"
        aria-pressed={vote === 'dislike'}
        onClick={() => onVote('dislike')}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-55 ${buttonClass('dislike')}`}
      >
        <ThumbsDown size={17} />
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label="Like profile"
        aria-pressed={vote === 'like'}
        onClick={() => onVote('like')}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition disabled:opacity-55 ${buttonClass('like')}`}
      >
        <ThumbsUp size={17} />
      </button>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(node, document.body) : null;
}

function CanactPagesProfileUI({
  userProfile,
  isSelf,
  isVerified,
  age,
  locationText,
  supportersCount,
  tab,
  setTab,
  posts,
  reels,
  polls,
  ratemes,
  onSupport,
  onBookmark,
  onProfileVote,
  profileVote,
  profileVoteBusy,
  friendStatus,
}: {
  userProfile: UserProfile;
  isSelf: boolean;
  isVerified: boolean;
  age?: number;
  locationText: string;
  supportersCount: number;
  tab: ProfileTabKey;
  setTab: (tab: ProfileTabKey) => void;
  posts: WhaPost[];
  reels: ReelItem[];
  polls: Poll[];
  ratemes: RateMeSession[];
  onSupport: () => Promise<void>;
  onBookmark: () => Promise<void>;
  onProfileVote: (kind: 'like' | 'dislike') => Promise<void>;
  profileVote?: 'like' | 'dislike';
  profileVoteBusy: boolean;
  friendStatus: 'none' | 'requested' | 'incoming' | 'friends';
}) {
  const activeTab = tab === 'rateme' ? 'polls' : tab;
  const displayName = String(userProfile.fullName || userProfile.firstName || userProfile.email || 'Canact user');
  const heroSrc = profileHeroImage(userProfile, posts, reels, ratemes);
  const chromeTone = useAdaptiveProfileChrome(heroSrc);
  const nameLines = splitProfileName(displayName);
  const role = userProfile.tags?.[0] || locationText || `${(userProfile.rating ?? 0).toFixed(1)} rating`;
  const supportLabel = isSelf
    ? 'Edit'
    : friendStatus === 'friends'
      ? 'Friends'
      : friendStatus === 'requested'
        ? 'Requested'
        : friendStatus === 'incoming'
          ? 'Accept'
          : 'Support';
  const thumbs = profileThumbnails(activeTab, posts, reels, polls, ratemes);

  return (
    <div className="fixed inset-0 z-[25] overflow-y-auto bg-black">
      <div className="relative min-h-[var(--canact-viewport-height)] overflow-hidden bg-black">
        {heroSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroSrc} alt={displayName} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,rgba(255,107,122,0.55),transparent_32%),linear-gradient(145deg,#1c1c1f,#050505)]" />
        )}

        <div
          className="absolute inset-0 transition-opacity duration-500"
          style={{
            background: 'linear-gradient(180deg, rgb(var(--canact-profile-top-rgb, 255 255 255) / 0.30) 0%, rgb(var(--canact-profile-top-rgb, 255 255 255) / 0.20) 20%, rgb(var(--canact-profile-top-rgb, 255 255 255) / 0.08) 42%, rgb(0 0 0 / 0.10) 55%, rgb(0 0 0 / 0.56) 78%, rgb(0 0 0 / 0.94) 100%)',
          }}
        />

        {!isSelf ? (
          <ProfileVotePill vote={profileVote} busy={profileVoteBusy} onVote={onProfileVote} topTone={chromeTone.top} />
        ) : null}

        <div className="absolute bottom-0 left-0 right-0 z-10 px-5 pb-[calc(var(--canact-floating-bottom-clearance)_+_24px)]">
          <div className="mb-3">
            <div className="w-fit rounded-full p-[2.5px]" style={{ background: 'linear-gradient(135deg, #FF6B7A, #FFB3B8)' }}>
              <div className="h-[46px] w-[46px] overflow-hidden rounded-full ring-[2px] ring-black/30">
                <Avatar src={userProfile.photoURL} name={displayName} size={46} />
              </div>
            </div>
          </div>

          <div className="mb-4">
            <h1 className="text-[42px] font-extrabold leading-none text-white" style={{ letterSpacing: -1.5 }}>
              {nameLines.map((line) => <span key={line} className="block break-words">{line}</span>)}
            </h1>
            <p className="mt-2 text-xs text-white/75">
              iAm @{profileSlug(userProfile)} &nbsp;·&nbsp; {role}{age ? ` · ${age}` : ''}{isVerified ? ' · Verified' : ''}
            </p>
            {userProfile.bio ? (
              <p className="mt-3 line-clamp-2 max-w-[88vw] whitespace-pre-wrap text-xs leading-5 text-white/65">{userProfile.bio}</p>
            ) : null}
          </div>

          <div className="mb-5 flex items-center gap-3">
            <div className="flex items-center">
              <BrandDot color="#e11a1a" letter="C" />
              <div className="-ml-2"><BrandDot color="#0b3d91" letter="A" /></div>
              <div className="-ml-2"><BrandDot color="#1a4f8c" letter="N" /></div>
            </div>
            <div>
              <div className="text-sm font-bold leading-none text-white">{supportersCount.toLocaleString()}</div>
              <div className="text-[10px] text-white/45">Supporters</div>
            </div>

            <div className="ml-auto flex gap-2">
              {isSelf ? (
                <Link href="/edit-profile" prefetch className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
                  {supportLabel}
                </Link>
              ) : (
                <button type="button" onClick={onSupport} className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
                  {supportLabel}
                </button>
              )}
              <Link href={isSelf ? '/profile/settings' : `/inbox/${userProfile.uid}`} prefetch className="rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm">
                {isSelf ? 'Settings' : 'Chat'}
              </Link>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-8 border-b border-white/15 pb-3">
            {([
              { id: 'posts', Icon: ShoppingBag },
              { id: 'reels', Icon: Video },
              { id: 'polls', Icon: AlignLeft },
            ] as const).map(({ id, Icon }) => {
              const active = activeTab === id;
              return (
                <button key={id} type="button" onClick={() => setTab(id)} className="relative flex items-center justify-center">
                  <Icon
                    size={18}
                    strokeWidth={active ? 2.2 : 1.6}
                    style={{ color: active ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'color 0.2s' }}
                  />
                  {active ? <span className="absolute -bottom-3 left-0 right-0 h-[2px] rounded-full bg-white" /> : null}
                </button>
              );
            })}
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {thumbs.length ? thumbs.map((thumb) => (
              <Link
                key={thumb.id}
                href={thumb.href}
                prefetch
                className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl border border-white/20 bg-white/10 active:scale-95 transition"
              >
                {thumb.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb.src} alt={thumb.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : thumb.video ? (
                  <video src={thumb.video} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-white/10 p-2 text-center text-[10px] font-semibold leading-tight text-white/75">
                    <span className="line-clamp-4">{thumb.label}</span>
                  </div>
                )}
              </Link>
            )) : (
              <div className="flex h-[76px] min-w-[180px] items-center justify-center rounded-xl border border-white/20 bg-white/10 px-4 text-center text-xs font-semibold text-white/60">
                No content yet
              </div>
            )}
          </div>
        </div>
      </div>
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
    <div className="inline-flex min-w-0 items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 text-sm text-ink/75">
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

/** Single cell of the clean self-profile stats card (Likes / Friends /
 *  Rating). Mirrors the rounded white card with three centred columns
 *  shown in the reference design. */
function SelfStatCell({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-2">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-brand">
        {icon}
      </span>
      <div className="text-2xl font-black leading-none text-ink">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink/55">{label}</div>
    </div>
  );
}

/** Profile content tabs (Posts / Reels / Polls / Rate Me) and their
 *  associated grids. Extracted so the new clean self hero and the existing
 *  other-user card can share exactly the same content rendering without
 *  any logic drift. */
function ProfileTabsCard({
  tab,
  setTab,
  posts,
  reels,
  polls,
  ratemes,
  isSelf,
  uid,
  userUid,
}: {
  tab: 'posts' | 'reels' | 'polls' | 'rateme';
  setTab: (t: 'posts' | 'reels' | 'polls' | 'rateme') => void;
  posts: WhaPost[];
  reels: ReelItem[];
  polls: Poll[];
  ratemes: RateMeSession[];
  isSelf: boolean;
  uid: string;
  userUid?: string;
}) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="grid grid-cols-4 border-b border-line">
        {([
          { id: 'posts', label: 'Posts', Icon: Camera, count: posts.length },
          { id: 'reels', label: 'Reels', Icon: Film, count: reels.length },
          { id: 'polls', label: 'Polls', Icon: BarChart3, count: polls.length },
          { id: 'rateme', label: 'Rate Me', Icon: Heart, count: ratemes.length },
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
                <div key={p.id} className="relative aspect-square bg-brand-light">
                  <Link href={`/post/${p.id}`} className="block h-full w-full overflow-hidden">
                    {cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cover} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand-light to-white p-2 text-center text-[11px] font-semibold leading-tight text-ink/70">
                        <span className="line-clamp-5">{p.text || 'Untitled'}</span>
                      </div>
                    )}
                    {p.mediaUrls && p.mediaUrls.length > 1 ? (
                      <span className={`absolute top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white ${isSelf ? 'left-1.5' : 'right-1.5'}`}>
                        {p.mediaUrls.length}
                      </span>
                    ) : null}
                  </Link>
                  {isSelf ? (
                    <div className="absolute right-1.5 top-1.5 z-10">
                      <PostMenu isOwner variant="dark" onDelete={async () => { await deletePost(p.id, p.uid); }} />
                    </div>
                  ) : null}
                </div>
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
              <div key={r.id} className="relative aspect-[9/16] bg-black">
                <Link href="/reels" className="block h-full w-full overflow-hidden">
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
                  <span className={`absolute top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold text-white ${isSelf ? 'left-1.5' : 'right-1.5'}`}>
                    <Film size={10} className="inline -mt-0.5 mr-0.5" />
                  </span>
                </Link>
                {isSelf ? (
                  <div className="absolute right-1.5 top-1.5 z-10">
                    <PostMenu isOwner variant="dark" onDelete={async () => { await deleteReel(r.id, r.uid); }} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )
      ) : tab === 'polls' ? (
        polls.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink/15 text-ink/40">
              <BarChart3 size={20} />
            </span>
            <div className="text-sm font-bold text-ink">No polls yet</div>
            <div className="text-xs text-muted">{isSelf ? 'Tap + to start a poll.' : 'Nothing here yet.'}</div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {polls.map((p) => {
              const opts = Array.isArray(p.options) ? p.options : [];
              const total = opts.reduce((s, o) => s + (o.votes ?? 0), 0);
              const ended = p.endsAt < Date.now();
              return (
                <div key={p.id} className="relative px-4 py-3">
                  <Link href={`/poll/${p.id}`} className="flex gap-3 pr-10">
                    {p.photoURL ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.photoURL} alt="" loading="lazy" decoding="async" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-ink/55">
                        <BarChart3 size={12} className="text-brand" />
                        <span>{ended ? 'Ended' : 'Active'}</span>
                        <span>·</span>
                        <span>{total} votes</span>
                      </div>
                      <div className="mt-1 text-sm font-bold text-ink line-clamp-2">{p.question}</div>
                      {opts.length > 0 ? (
                        <div className="mt-1 text-[11px] text-ink/55 line-clamp-1">
                          {opts.map((o) => o.text).join(' · ')}
                        </div>
                      ) : null}
                    </div>
                  </Link>
                  {isSelf ? (
                    <div className="absolute right-3 top-3">
                      <PostMenu
                        isOwner
                        onDelete={async () => {
                          try {
                            await deletePoll(p.id, uid);
                            toast('Poll deleted', 'success');
                          } catch (e: any) {
                            toast(e?.message ?? 'Could not delete poll', 'error');
                          }
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )
      ) : (
        ratemes.length === 0 || !userUid ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-ink/15 text-ink/40">
              <Heart size={20} />
            </span>
            <div className="text-sm font-bold text-ink">No Rate Me yet</div>
            <div className="text-xs text-muted">{isSelf ? 'Tap + to start one.' : 'Nothing here yet.'}</div>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {ratemes.map((s) => (
              <ProfileRateMeCard key={s.id} sess={s} myUid={userUid} />
            ))}
          </div>
        )
      )}
    </Card>
  );
}

/** Profile-page Rate Me card. Mirrors the wall-card design (full-bleed
 *  photo, pastel up/down vote pills, share-only action row) and gracefully
 *  flips to a results-only layout once the session has ended so the
 *  finished round stays visible without allowing further votes. */
function ProfileRateMeCard({ sess, myUid }: { sess: RateMeSession; myUid: string }) {
  const isOwner = sess.uid === myUid;
  const ended = sess.endsAt <= Date.now();
  // Optimistic overlay so the vote pill flips + counters bump
  // immediately on tap instead of waiting for the RTDB transaction
  // round-trip. Cleared once the server snapshot confirms our vote.
  const [optimistic, setOptimistic] = useState<{ kind: 'like' | 'dislike'; prev: 'like' | 'dislike' | undefined } | null>(null);
  const serverMy = sess.votes?.[myUid];
  useEffect(() => {
    if (optimistic && serverMy === optimistic.kind) setOptimistic(null);
  }, [serverMy, optimistic]);
  const my = optimistic ? optimistic.kind : serverMy;
  const locked = ended || isOwner || !!my;
  let likes = sess.likes ?? 0;
  let dislikes = sess.dislikes ?? 0;
  if (optimistic) {
    if (optimistic.prev === 'like') likes = Math.max(0, likes - 1);
    if (optimistic.prev === 'dislike') dislikes = Math.max(0, dislikes - 1);
    if (optimistic.kind === 'like') likes += 1; else dislikes += 1;
  }
  const total = likes + dislikes;
  const upPct = total ? Math.round((likes / total) * 100) : 0;
  const downPct = total ? 100 - upPct : 0;
  const cast = (kind: 'like' | 'dislike') => {
    if (locked) return;
    setOptimistic({ kind, prev: serverMy });
    voteRateMe(sess.id, myUid, kind).catch((e: any) => {
      setOptimistic(null);
      toast(e?.message ?? 'Could not vote', 'error');
    });
  };
  const remaining = sess.endsAt - Date.now();
  const timeLabel = ended
    ? 'Voting closed'
    : remaining > 3600 * 1000
      ? `${Math.ceil(remaining / 3_600_000)}h left`
      : `${Math.max(1, Math.ceil(remaining / 60_000))}m left`;
  return (
    <article className="relative overflow-hidden rounded-[24px] border border-[#F1D7DC] bg-white">
      {isOwner ? (
        <div className="absolute right-3 top-3 z-10">
          <PostMenu isOwner onDelete={async () => { await deleteRateMeSession(sess.id, sess.uid); }} />
        </div>
      ) : null}
      <Link href={`/rateme/${sess.id}`} prefetch className="block">
        <div className={`flex items-center justify-between px-4 pt-4 ${isOwner ? 'pr-14' : ''}`}>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Rate Me</div>
          <div className="text-[11px] font-semibold text-muted">{timeLabel}</div>
        </div>
        {sess.photoURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sess.photoURL}
            alt=""
            loading="lazy"
            decoding="async"
            className="mt-3 block w-full max-h-[480px] object-cover"
          />
        ) : null}
      </Link>
      {locked ? (
        <Link href={`/rateme/${sess.id}`} prefetch className="block px-4 pt-3">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-ink/60">
            <span className="text-rose-500">Down · {dislikes}</span>
            <span className="text-emerald-600">Up · {likes}</span>
          </div>
          <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-ink/5">
            <div style={{ width: `${downPct}%` }} className="bg-rose-300" />
            <div style={{ width: `${upPct}%` }} className="bg-emerald-300" />
          </div>
          <div className="mt-1 pb-3 text-[11px] text-muted">
            {total === 0 ? 'No votes' : `${total} vote${total === 1 ? '' : 's'} · ${upPct}% positive`}
          </div>
        </Link>
      ) : (
        <div className="px-4 pt-3 pb-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cast('dislike')}
            aria-pressed={my === 'dislike'}
            className={`inline-flex items-center justify-center gap-2 rounded-full px-3 h-11 text-sm font-extrabold transition border ${
              my === 'dislike'
                ? 'bg-rose-500 text-white border-rose-500'
                : 'bg-rose-50 text-rose-600 border-rose-100 active:bg-rose-100'
            }`}
          >
            <ThumbsDown size={16} /> Down vote · {dislikes}
          </button>
          <button
            type="button"
            onClick={() => cast('like')}
            aria-pressed={my === 'like'}
            className={`inline-flex items-center justify-center gap-2 rounded-full px-3 h-11 text-sm font-extrabold transition border ${
              my === 'like'
                ? 'bg-emerald-500 text-white border-emerald-500'
                : 'bg-emerald-50 text-emerald-700 border-emerald-100 active:bg-emerald-100'
            }`}
          >
            <ThumbsUp size={16} /> Up vote · {likes}
          </button>
        </div>
      )}
    </article>
  );
}
