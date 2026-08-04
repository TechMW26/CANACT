'use client';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FastAverageColor } from 'fast-average-color';
import { onValue, ref } from 'firebase/database';
import { Card } from '@/components/Card';
import { Avatar, RatingPill } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Sheet';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { AttrKey, CARD_LABELS, CardKey, ConnectionCardGift, Poll, RateMeSession, ReelItem, StoryItem, UserProfile, WhaPost } from '@/lib/types';
import { setLikeDislike, giveCard, takeBackCard, type AttributeVoteMap } from '@/lib/services/votes';
import { deletePost, listenUserWhaPosts } from '@/lib/services/wha';
import { deleteReel, listenUserReels } from '@/lib/services/reels';
import { listenUserPolls, deletePoll } from '@/lib/services/poll';
import { deleteRateMeSession, listenUserRateMe, voteRateMe } from '@/lib/services/rateme';
import { deleteStory, listenUserStories } from '@/lib/services/stories';
import { toast } from '@/components/Toaster';
import { PostMenu } from '@/components/PostMenu';
import { ProfileRecognitionFolders } from '@/components/ProfileRecognitionFolders';
import { ProfileImageEditorSheet } from '@/components/ProfileImageEditorSheet';
import { MoodIcon } from '@/components/MoodIcon';
import { StoryViewer } from '@/components/StoryViewer';
import { listenFavourites, requestFollow } from '@/lib/services/favourites';
import { listenReceivedConnectionCards } from '@/lib/services/connectionCards';
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  listenFriendStatus,
  sendFriendRequest,
  unfriend,
} from '@/lib/services/friends';
import { useGeo } from '@/lib/useGeo';
import { haversineMeters } from '@/lib/utils';
import { calculateCanactScore } from '@/lib/canactScore';
import { lockPageScroll } from '@/lib/scrollLock';
import { uploadMedia } from '@/lib/uploadMedia';
import { getMoodDefinition } from '@/lib/moodTracker';
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
  HandHeart,
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
  Sparkles,
  Laugh,
  ShieldCheck,
  Smile,
  Zap,
} from '@/components/icons';

function isLocalhostLocationBypass() {
  if (typeof window === 'undefined') return false;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}

export function ProfileBody({ uid, isSelf }: { uid: string; isSelf: boolean }) {
  const { user, profile: me } = useAuth();
  const viewingSelf = isSelf || user?.uid === uid;
  const [u, setU] = useState<UserProfile | null>(null);
  const [myVote, setMyVote] = useState<{ main?: 'like' | 'dislike'; attrs?: AttributeVoteMap; cards?: Record<string, number> } | null>(null);
  const [friendStatus, setFriendStatus] = useState<'none' | 'requested' | 'incoming' | 'friends'>('none');
  const [isFavourite, setIsFavourite] = useState(false);
  const [profileVoteBusy, setProfileVoteBusy] = useState(false);
  const { coords: myCoords, error: locationError, retry: retryLocation } = useGeo();

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
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<ProfileTabKey>('posts');
  useEffect(() => {
    return listenUserWhaPosts(uid, setPosts);
  }, [uid]);
  useEffect(() => {
    return listenUserReels(uid, setReels);
  }, [uid]);
  useEffect(() => {
    return listenUserPolls(uid, setPolls);
  }, [uid]);
  useEffect(() => {
    return listenUserStories(uid, setStories);
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

  const theirLoc = (u as any).lastLocation as { lat?: number; lng?: number } | undefined;
  const bypassLocationGate = isLocalhostLocationBypass();
  const outOfRange = !bypassLocationGate && !viewingSelf && !!myCoords && !!theirLoc?.lat && !!theirLoc?.lng
    && haversineMeters(myCoords, { lat: theirLoc.lat!, lng: theirLoc.lng! }) > 15;
  const accessBlockReason: 'location' | 'range' | null = viewingSelf || bypassLocationGate
    ? null
    : !myCoords ? 'location' : outOfRange ? 'range' : null;

  return (
    <>
      <CanactPagesProfileUI
      userProfile={u}
      isSelf={viewingSelf}
      isVerified={isVerified}
      locationText={locationText}
      accessBlockReason={accessBlockReason}
      locationError={locationError}
      onRetryLocation={retryLocation}
      tab={tab}
      setTab={setTab}
      posts={posts}
      reels={reels}
      polls={polls}
      stories={stories}
      ratemes={ratemes}
      onOpenStory={setStoryViewerIndex}
      onSupport={handleProfileSupport}
      onBookmark={handleProfileBookmark}
      onProfileVote={handleProfileVote}
      profileVote={myVote?.main}
      profileVoteBusy={profileVoteBusy}
      friendStatus={friendStatus}
      isFavourite={isFavourite}
      />
      {storyViewerIndex !== null && stories[storyViewerIndex] && user && me ? (
        <StoryViewer
          stories={stories}
          startIndex={storyViewerIndex}
          meUid={user.uid}
          meName={me.fullName}
          mePhoto={me.photoURL}
          onClose={() => setStoryViewerIndex(null)}
          onDelete={async (authorUid, storyId) => {
            await deleteStory(authorUid, storyId);
            setStoryViewerIndex(null);
            toast('Story removed', 'success');
          }}
        />
      ) : null}
    </>
  );
}

type ProfileTabKey = 'posts' | 'stories' | 'reels' | 'polls' | 'rateme';

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
}: {
  vote?: 'like' | 'dislike';
  busy: boolean;
  onVote: (kind: 'like' | 'dislike') => Promise<void>;
}) {
  const buttonClass = (kind: 'like' | 'dislike') => {
    const active = vote === kind;
    if (active && kind === 'like') return 'bg-[#dcece4] text-[#1f6b55] shadow-[inset_0_0_0_1px_rgba(31,107,85,.12)]';
    if (active && kind === 'dislike') return 'bg-[#f6dfdc] text-[#a14f49] shadow-[inset_0_0_0_1px_rgba(161,79,73,.12)]';
    return 'bg-white text-[#35564d] hover:bg-[#f5f7f5] active:scale-95';
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      data-canact-profile-votes="true"
      className="fixed z-[58] inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/80 bg-white p-1.5 shadow-[0_12px_28px_rgba(23,63,52,.16)] lg:hidden"
      style={{
        left: 'calc(var(--canact-create-button-left, calc(100% - 50px)) + 38px)',
        bottom: 'calc(var(--canact-create-button-bottom, 12px) + 88px)',
      }}
      role="group"
      aria-label="Rate profile"
    >
      <button
        type="button"
        disabled={busy}
        aria-label="Like profile"
        aria-pressed={vote === 'like'}
        onClick={() => void onVote('like')}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition disabled:opacity-55 ${buttonClass('like')}`}
      >
        <ThumbsUp size={18} />
      </button>
      <button
        type="button"
        disabled={busy}
        aria-label="Dislike profile"
        aria-pressed={vote === 'dislike'}
        onClick={() => void onVote('dislike')}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-full transition disabled:opacity-55 ${buttonClass('dislike')}`}
      >
        <ThumbsDown size={18} />
      </button>
    </div>,
    document.body,
  );
}

function ConnectionOrbitIcon({ kind }: { kind: CardKey }) {
  if (kind === 'confidence') return <ShieldCheck size={19} />;
  if (kind === 'humour') return <Laugh size={19} />;
  if (kind === 'goodVibes') return <Smile size={19} />;
  if (kind === 'daring') return <Zap size={19} />;
  if (kind === 'cooperative') return <UsersIcon size={19} />;
  if (kind === 'understanding') return <Heart size={19} />;
  return <Sparkles size={19} />;
}

const CONNECTION_TRAITS: Record<CardKey, string> = {
  understanding: 'deeply understanding',
  humour: 'full of humour',
  goodVibes: 'uplifting',
  confidence: 'quietly confident',
  cooperative: 'easy to work with',
  intelligence: 'thoughtful and perceptive',
  creativity: 'imaginative',
  daring: 'brave when it matters',
};

function buildProfileInsight(profile: UserProfile, cards: ConnectionCardGift[]) {
  const cardCounts = new Map<CardKey, number>();
  for (const card of cards) cardCounts.set(card.kind, (cardCounts.get(card.kind) ?? 0) + 1);
  const leadingCards = Array.from(cardCounts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([kind]) => CONNECTION_TRAITS[kind]);
  const positiveSignals = [
    ['behaviour', 'kind in everyday moments'],
    ['reliability', 'someone people can rely on'],
    ['civic_sense', 'considerate of the community'],
  ] as const;
  const strongestSignal = positiveSignals
    .map(([key, copy]) => ({ copy, count: Number(profile.attrs?.[key]) || 0 }))
    .sort((left, right) => right.count - left.count)[0];

  if (leadingCards.length >= 2) return `${leadingCards[0]}, ${leadingCards[1]}, and recognised by their connections.`;
  if (leadingCards.length === 1 && strongestSignal?.count) return `${leadingCards[0]}, ${strongestSignal.copy}, and recognised by their connections.`;
  if (leadingCards.length === 1) return `${leadingCards[0]}, with connections beginning to tell their story.`;
  if (strongestSignal?.count) return `Known as ${strongestSignal.copy}, with more of their story still unfolding.`;
  return profile.bio?.trim() || 'Building meaningful connections, one genuine interaction at a time.';
}

function ProfileAttributeGauge({
  id,
  label,
  positive,
  negative,
}: {
  id: string;
  label: string;
  positive: number;
  negative: number;
}) {
  const total = positive + negative;
  const balance = total ? (positive - negative) / total : 0;
  const angle = balance * 72;
  const [displayAngle, setDisplayAngle] = useState(0);
  const neutral = total === 0 || positive === negative;
  const state = neutral ? 'Neutral' : balance > 0 ? `+${positive - negative}` : `${positive - negative}`;
  const needleColor = neutral ? '#8f8aa8' : balance > 0 ? '#6fa98d' : '#d58b82';

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDisplayAngle(angle));
    return () => cancelAnimationFrame(frame);
  }, [angle]);

  return (
    <div className="flex min-w-0 flex-col justify-center rounded-[20px] bg-white px-1 pb-3 pt-2.5 text-center shadow-[0_8px_18px_rgba(7,37,28,.12)]">
      <svg viewBox="0 0 120 72" className="mx-auto h-auto w-full max-w-[128px] overflow-visible" role="img" aria-label={`${label}: ${positive} positive, ${negative} negative, ${state}`}>
        <defs>
          <linearGradient id={`profile-gauge-${id}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#efb2aa" />
            <stop offset=".5" stopColor="#eee4c5" />
            <stop offset="1" stopColor="#afd9c2" />
          </linearGradient>
          <filter id={`profile-gauge-shadow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#173f34" floodOpacity=".13" />
          </filter>
        </defs>
        <path d="M15 59a45 45 0 0 1 90 0" fill="none" stroke="#eeeae0" strokeWidth="11" strokeLinecap="round" />
        <path d="M15 59a45 45 0 0 1 90 0" fill="none" stroke={`url(#profile-gauge-${id})`} strokeWidth="8" strokeLinecap="round" opacity=".96" />
        <path d="M60 13v6" stroke="#d1caba" strokeWidth="2" strokeLinecap="round" />
        <g style={{ transform: `rotate(${displayAngle}deg)`, transformOrigin: '60px 59px', transition: 'transform 720ms cubic-bezier(.2,.9,.25,1.2)' }} filter={`url(#profile-gauge-shadow-${id})`}>
          <path d="M57.7 58.5 60 25l2.3 33.5Z" fill={needleColor} style={{ transition: 'fill 360ms ease' }} />
        </g>
        <circle cx="60" cy="59" r="6" fill={needleColor} stroke="#fffdf8" strokeWidth="2.5" style={{ transition: 'fill 360ms ease' }} />
      </svg>
      <strong className="-mt-0.5 block truncate text-[11px] font-black text-[#173f34] sm:text-[12px]">{label}</strong>
    </div>
  );
}

function CanactPagesProfileUI({
  userProfile,
  isSelf,
  isVerified,
  locationText,
  tab,
  setTab,
  posts,
  reels,
  polls,
  stories,
  ratemes,
  onOpenStory,
  onSupport,
  onBookmark,
  onProfileVote,
  profileVote,
  profileVoteBusy,
  friendStatus,
  isFavourite,
  accessBlockReason,
  locationError,
  onRetryLocation,
}: {
  userProfile: UserProfile;
  isSelf: boolean;
  isVerified: boolean;
  locationText: string;
  accessBlockReason: 'location' | 'range' | null;
  locationError: string | null;
  onRetryLocation: () => void;
  tab: ProfileTabKey;
  setTab: (tab: ProfileTabKey) => void;
  posts: WhaPost[];
  reels: ReelItem[];
  polls: Poll[];
  stories: StoryItem[];
  ratemes: RateMeSession[];
  onOpenStory: (index: number) => void;
  onSupport: () => Promise<void>;
  onBookmark: () => Promise<void>;
  onProfileVote: (kind: 'like' | 'dislike') => Promise<void>;
  profileVote?: 'like' | 'dislike';
  profileVoteBusy: boolean;
  friendStatus: 'none' | 'requested' | 'incoming' | 'friends';
  isFavourite: boolean;
}) {
  const { updateMyProfile } = useAuth();
  const [attrsSheetOpen, setAttrsSheetOpen] = useState(false);
  const [receivedConnections, setReceivedConnections] = useState<ConnectionCardGift[]>([]);
  const profilePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [profilePhotoEditorOpen, setProfilePhotoEditorOpen] = useState(false);
  const [profilePhotoBusy, setProfilePhotoBusy] = useState(false);
  const activeTab = tab === 'rateme' ? 'polls' : tab;
  const displayName = String(userProfile.fullName || userProfile.firstName || userProfile.email || 'Canact user');
  useAdaptiveProfileChrome(null);
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
  const thumbs = activeTab === 'stories' ? [] : profileThumbnails(activeTab, posts, reels, polls, ratemes);
  const blurred = accessBlockReason !== null;
  const connectionHighlights = useMemo(() => {
    const grouped = new Map<CardKey, { kind: CardKey; count: number; latest: number }>();
    for (const card of receivedConnections) {
      const current = grouped.get(card.kind);
      if (current) {
        current.count += 1;
        current.latest = Math.max(current.latest, card.sentAt);
      } else {
        grouped.set(card.kind, { kind: card.kind, count: 1, latest: card.sentAt });
      }
    }
    return Array.from(grouped.values())
      .sort((left, right) => right.count - left.count || right.latest - left.latest)
      .slice(0, 4);
  }, [receivedConnections]);
  const profileInsight = useMemo(() => buildProfileInsight(userProfile, receivedConnections), [receivedConnections, userProfile]);
  const scoreSummary = useMemo(() => calculateCanactScore(userProfile), [userProfile]);
  const helpCount = Math.max(0, (userProfile.helpStats?.resolved ?? 0) + (userProfile.helpStats?.confirmed ?? 0));
  const currentMood = getMoodDefinition(userProfile.currentMood?.kind);
  const scoreProgress = Math.max(0, Math.min(100,
    (scoreSummary.score / Math.max(1, scoreSummary.max)) * 100,
  ));

  useEffect(() => listenReceivedConnectionCards(userProfile.uid, setReceivedConnections), [userProfile.uid]);

  const closeProfilePhotoEditor = () => {
    if (profilePhotoBusy) return;
    setProfilePhotoEditorOpen(false);
    setProfilePhotoFile(null);
    if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
  };

  const pickProfilePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      event.target.value = '';
      toast('Choose an image for your profile photo', 'error');
      return;
    }
    setProfilePhotoFile(file);
    setProfilePhotoEditorOpen(true);
  };

  const applyProfilePhoto = async (blob: Blob) => {
    const previousUrl = userProfile.photoURL;
    setProfilePhotoBusy(true);
    try {
      const { url } = await uploadMedia(blob, { kind: 'avatar', uid: userProfile.uid });
      await updateMyProfile({ photoURL: url });
      if (previousUrl && typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) {
        try { navigator.serviceWorker.controller.postMessage({ type: 'INVALIDATE_MEDIA', urls: [previousUrl] }); } catch { /* best effort */ }
      }
      setProfilePhotoEditorOpen(false);
      setProfilePhotoFile(null);
      if (profilePhotoInputRef.current) profilePhotoInputRef.current.value = '';
      toast('Profile photo updated', 'success');
    } catch (error: any) {
      toast(error?.message || 'Could not update profile photo', 'error');
    } finally {
      setProfilePhotoBusy(false);
    }
  };

  return (
    <div className="relative -mx-[2vw] min-h-[calc(var(--canact-viewport-height)-170px)] overflow-hidden bg-[#faf8f2] pb-8">
      <div className={blurred ? 'pointer-events-none select-none blur-[12px] opacity-50' : ''}>
      <section className="relative mx-auto w-full max-w-[440px] px-5 pb-5 text-center">
        <div className="relative -mx-5 rounded-b-[34px] bg-[#1f6b55] px-5 pb-5 pt-[calc(var(--canact-header-top-inset,0px)+78px+1em)] shadow-[0_14px_30px_rgba(22,67,53,.16)] lg:pt-5">
        <div className="relative mx-auto h-[228px] w-full max-w-[330px]">
          {connectionHighlights.length ? (
            <svg className="pointer-events-none absolute inset-x-4 top-0 h-[190px] w-auto text-white/40" viewBox="0 0 328 222" aria-hidden="true">
              {[
                'M58 46C95 45 112 61 135 90',
                'M270 46C232 45 216 61 193 90',
                'M47 158C92 158 108 143 134 128',
                'M281 158C236 158 220 143 194 128',
              ].slice(0, connectionHighlights.length).map((path) => (
                <path key={path} d={path} fill="none" stroke="currentColor" strokeWidth="1.25" strokeDasharray="3 4" />
              ))}
            </svg>
          ) : null}

          {connectionHighlights.map((item, index) => {
            const positions = ['left-0 top-1', 'right-0 top-1', 'left-0 top-[52%]', 'right-0 top-[52%]'];
            return (
              <button key={item.kind} type="button" onClick={() => document.getElementById(`connection-cards-${userProfile.uid}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className={`absolute z-20 grid w-[68px] place-items-center gap-1 ${positions[index]}`} aria-label={`${CARD_LABELS[item.kind]} connection cards: ${item.count}`}>
                <span className="grid h-10 w-10 place-items-center rounded-full border border-white/25 bg-white text-[#1f6b55] shadow-[0_8px_22px_rgba(8,39,30,.22)]"><ConnectionOrbitIcon kind={item.kind} /></span>
                <span className="max-w-full truncate text-[9px] font-bold text-white/72">{CARD_LABELS[item.kind]}{item.count > 1 ? ` · ${item.count}` : ''}</span>
              </button>
            );
          })}

          <div className="absolute left-1/2 top-[43%] z-10 h-[172px] w-[172px] -translate-x-1/2 -translate-y-1/2">
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible drop-shadow-[0_10px_22px_rgba(20,70,54,.14)]" viewBox="0 0 172 172" role="img" aria-label={`Canact score ${scoreSummary.score}, ${Math.round(scoreProgress)}% of the ${scoreSummary.max} maximum`}>
              <path d="M38.32 149.57A79.45 79.45 0 1 1 133.68 149.57" pathLength="79.5" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="7" strokeLinecap="round" />
              <path
                d="M38.32 149.57A79.45 79.45 0 1 1 133.68 149.57"
                pathLength="79.5"
                fill="none"
                stroke="#9de1c1"
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={`${scoreProgress * 0.795} 100`}
                className="transition-[stroke-dasharray] duration-700 ease-out"
              />
            </svg>
            <div className={`absolute inset-[11px] overflow-hidden rounded-full border-[3px] bg-white shadow-[0_14px_34px_rgba(7,37,28,.28)] ${isFavourite ? 'border-[#E8B830]' : 'border-white'}`}>
              {isSelf ? (
                <button type="button" onClick={() => profilePhotoInputRef.current?.click()} aria-label="Change profile photo" className="relative block h-full w-full transition-transform active:scale-95">
                  <Avatar src={userProfile.photoURL} name={displayName} size={150} />
                </button>
              ) : (
                <button type="button" onClick={() => setAttrsSheetOpen(true)} aria-label={`Rate ${displayName}`} className="block h-full w-full transition-transform active:scale-95">
                  <Avatar src={userProfile.photoURL} name={displayName} size={150} />
                </button>
              )}
            </div>
            {isSelf ? (
              <button type="button" onClick={() => profilePhotoInputRef.current?.click()} aria-label="Change profile photo" className="absolute bottom-2 right-1 z-30 grid h-9 w-9 place-items-center rounded-full border-[3px] border-[#1f6b55] bg-white text-[#1f6b55] shadow-[0_6px_16px_rgba(7,37,28,.28)] transition-transform active:scale-95">
                <Camera size={14} />
              </button>
            ) : null}
            <div className="absolute bottom-[-40px] left-1/2 z-20 flex h-9 -translate-x-1/2 overflow-hidden rounded-full shadow-[0_8px_20px_rgba(7,37,28,.3)]">
              {isSelf ? (
                <Link
                  href="/mood"
                  prefetch
                  className="flex h-full min-w-[66px] items-center justify-center gap-1.5 border-r border-[#faf8f2]/75 px-2 transition-[filter] active:brightness-95"
                  style={{ background: currentMood?.soft ?? '#e2f2e9', color: currentMood?.accent ?? '#1f6b55' }}
                  aria-label={currentMood ? `Current mood: ${currentMood.label}. Change mood` : 'Select your mood'}
                >
                  {currentMood ? <MoodIcon kind={currentMood.id} size={14} /> : <Smile size={14} />}
                  <strong className="max-w-[42px] truncate text-[8px] font-black uppercase tracking-[.04em]">{currentMood?.label ?? 'Mood'}</strong>
                </Link>
              ) : currentMood ? (
                <span
                  className="flex h-full min-w-[66px] items-center justify-center gap-1.5 border-r border-[#faf8f2]/75 px-2"
                  style={{ background: currentMood.soft, color: currentMood.accent }}
                  role="status"
                  aria-label={`${displayName} feels ${currentMood.label}, intensity ${userProfile.currentMood?.intensity ?? 3} of 5`}
                >
                  <MoodIcon kind={currentMood.id} size={14} />
                  <strong className="max-w-[42px] truncate text-[8px] font-black uppercase tracking-[.04em]">{currentMood.label}</strong>
                </span>
              ) : null}
              <span className="flex h-full min-w-[112px] items-center justify-center gap-2 bg-[#174f3f] px-3 text-white">
                <strong className="text-[17px] font-black leading-none tracking-[-.04em]">{scoreSummary.score}</strong>
                <span className="text-left text-[6px] font-black uppercase leading-[1.05] tracking-[.11em] text-white/70">Canact<br />score</span>
              </span>
              <span className="flex h-full min-w-[58px] items-center justify-center gap-1 border-l border-[#faf8f2]/75 bg-[#f1c84b] px-2 text-[#513d0a]" aria-label={`${helpCount} confirmed helps`}>
                <HandHeart size={12} strokeWidth={2.4} />
                <strong className="text-[13px] font-black leading-none">{helpCount}</strong>
                <small className="text-[6px] font-black uppercase tracking-[.08em]">Help</small>
              </span>
            </div>
          </div>
        </div>

        {isSelf ? (
          <Link href="/mood" prefetch className="mt-5 inline-flex h-10 items-center justify-center rounded-full border border-white/80 bg-white px-7 text-[12px] font-black text-[#1f6b55] shadow-[0_7px_16px_rgba(7,37,28,.22),inset_0_1px_0_rgba(255,255,255,.18)] transition-[transform,box-shadow,background-color] hover:bg-[#f1f7f3] active:translate-y-px active:scale-[.97] active:shadow-[0_3px_8px_rgba(7,37,28,.18)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            Update mood
          </Link>
        ) : null}
        <h1 className="mt-6 text-[26px] font-black tracking-[-.04em] text-white">{displayName}{isVerified ? <span className="ml-2 align-middle text-lg text-[#9de1c1]">✓</span> : null}</h1>
        <p className="mt-1 text-[13px] font-semibold text-white/65">@{profileSlug(userProfile)} · {role}</p>
        <p className="mx-auto mt-2.5 max-w-[340px] text-[13px] font-semibold leading-5 text-white/80">{profileInsight}</p>
        {userProfile.bio && userProfile.bio.trim() !== profileInsight ? <p className="mx-auto mt-2 max-w-sm whitespace-pre-wrap text-xs leading-5 text-white/60">{userProfile.bio}</p> : null}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <ProfileAttributeGauge id={`${userProfile.uid}-behaviour`} label="Behaviour" positive={userProfile.attrs?.behaviour ?? 0} negative={userProfile.attrs?.rude ?? 0} />
          <ProfileAttributeGauge id={`${userProfile.uid}-reliability`} label="Reliability" positive={userProfile.attrs?.reliability ?? 0} negative={userProfile.attrs?.unreliable ?? 0} />
          <ProfileAttributeGauge id={`${userProfile.uid}-civic`} label="Civic sense" positive={userProfile.attrs?.civic_sense ?? 0} negative={userProfile.attrs?.uncivil ?? 0} />
        </div>

        {!isSelf ? (
          <button type="button" onClick={() => setAttrsSheetOpen(true)} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-white font-black text-[#1f6b55] shadow-[0_7px_16px_rgba(7,37,28,.2)] transition-transform active:scale-[.98]"><Star size={16} /> Give attributes</button>
        ) : null}
        </div>

        <ProfileRecognitionFolders profile={userProfile} isSelf={isSelf} showAttributes={false} connectionCards={receivedConnections} />

        <div className="mt-4 flex gap-3">
          {isSelf ? <Link href="/edit-profile" prefetch className="flex h-12 flex-1 items-center justify-center rounded-full bg-brand font-bold text-white">Edit profile</Link> : <button type="button" onClick={onSupport} className={`h-12 flex-1 rounded-full font-bold text-white transition ${isGoldButton ? 'bg-[#E8B830] shadow-[0_4px_16px_rgba(232,184,48,0.3)]' : 'bg-brand'}`}>{supportLabel}</button>}
          {isSelf || friendStatus === 'friends' ? (
            <Link href={isSelf ? '/profile/settings' : `/inbox/${userProfile.uid}`} prefetch className="flex h-12 flex-1 items-center justify-center rounded-full border border-brand bg-white font-bold text-brand">{isSelf ? 'Settings' : 'Message'}</Link>
          ) : (
            <button type="button" onClick={onSupport} className="flex h-12 flex-1 items-center justify-center rounded-full border border-brand/30 bg-white font-bold text-brand/60">Connect to message</button>
          )}
        </div>

        <div className="mt-8 flex items-center justify-center gap-7 border-b border-line pb-3 sm:gap-12">
          {([{ id: 'posts', Icon: ShoppingBag }, { id: 'stories', Icon: Sparkles }, { id: 'reels', Icon: Video }, { id: 'polls', Icon: AlignLeft }] as const).map(({ id, Icon }) => {
            const active = activeTab === id;
            return <button key={id} type="button" onClick={() => setTab(id)} className={`relative grid h-10 w-10 place-items-center ${active ? 'text-brand' : 'text-ink/30'}`}><Icon size={21} strokeWidth={active ? 2.4 : 1.7} />{active ? <span className="absolute -bottom-3 h-[3px] w-8 rounded-full bg-brand" /> : null}</button>;
          })}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2">
          {activeTab === 'stories' ? (
            stories.length ? stories.map((story, index) => (
              <button key={story.id} type="button" onClick={() => onOpenStory(index)} className="relative aspect-[9/16] overflow-hidden rounded-[18px] bg-[#e7e1d1]">
                {/\.(mp4|webm|mov)(\?|$)/i.test(story.mediaUrl)
                  ? <video src={story.mediaUrl} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : <img src={story.mediaUrl} alt={story.caption || 'Story'} loading="lazy" className="h-full w-full object-cover" />}
              </button>
            )) : (
              <div className="col-span-3 rounded-[22px] bg-white px-5 py-10 text-sm font-semibold text-muted">
                <p>No active stories.</p>
                {isSelf ? <Link href="/story/create" className="mt-3 inline-flex rounded-full bg-brand px-4 py-2 text-xs font-bold text-white">Add story</Link> : null}
              </div>
            )
          ) : thumbs.length ? thumbs.map((thumb) => <Link key={thumb.id} href={thumb.href} prefetch className="aspect-square overflow-hidden rounded-[18px] bg-[#e7e1d1]">{thumb.src ? <img src={thumb.src} alt={thumb.label} loading="lazy" className="h-full w-full object-cover" /> : thumb.video ? <video src={thumb.video} muted playsInline className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center p-2 text-center text-xs font-bold text-brand">{thumb.label}</span>}</Link>) : <div className="col-span-3 rounded-[22px] bg-white px-5 py-10 text-sm font-semibold text-muted">No content yet</div>}
        </div>
      </section>
      </div>{/* end blur wrapper */}

      {!isSelf && !accessBlockReason ? <ProfileVotePill vote={profileVote} busy={profileVoteBusy} onVote={onProfileVote} /> : null}

      <ProfileAccessGate reason={accessBlockReason} locationError={locationError} onRetryLocation={onRetryLocation} />

      {isSelf ? (
        <>
          <input ref={profilePhotoInputRef} type="file" accept="image/*" className="sr-only" aria-label="Choose profile photo" onChange={pickProfilePhoto} />
          <ProfileImageEditorSheet
            file={profilePhotoFile}
            open={profilePhotoEditorOpen}
            busy={profilePhotoBusy}
            onClose={closeProfilePhotoEditor}
            onApply={applyProfilePhoto}
          />
        </>
      ) : null}

      {/* Attribute sliders — opened by the CTA or avatar on third-party profiles. */}
      {!isSelf && (
        <Sheet open={attrsSheetOpen} onClose={() => setAttrsSheetOpen(false)} title={`${displayName}'s attributes`}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-[20px] bg-[#edf3ef] p-3">
            {userProfile.photoURL ? (
              <img src={userProfile.photoURL} alt={displayName} className="h-16 w-16 shrink-0 rounded-full object-cover bg-brand-light" />
            ) : (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-light text-2xl font-extrabold text-brand">
                {(displayName || '?')[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 text-left">
              <div className="text-lg font-extrabold text-ink">{displayName}</div>
              <div className="text-sm text-ink/50">@{profileSlug(userProfile)}</div>
            </div>
            </div>
            <ProfileRecognitionFolders profile={userProfile} isSelf={false} showCards={false} />
            {(!userProfile.attrs || Object.values(userProfile.attrs).every((v) => !v)) && (
              <p className="text-center text-sm text-ink/40">No attributes yet.</p>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function ProfileAccessGate({
  reason,
  locationError,
  onRetryLocation,
}: {
  reason: 'location' | 'range' | null;
  locationError: string | null;
  onRetryLocation: () => void;
}) {
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!reason) return;
    return lockPageScroll();
  }, [reason]);

  if (!reason || !portalReady) return null;

  const needsLocation = reason === 'location';
  const locating = needsLocation && !locationError;

  return createPortal(
    <div
      data-canact-popup="true"
      className="pointer-events-none fixed inset-0 z-[2147483000] flex items-center justify-center overscroll-none px-5"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="out-of-range-profile-message"
    >
      <div className="canact-popup-backdrop absolute inset-0" aria-hidden="true" />
      <div
        id="out-of-range-profile-message"
        className="relative w-full max-w-sm rounded-[28px] bg-[#202221] px-7 py-6 text-center text-[16px] font-bold leading-6 text-white shadow-[0_20px_60px_rgba(0,0,0,0.28)]"
      >
        <MapPin size={24} className="mx-auto mb-3" aria-hidden="true" />
        {needsLocation ? (
          <>
            {locating ? 'Finding your location…' : 'Location access is required.'}
            <span className="mt-1 block font-medium text-white/70">
              Profiles stay hidden until your current location is available.
            </span>
            {!locating ? (
              <button type="button" onClick={onRetryLocation} className="pointer-events-auto mt-4 h-11 rounded-full bg-white px-6 text-sm font-extrabold text-[#202221]">
                Try location again
              </button>
            ) : null}
          </>
        ) : (
          <>
            This person is outside your 15&nbsp;m range.
            <br />
            Move closer to see their full profile.
          </>
        )}
      </div>
    </div>,
    document.body,
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
