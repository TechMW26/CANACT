'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FastAverageColor } from 'fast-average-color';
import { onValue, ref } from 'firebase/database';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AttrKey, CARD_KEYS, CARD_LABELS, CardKey, Poll, RateMeSession, ReelItem, UserProfile, WhaPost } from '@/lib/types';
import { setLikeDislike, giveCard, takeBackCard, type AttributeVoteMap } from '@/lib/services/votes';
import { deletePost, listenUserWhaPosts } from '@/lib/services/wha';
import { deleteReel, listenUserReels } from '@/lib/services/reels';
import { listenUserPolls, deletePoll } from '@/lib/services/poll';
import { deleteRateMeSession, listenUserRateMe, voteRateMe } from '@/lib/services/rateme';
import { toast } from '@/components/Toaster';
import { uploadMedia } from '@/lib/uploadMedia';
import { PostMenu } from '@/components/PostMenu';
import { ProfileRecognitionFolders, AttributePairSlider } from '@/components/ProfileRecognitionFolders';
import { listenFavourites, requestFollow } from '@/lib/services/favourites';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  listenFriendStatus,
  sendFriendRequest,
  unfriend,
} from '@/lib/services/friends';
import { calculateCanactScore } from '@/lib/canactScore';
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
  const viewingSelf = isSelf || user?.uid === uid;
  const [u, setU] = useState<UserProfile | null>(null);
  const [myVote, setMyVote] = useState<{ main?: 'like' | 'dislike'; attrs?: AttributeVoteMap; cards?: Record<string, number> } | null>(null);
  const [friendStatus, setFriendStatus] = useState<'none' | 'requested' | 'incoming' | 'friends'>('none');
  const [isFavourite, setIsFavourite] = useState(false);
  const [profileVoteBusy, setProfileVoteBusy] = useState(false);

  useEffect(() => {
    return onValue(ref(db, `users/${uid}`), (snapshot) => {
      const value = snapshot.val() as UserProfile | null;
      // The Firebase path is authoritative. Older records may have no uid
      // field (or a stale copied value), which must never be used as a vote target.
      setU(value ? { ...value, uid } : null);
    });
  }, [uid]);

  useEffect(() => {
    if (!user || viewingSelf) return;
    return onValue(ref(db, `votes/${uid}/${user.uid}`), (s) => setMyVote(s.val() ?? {}));
  }, [uid, user?.uid, viewingSelf]);

  useEffect(() => {
    if (!user || viewingSelf) return;
    return listenFriendStatus(user.uid, uid, setFriendStatus);
  }, [uid, user?.uid, viewingSelf]);

  // Detect whether this profile is in the viewer's favourites (gold ring).
  useEffect(() => {
    if (!user || viewingSelf) return;
    return listenFavourites(user.uid, (uids) => setIsFavourite(uids.includes(uid)));
  }, [uid, user?.uid, viewingSelf]);

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

  if (!u) {
    return (
      <div className="space-y-4">
        <Card className="overflow-hidden border border-[#E4E7E2]">
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

  const handleCard = async (c: CardKey) => {
    if (viewingSelf || !user) return;
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

  const handleProfileSupport = async () => {
    if (viewingSelf || !user || !me) return;
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
        toast('Friend request sent', 'success');
        return;
      }
      if (friendStatus === 'friends') {
        await requestFollow(user.uid, me.fullName, uid);
        toast('Added to favourites', 'success');
        return;
      }
      if (friendStatus === 'requested') {
        await cancelFriendRequest(user.uid, uid);
        toast('Request cancelled', 'success');
        return;
      }
    } catch (error: any) {
      toast(error?.message ?? 'Could not update', 'error');
    }
  };

  const handleProfileBookmark = async () => {
    if (viewingSelf || !user || !me) return;
    try {
      await requestFollow(user.uid, me.fullName, uid);
      toast('Request sent', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not send request', 'error');
    }
  };

  const handleProfileVote = async (kind: 'like' | 'dislike') => {
    if (viewingSelf || !user || profileVoteBusy) return;
    const previousVote = myVote?.main;
    setProfileVoteBusy(true);
    setMyVote((current) => ({ ...(current ?? {}), main: kind }));
    try {
      await setLikeDislike(uid, user.uid, kind);
      toast(kind === 'like' ? 'Liked profile' : 'Disliked profile', 'success');
    } catch (error: any) {
      setMyVote((current) => ({ ...(current ?? {}), main: previousVote }));
      const msg = error?.message || '';
      if (msg.startsWith('COOLDOWN:')) {
        const remaining = Number(msg.split(':')[1]) || 0;
        const hours = Math.max(1, Math.ceil(remaining / 3_600_000));
        toast(`Wait ${hours}h before voting on this profile again`, 'error');
      } else {
        toast(msg || 'Could not update vote', 'error');
      }
    } finally {
      setProfileVoteBusy(false);
    }
  };

  const score = calculateCanactScore(u);

  return (
    <CanactPagesProfileUI
      userProfile={u}
      isSelf={viewingSelf}
      isVerified={isVerified}
      age={age}
      locationText={locationText}
      canactScore={score}
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
      isFavourite={isFavourite}
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
  return userProfile.coverPhoto
    || userProfile.photoURL
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
    return 'text-white/80 hover:bg-white/12 active:bg-white/18';
  };

  return (
    <div className="absolute bottom-3 left-3 z-10 inline-flex items-center gap-1 rounded-full border border-white/25 bg-black/18 p-1 backdrop-blur-md">
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
}

function CanactPagesProfileUI({
  userProfile,
  isSelf,
  isVerified,
  age,
  locationText,
  canactScore,
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
  isFavourite,
}: {
  userProfile: UserProfile;
  isSelf: boolean;
  isVerified: boolean;
  age?: number;
  locationText: string;
  canactScore: ReturnType<typeof calculateCanactScore>;
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
  isFavourite: boolean;
}) {
  const { updateMyProfile } = useAuth();
  const coverFileRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [attrsSheetOpen, setAttrsSheetOpen] = useState(false);
  const activeTab = tab === 'rateme' ? 'polls' : tab;
  const displayName = String(userProfile.fullName || userProfile.firstName || userProfile.email || 'Canact user');
  const heroSrc = profileHeroImage(userProfile, posts, reels, ratemes);
  const chromeTone = useAdaptiveProfileChrome(heroSrc);
  const nameLines = splitProfileName(displayName);
  const role = userProfile.tags?.[0] || locationText || `${(userProfile.rating ?? 0).toFixed(1)} rating`;
  const supportLabel = isSelf
    ? 'Edit'
    : isFavourite
      ? '★ Favourited'
      : friendStatus === 'friends'
        ? 'Add to Favourites'
        : friendStatus === 'requested'
          ? 'Requested'
          : friendStatus === 'incoming'
            ? 'Accept'
            : 'Add Friend';
  // Gold button for favourite-related states
  const isGoldButton = !isSelf && (isFavourite || friendStatus === 'friends');
  const thumbs = profileThumbnails(activeTab, posts, reels, polls, ratemes);

  const onCoverPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Please select an image', 'error');
    const previousUrl = userProfile.coverPhoto ?? heroSrc;
    setCoverBusy(true);
    try {
      const blob = new Blob([f], { type: f.type });
      const { url } = await uploadMedia(blob, { kind: 'cover', uid: userProfile.uid });
      await updateMyProfile({ coverPhoto: url });
      if (previousUrl && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try { navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls: [previousUrl] }); } catch { /* ignore */ }
      }
      toast('Cover photo updated', 'success');
    } catch (err: any) {
      toast(err?.message ?? 'Could not upload cover', 'error');
    } finally {
      setCoverBusy(false);
      if (coverFileRef.current) coverFileRef.current.value = '';
    }
  };

  return (
    <div className="-mx-[2vw] min-h-[calc(var(--canact-viewport-height)-170px)] overflow-hidden bg-[#faf8f2] pb-8">
      <div className="relative h-[320px] overflow-hidden bg-[radial-gradient(circle_at_20%_10%,#9fd0b3,transparent_35%),linear-gradient(135deg,#164d3e,#68a48d)]">
        {heroSrc ? <img src={heroSrc} alt="" className="pointer-events-none h-full w-full object-cover object-center opacity-55 mix-blend-luminosity" /> : null}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#173f34]/45 to-transparent" />
        {isSelf ? (
          <>
            <input ref={coverFileRef} type="file" accept="image/*" className="hidden" onChange={onCoverPick} />
            <button type="button" disabled={coverBusy} onClick={() => coverFileRef.current?.click()} className="absolute bottom-3 right-3 z-10 flex h-9 items-center gap-1.5 rounded-full bg-black/30 px-3 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/45 disabled:opacity-55">
              <Camera size={14} /> {coverBusy ? 'Uploading…' : 'Edit cover'}
            </button>
          </>
        ) : null}
      </div>

      <section className="relative px-5 pb-5 text-center">
        {/* Avatar with score ring + like/dislike buttons — third-party profiles */}
        {isSelf ? (
          <div className={`mx-auto -mt-[62px] h-[124px] w-[124px] overflow-hidden rounded-full border-[7px] bg-white ${isFavourite ? 'border-[#E8B830] shadow-[0_0_18px_rgba(232,184,48,0.35)]' : 'border-[#faf8f2]'}`}>
            <Avatar src={userProfile.photoURL} name={displayName} size={110} />
          </div>
        ) : (
          <div className="relative mx-auto -mt-[120px] flex items-center justify-center" style={{ width: 280, height: 280 }}>
            {/* Score progress ring — exactly on the avatar border */}
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 250 250">
              <circle cx="125" cy="125" r="115" fill="none" stroke="#e8e5df" strokeWidth="8" />
              <circle
                cx="125" cy="125" r="115"
                fill="none"
                stroke={canactScore.label === 'TRUST' ? '#34d399' : canactScore.label === 'GOOD' ? '#4ade80' : canactScore.label === 'FAIR' ? '#fbbf24' : '#f87171'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 115}`}
                strokeDashoffset={`${2 * Math.PI * 115 * (1 - Math.max(0.04, Math.min(1, canactScore.score / Math.max(canactScore.max, 1))))}`}
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>

            {/* The image underlaps the inner half of the score stroke. This
                avoids a separator seam at every device pixel ratio. */}
            <button
              type="button"
              onClick={() => setAttrsSheetOpen(true)}
              className={`relative z-10 flex h-[254px] w-[254px] items-center justify-center overflow-hidden rounded-full bg-white transition-transform active:scale-95 ${isFavourite ? 'ring-4 ring-inset ring-[#E8B830] shadow-[0_0_24px_rgba(232,184,48,0.35)]' : ''}`}
              aria-label={`View ${displayName}'s attributes`}
            >
              <Avatar src={userProfile.photoURL} name={displayName} size={254} />
            </button>

            {/* A local frosted lens keeps the score central without blurring
                the whole portrait. Difference blending automatically flips
                the glyphs for light and dark profile photos. */}
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <div className="flex w-[96px] flex-col items-center justify-center rounded-full aspect-square bg-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.34)] ring-1 ring-white/25 backdrop-blur-[14px] backdrop-saturate-150">
                <span className="mix-blend-difference text-[30px] font-black leading-none tracking-[-.05em] text-white">{canactScore.score}</span>
                <span className="mt-1 mix-blend-difference text-[9px] font-black uppercase tracking-[.16em] text-white">{canactScore.label}</span>
              </div>
            </div>

            {/* Vote controls sit on the lower circular radius. */}
            <button
              type="button"
              disabled={profileVoteBusy}
              aria-label="Dislike"
              aria-pressed={profileVote === 'dislike'}
              onClick={() => onProfileVote('dislike')}
              className={`absolute left-0 top-[72%] z-20 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-lg transition disabled:opacity-55 ${
                profileVote === 'dislike' ? 'bg-rose-500 text-white' : 'bg-white text-rose-500 hover:bg-rose-50'
              }`}
            >
              <ThumbsDown size={24} />
            </button>

            {/* Like button — mirrored on the lower-right radius. */}
            <button
              type="button"
              disabled={profileVoteBusy}
              aria-label="Like"
              aria-pressed={profileVote === 'like'}
              onClick={() => onProfileVote('like')}
              className={`absolute right-0 top-[72%] z-20 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white shadow-lg transition disabled:opacity-55 ${
                profileVote === 'like' ? 'bg-emerald-500 text-white' : 'bg-white text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <ThumbsUp size={24} />
            </button>
          </div>
        )}

        {/* Canact score badge — visible to everyone */}
        {isSelf && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-black/85 px-3 py-1.5 text-xs font-extrabold text-white shadow-lg">
          <span className={`h-2 w-2 rounded-full ${canactScore.label === 'TRUST' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]' : canactScore.label === 'GOOD' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : canactScore.label === 'FAIR' ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.5)]'}`} />
          <span>{canactScore.score}</span>
          <span className={`font-black ${canactScore.label === 'TRUST' ? 'text-emerald-400' : canactScore.label === 'GOOD' ? 'text-green-400' : canactScore.label === 'FAIR' ? 'text-amber-400' : 'text-red-400'}`}>{canactScore.label}</span>
        </div>
        )}

        <h1 className="mt-2 text-[28px] font-black tracking-[-.04em] text-ink">{displayName}{isVerified ? <span className="ml-2 align-middle text-lg text-brand">✓</span> : null}</h1>
        <p className="mt-1 text-sm font-medium text-ink/50">@{profileSlug(userProfile)} · {role}{age ? ` · ${age}` : ''}</p>
        {userProfile.bio ? <p className="mx-auto mt-3 max-w-sm whitespace-pre-wrap text-sm leading-6 text-ink/65">{userProfile.bio}</p> : null}

        <ProfileRecognitionFolders profile={userProfile} isSelf={isSelf} />

        <div className="mt-4 flex gap-3">
          {isSelf ? <Link href="/edit-profile" prefetch className="flex h-12 flex-1 items-center justify-center rounded-full bg-brand font-bold text-white">Edit profile</Link> : <button type="button" onClick={onSupport} className={`h-12 flex-1 rounded-full font-bold text-white transition ${isGoldButton ? 'bg-[#E8B830] shadow-[0_4px_16px_rgba(232,184,48,0.3)]' : 'bg-brand'}`}>{supportLabel}</button>}
          <Link href={isSelf ? '/profile/settings' : `/inbox/${userProfile.uid}`} prefetch className="flex h-12 flex-1 items-center justify-center rounded-full border border-brand bg-white font-bold text-brand">{isSelf ? 'Settings' : 'Message'}</Link>
        </div>

        <div className="mt-8 flex items-center justify-center gap-12 border-b border-line pb-3">
          {([{ id: 'posts', Icon: ShoppingBag }, { id: 'reels', Icon: Video }, { id: 'polls', Icon: AlignLeft }] as const).map(({ id, Icon }) => {
            const active = activeTab === id;
            return <button key={id} type="button" onClick={() => setTab(id)} className={`relative grid h-10 w-10 place-items-center ${active ? 'text-brand' : 'text-ink/30'}`}><Icon size={21} strokeWidth={active ? 2.4 : 1.7} />{active ? <span className="absolute -bottom-3 h-[3px] w-8 rounded-full bg-brand" /> : null}</button>;
          })}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {thumbs.length ? thumbs.map((thumb) => <Link key={thumb.id} href={thumb.href} prefetch className="aspect-square overflow-hidden rounded-[18px] bg-[#e7e1d1]">{thumb.src ? <img src={thumb.src} alt={thumb.label} loading="lazy" className="h-full w-full object-cover" /> : thumb.video ? <video src={thumb.video} muted playsInline className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center p-2 text-center text-xs font-bold text-brand">{thumb.label}</span>}</Link>) : <div className="col-span-3 rounded-[22px] bg-white px-5 py-10 text-sm font-semibold text-muted">No content yet</div>}
        </div>
      </section>

      {/* Attributes bottom-sheet — shows on avatar tap for third-party profiles */}
      {!isSelf && (
        <Sheet open={attrsSheetOpen} onClose={() => setAttrsSheetOpen(false)} title={`${displayName}'s attributes`}>
          <div className="flex flex-col gap-4">
            {userProfile.photoURL ? (
              <img src={userProfile.photoURL} alt={displayName} className="w-full h-auto aspect-square rounded-2xl object-cover bg-brand-light" />
            ) : (
              <div className="flex w-full aspect-square items-center justify-center rounded-2xl bg-brand-light text-5xl font-extrabold text-brand">
                {(displayName || '?')[0]?.toUpperCase()}
              </div>
            )}
            <div className="text-center">
              <div className="text-lg font-extrabold text-ink">{displayName}</div>
              <div className="text-sm text-ink/50">@{profileSlug(userProfile)}</div>
            </div>
            {[
              { pos: 'behaviour' as AttrKey, neg: 'rude' as AttrKey },
              { pos: 'reliability' as AttrKey, neg: 'unreliable' as AttrKey },
              { pos: 'civic_sense' as AttrKey, neg: 'uncivil' as AttrKey },
            ].map(({ pos, neg }) => (
              <AttributePairSlider
                key={pos}
                negative={neg}
                positive={pos}
                negativeCount={userProfile.attrs?.[neg] ?? 0}
                positiveCount={userProfile.attrs?.[pos] ?? 0}
                selectedValue={0}
                busy={false}
                cooldownMs={0}
                readOnly
                onCommit={() => {}}
              />
            ))}
            {(!userProfile.attrs || Object.values(userProfile.attrs).every((v) => !v)) && (
              <p className="text-center text-sm text-ink/40">No attributes yet.</p>
            )}
          </div>
        </Sheet>
      )}
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
    <article className="relative overflow-hidden rounded-[24px] border border-[#E4E7E2] bg-white">
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
