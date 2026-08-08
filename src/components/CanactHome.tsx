'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Activity, ArrowUp, Award, Check, ChevronRight, HeartHandshake, MapPin, ShieldCheck, Sparkles, UserPlus, Users } from '@/components/icons';
import { ProfileRecognitionFolders } from '@/components/ProfileRecognitionFolders';
import { ExploreMap } from '@/components/ExploreMap';
import { Sheet } from '@/components/Sheet';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { useGeo } from '@/lib/useGeo';
import { calculateCanactScore, getCanactScoreLabel } from '@/lib/canactScore';
import { haptic } from '@/lib/haptics';
import { useDistance } from '@/lib/distance';
import { sendFriendRequest } from '@/lib/services/friends';
import { toast } from '@/components/Toaster';
import type { UserProfile } from '@/lib/types';
import type { FriendMapPerson } from '@/components/FriendsWorldMap';
import { formatDistance, haversineMeters } from '@/lib/utils';
import styles from './CanactHome.module.css';
import { VerifiedBadge } from '@/components/VerifiedBadge';

type HomeProfile = UserProfile & { lastLocation?: { lat?: number; lng?: number } };
type HomeSuggestion = { profile: HomeProfile; source: 'contact' | 'nearby'; distanceMeters?: number };
type MetricOrbitSlot = 'active' | 'right-low' | 'right-high' | 'hidden' | 'left-high' | 'left-low';

const METRIC_ORBIT_SLOTS: MetricOrbitSlot[] = ['active', 'right-low', 'right-high', 'hidden', 'left-high', 'left-low'];

function getMetricOrbitSlot(index: number, activeIndex: number, total: number): MetricOrbitSlot {
  const distance = (index - activeIndex + total) % total;
  return METRIC_ORBIT_SLOTS[distance] ?? 'hidden';
}

function firstName(value?: string | null) {
  return String(value || 'there').trim().split(/\s+/)[0] || 'there';
}

export function CanactHome() {
  const { profile, user } = useAuth();
  const router = useRouter();
  const { coords } = useGeo();
  const { radius } = useDistance();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scoreRef = useRef<HTMLDivElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const transitionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef(0);
  const atEndRef = useRef(false);
  const endReachedAtRef = useRef(0);
  const pullRef = useRef(0);
  const pullResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionRouteTimerRef = useRef<number | null>(null);
  const transitionResetTimerRef = useRef<number | null>(null);
  const transitioningRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [exploreTransition, setExploreTransition] = useState(false);
  const [transitionOrigin, setTransitionOrigin] = useState<React.CSSProperties>();
  const [people, setPeople] = useState<FriendMapPerson[]>([]);
  const [profiles, setProfiles] = useState<HomeProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [contactUids, setContactUids] = useState<Set<string>>(() => new Set());
  const [friendUids, setFriendUids] = useState<Set<string>>(() => new Set());
  const [outgoingUids, setOutgoingUids] = useState<Set<string>>(() => new Set());
  const [connectingUid, setConnectingUid] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [metricOrbitStep, setMetricOrbitStep] = useState(0);
  const [metricAutoPaused, setMetricAutoPaused] = useState(false);
  const metricSwipeRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const metricSwipedRef = useRef(false);
  const metricResumeTimerRef = useRef<number | null>(null);
  const suggestionDay = useMemo(() => Math.floor(Date.now() / 86_400_000), []);
  const summary = useMemo(() => calculateCanactScore(profile), [profile]);
  const score = summary.score;
  const tier = getCanactScoreLabel(score);
  const name = firstName(profile?.firstName || profile?.fullName || user?.displayName);

  const goodActs = (profile?.helpStats?.resolved || 0) + (profile?.helpStats?.confirmed || 0);
  const connectionCardCount = Object.values(profile?.cardsReceived ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
  const badgeCount = new Set(profile?.badges ?? []).size;
  const connectionCardsHref = user?.uid ? `/profile#connection-cards-${encodeURIComponent(user.uid)}` : '/profile';
  const scoreMetrics = useMemo(() => [
    { id: 'connections', label: 'Connection cards', displayLabel: 'Connection', value: connectionCardCount, suffix: 'cards', Icon: Award, tone: 'mint', href: connectionCardsHref },
    { id: 'help', label: 'Helps done', displayLabel: 'Helps', value: goodActs, suffix: 'completed', Icon: HeartHandshake, tone: 'lavender', href: '/help' },
    { id: 'badges', label: 'Badges received', displayLabel: 'Badges', value: badgeCount, suffix: 'received', Icon: ShieldCheck, tone: 'cream', href: '/profile' },
    { id: 'reliability', label: 'Reliability', displayLabel: 'Reliability', value: Number(profile?.attrs?.reliability || 0), suffix: 'signals', Icon: ShieldCheck, tone: 'blue', href: '/profile' },
    { id: 'civic', label: 'Civic sense', displayLabel: 'Civic sense', value: Number(profile?.attrs?.civic_sense || 0), suffix: 'signals', Icon: Sparkles, tone: 'yellow', href: '/profile' },
    { id: 'behaviour', label: 'Behaviour', displayLabel: 'Behaviour', value: Number(profile?.attrs?.behaviour || 0), suffix: 'signals', Icon: Users, tone: 'coral', href: '/profile' },
  ], [badgeCount, connectionCardCount, connectionCardsHref, goodActs, profile?.attrs?.behaviour, profile?.attrs?.civic_sense, profile?.attrs?.reliability]);
  const activeMetricIndex = ((metricOrbitStep % scoreMetrics.length) + scoreMetrics.length) % scoreMetrics.length;

  const changeMetric = useCallback((direction: number) => {
    setMetricOrbitStep((current) => current + direction);
  }, []);

  const pauseMetricAutoRotate = useCallback((resumeAfterMs?: number) => {
    setMetricAutoPaused(true);
    if (metricResumeTimerRef.current) window.clearTimeout(metricResumeTimerRef.current);
    metricResumeTimerRef.current = null;
    if (resumeAfterMs) {
      metricResumeTimerRef.current = window.setTimeout(() => {
        setMetricAutoPaused(false);
        metricResumeTimerRef.current = null;
      }, resumeAfterMs);
    }
  }, []);

  useEffect(() => {
    if (metricAutoPaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setMetricOrbitStep((current) => current + 1);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [metricAutoPaused]);

  useEffect(() => () => {
    if (metricResumeTimerRef.current) window.clearTimeout(metricResumeTimerRef.current);
  }, []);

  const onMetricPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    pauseMetricAutoRotate();
    metricSwipeRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    metricSwipedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onMetricPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = metricSwipeRef.current;
    metricSwipeRef.current = null;
    pauseMetricAutoRotate(5200);
    if (!start) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 34 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    metricSwipedRef.current = true;
    changeMetric(deltaX < 0 ? 1 : -1);
    haptic('selection');
    window.setTimeout(() => { metricSwipedRef.current = false; }, 0);
  };

  const cancelMetricSwipe = () => {
    metricSwipeRef.current = null;
    pauseMetricAutoRotate(3200);
  };

  const promoteMetric = (index: number) => {
    const forwardDistance = (index - activeMetricIndex + scoreMetrics.length) % scoreMetrics.length;
    const shortestDistance = forwardDistance <= scoreMetrics.length / 2
      ? forwardDistance
      : forwardDistance - scoreMetrics.length;
    setMetricOrbitStep((current) => current + shortestDistance);
    pauseMetricAutoRotate(5200);
  };

  const currentLocation = coords
    ? { lat: coords.lat, lng: coords.lng }
    : normalizedHomeLocation((profile as HomeProfile | null)?.lastLocation);

  // Load map-visible profiles. Distance styling in ExploreMap keeps the
  // immediate 15 m vicinity clear and de-emphasises everyone farther away.
  useEffect(() => {
    if (!user) { setPeople([]); setProfiles([]); setProfilesLoaded(false); return; }
    return onValue(ref(db, 'users'), (snapshot) => {
      const value = snapshot.val() as Record<string, HomeProfile> | null;
      const rows = Object.entries(value ?? {})
        .filter(([, candidate]) => candidate.role !== 'admin')
        .map(([uid, candidate]) => ({ ...candidate, uid: candidate.uid || uid }));
      setProfiles(rows);
      setProfilesLoaded(true);
      const located = rows.flatMap<FriendMapPerson>((candidate) => {
        const uid = candidate.uid;
        const location = candidate?.lastLocation;
        if (uid === user.uid || typeof location?.lat !== 'number' || typeof location?.lng !== 'number') return [];
        return [{
          uid,
          name: candidate.fullName || candidate.firstName || 'Canact user',
          photoURL: candidate.photoURL || null,
          lat: location.lat,
          lng: location.lng,
          city: candidate.city,
          country: candidate.country,
        }];
      });
      setPeople(located);
    });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setContactUids(new Set());
      setFriendUids(new Set());
      setOutgoingUids(new Set());
      return;
    }
    const listenKeys = (path: string, setter: (value: Set<string>) => void) => onValue(ref(db, path), (snapshot) => {
      const next = new Set<string>();
      snapshot.forEach((child) => { if (child.key) next.add(child.key); return undefined; });
      setter(next);
    });
    const offContacts = listenKeys(`contacts/${user.uid}`, setContactUids);
    const offFriends = listenKeys(`friends/${user.uid}`, setFriendUids);
    const offOutgoing = listenKeys(`friendRequests/outgoing/${user.uid}`, setOutgoingUids);
    return () => { offContacts(); offFriends(); offOutgoing(); };
  }, [user?.uid]);

  const suggestions = useMemo<HomeSuggestion[]>(() => {
    if (!user?.uid) return [];
    const now = Date.now();
    const eligible = profiles.filter((candidate) => (
      candidate.uid !== user.uid
      && !friendUids.has(candidate.uid)
      && (!candidate.underground || (Number(candidate.undergroundUntil || 0) > 0 && Number(candidate.undergroundUntil) <= now))
    ));
    const contacts = eligible
      .filter((candidate) => contactUids.has(candidate.uid))
      .sort((left, right) => suggestionHash(`${left.uid}:${user.uid}:${suggestionDay}`) - suggestionHash(`${right.uid}:${user.uid}:${suggestionDay}`))
      .slice(0, 5)
      .map((candidate): HomeSuggestion => ({ profile: candidate, source: 'contact' }));
    const used = new Set(contacts.map((item) => item.profile.uid));
    const nearby = currentLocation ? eligible.flatMap<HomeSuggestion>((candidate) => {
      if (used.has(candidate.uid)) return [];
      const location = normalizedHomeLocation(candidate.lastLocation);
      if (!location) return [];
      const distanceMeters = haversineMeters(currentLocation, location);
      if (radius !== Infinity && distanceMeters > radius) return [];
      return [{ profile: candidate, source: 'nearby', distanceMeters }];
    }).sort((left, right) => (left.distanceMeters ?? Infinity) - (right.distanceMeters ?? Infinity)) : [];
    return [...contacts, ...nearby].slice(0, 10);
  }, [contactUids, currentLocation, friendUids, profiles, radius, suggestionDay, user?.uid]);
  const visibleSuggestions = suggestions.slice(0, 5);

  const connect = async (suggestion: HomeSuggestion) => {
    if (!user || !profile || connectingUid || outgoingUids.has(suggestion.profile.uid)) return;
    setConnectingUid(suggestion.profile.uid);
    try {
      await sendFriendRequest(
        { uid: user.uid, name: profile.fullName, photoURL: profile.photoURL },
        { uid: suggestion.profile.uid, name: suggestion.profile.fullName || 'Canact user', photoURL: suggestion.profile.photoURL },
      );
      toast(`Get In Touch request sent to ${suggestion.profile.firstName || suggestion.profile.fullName || 'this person'}`, 'success');
    } catch (error: any) { toast(error?.message || 'Could not send Get In Touch request', 'error'); }
    finally { setConnectingUid(null); }
  };

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const st = scrollRef.current?.scrollTop ?? 0;
      const maxScroll = Math.max(0, (scrollRef.current?.scrollHeight ?? 0) - (scrollRef.current?.clientHeight ?? 0));
      const reachedEnd = maxScroll > 0 && maxScroll - st <= 12;
      if (reachedEnd && !atEndRef.current) endReachedAtRef.current = performance.now();
      if (!reachedEnd) endReachedAtRef.current = 0;
      atEndRef.current = reachedEnd;
      if (!reachedEnd) pullRef.current = 0;
      setProgress(Math.min(Math.max(st / 180, 0), 1));
    });
  }, []);

  useLayoutEffect(() => {
    if (!exploreTransition) return;
    const source = mapWrapRef.current?.querySelector<HTMLCanvasElement>('.maplibregl-canvas');
    const target = transitionCanvasRef.current;
    if (!source || !target) return;
    target.width = source.width;
    target.height = source.height;
    try {
      target.getContext('2d')?.drawImage(source, 0, 0);
    } catch {
      // The solid map background remains a safe fallback if a WebView
      // prevents copying its WebGL canvas.
    }
  }, [exploreTransition]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => { el.removeEventListener('scroll', handleScroll); cancelAnimationFrame(rafRef.current); };
  }, [handleScroll]);

  useEffect(() => {
    const root = scrollRef.current;
    const target = scoreRef.current;
    if (!root || !target) return;

    const publish = (ratio: number) => {
      const pillOpacity = ratio >= 0.6 ? 0 : Math.max(0, Math.min(1, (0.6 - ratio) / 0.25));
      document.documentElement.style.setProperty('--canact-home-pill-opacity', String(pillOpacity));
      window.dispatchEvent(new CustomEvent('canact:home-scroll', { detail: { pillOpacity } }));
    };
    const observer = new IntersectionObserver(
      ([entry]) => publish(entry?.intersectionRatio ?? 0),
      { root, threshold: [0, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1] },
    );
    publish(1);
    observer.observe(target);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--canact-home-pill-opacity');
    };
  }, []);

  const openExplore = useCallback(() => {
    if (transitioningRef.current) return;
    transitioningRef.current = true;
    const rect = mapWrapRef.current?.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    setTransitionOrigin({
      '--map-clip-top': `${Math.max(0, rect?.top ?? 0)}px`,
      '--map-clip-right': `${Math.max(0, viewportWidth - (rect?.right ?? viewportWidth))}px`,
      '--map-clip-bottom': `${Math.max(0, viewportHeight - (rect?.bottom ?? viewportHeight))}px`,
      '--map-clip-left': `${Math.max(0, rect?.left ?? 0)}px`,
      '--map-scale-x': String(Math.max(0.01, (rect?.width ?? viewportWidth) / viewportWidth)),
      '--map-scale-y': String(Math.max(0.01, (rect?.height ?? viewportHeight) / viewportHeight)),
    } as React.CSSProperties);
    document.documentElement.setAttribute('data-canact-explore-handoff', 'true');
    setExploreTransition(true);
    haptic('selection');
    transitionRouteTimerRef.current = window.setTimeout(() => router.push('/favourites'), 500);
    transitionResetTimerRef.current = window.setTimeout(() => {
      transitioningRef.current = false;
      pullRef.current = 0;
      endReachedAtRef.current = 0;
      atEndRef.current = false;
      setExploreTransition(false);
      setTransitionOrigin(undefined);
      document.documentElement.removeAttribute('data-canact-explore-handoff');
      requestAnimationFrame(handleScroll);
    }, 1400);
  }, [handleScroll, router]);

  useEffect(() => {
    const rearm = () => {
      transitioningRef.current = false;
      pullRef.current = 0;
      endReachedAtRef.current = 0;
      atEndRef.current = false;
      setExploreTransition(false);
      setTransitionOrigin(undefined);
      document.documentElement.removeAttribute('data-canact-explore-handoff');
      requestAnimationFrame(handleScroll);
    };
    window.addEventListener('pageshow', rearm);
    return () => {
      window.removeEventListener('pageshow', rearm);
      if (transitionRouteTimerRef.current) clearTimeout(transitionRouteTimerRef.current);
      if (transitionResetTimerRef.current) clearTimeout(transitionResetTimerRef.current);
      if (window.location.pathname !== '/favourites') document.documentElement.removeAttribute('data-canact-explore-handoff');
    };
  }, [handleScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let touchStartY: number | null = null;
    let touchPull = 0;
    const onWheel = (event: WheelEvent) => {
      if (!atEndRef.current || event.deltaY <= 0 || transitioningRef.current || performance.now() - endReachedAtRef.current < 120) return;
      pullRef.current += Math.min(event.deltaY, 36);
      if (pullResetRef.current) clearTimeout(pullResetRef.current);
      pullResetRef.current = setTimeout(() => { pullRef.current = 0; }, 600);
      if (pullRef.current >= 72) openExplore();
    };
    const onTouchStart = (event: TouchEvent) => {
      if (!atEndRef.current || transitioningRef.current || performance.now() - endReachedAtRef.current < 100) return;
      touchStartY = event.touches[0]?.clientY ?? null;
      touchPull = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchStartY === null || !atEndRef.current) return;
      touchPull = Math.max(0, touchStartY - (event.touches[0]?.clientY ?? touchStartY));
    };
    const onTouchEnd = () => {
      if (touchPull >= 64) openExplore();
      touchStartY = null;
      touchPull = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      if (pullResetRef.current) clearTimeout(pullResetRef.current);
    };
  }, [openExplore]);

  const p = progress;
  const progressStyle = {
    '--p': p,
    '--greeting-opacity': 1 - (p * 1.2),
    '--greeting-y': `${-32 * p}px`,
    '--circle-scale': 1 - (p * 0.36),
    '--circle-opacity': Math.max(0, 1 - (p * 1.3)),
    '--metric-opacity': Math.max(0, 1 - (p * 1.3)),
  } as React.CSSProperties;

  return (
    <section className={styles.home} style={progressStyle} aria-label="Canact home">
      <div ref={scrollRef} className={styles.scroller}>
        <div className={styles.hero}>
          <div className={styles.greeting}>
            <p>hey {name},</p>
            <h1>you&apos;re in the <strong>{summary.club} club</strong> now</h1>
          </div>
        </div>

        <div
          className={styles.scoreDock}
          role="region"
          aria-label="Score insights carousel"
          aria-roledescription="carousel"
          onPointerDown={onMetricPointerDown}
          onPointerUp={onMetricPointerUp}
          onPointerCancel={cancelMetricSwipe}
          onLostPointerCapture={cancelMetricSwipe}
          onMouseEnter={() => pauseMetricAutoRotate()}
          onMouseLeave={() => setMetricAutoPaused(false)}
          onFocus={() => pauseMetricAutoRotate()}
          onBlur={() => pauseMetricAutoRotate(2800)}
        >
          {scoreMetrics.map((metric, index) => {
            const Icon = metric.Icon;
            const orbitSlot = getMetricOrbitSlot(index, activeMetricIndex, scoreMetrics.length);
            const isActive = orbitSlot === 'active';
            const isHidden = orbitSlot === 'hidden';
            return (
              <Link
                key={metric.id}
                href={metric.href}
                prefetch
                className={styles.metricCircle}
                data-slot={orbitSlot}
                data-tone={metric.tone}
                style={{
                  '--orbit-angle': `${(index * -60) + (metricOrbitStep * 60)}deg`,
                } as React.CSSProperties}
                tabIndex={isHidden ? -1 : 0}
                aria-hidden={isHidden || undefined}
                aria-label={`${metric.label}: ${metric.value} ${metric.suffix}. Open details.`}
                onClick={(event) => {
                  if (metricSwipedRef.current) {
                    metricSwipedRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  if (!isActive) {
                    event.preventDefault();
                    promoteMetric(index);
                  }
                  haptic('selection');
                }}
              >
                <span className={styles.metricContent}>
                  <span className={styles.metricIcon}><Icon size={18} /></span>
                  <b>{metric.value}</b>
                  <strong>{metric.displayLabel}</strong>
                  <small>{metric.suffix}</small>
                </span>
              </Link>
            );
          })}
          <div ref={scoreRef} className={styles.scoreCircle} data-onboarding="score">
            <svg className={styles.scoreRing} viewBox="0 0 240 240" aria-hidden="true">
              <circle cx="120" cy="120" r="108" pathLength="100" />
              <circle className={styles.scoreArc} cx="120" cy="120" r="108" pathLength="100" style={{ strokeDashoffset: 100 - Math.max(4, Math.min(100, (score / Math.max(summary.max, 1)) * 100)) }} />
            </svg>
            <div className={styles.scoreInner}>
              <span>CANACT SCORE</span>
              <b>{score}</b>
              <small>{summary.delta >= 0 ? '↑' : '↓'} {Math.abs(summary.delta)} this month</small>
              <em>{tier}</em>
            </div>
          </div>
          <span className={styles.metricStatus} aria-live="polite">
            {scoreMetrics[activeMetricIndex]?.label}: {scoreMetrics[activeMetricIndex]?.value} {scoreMetrics[activeMetricIndex]?.suffix}
          </span>
        </div>

        <div className={styles.belowFold}>
        {suggestions.length ? (
          <>
            <div className={styles.suggestionHeading}>
              <div>
                <span className={styles.suggestionEyebrow}>Grow your circle</span>
                <h2 id="people-you-may-know-title">People you may know</h2>
                <p>Based on your contacts and nearby community</p>
              </div>
            </div>
            <div className={styles.suggestionList}>
              {visibleSuggestions.map((suggestion) => (
                <PeopleListRow
                  key={suggestion.profile.uid}
                  suggestion={suggestion}
                  requested={outgoingUids.has(suggestion.profile.uid)}
                  busy={connectingUid === suggestion.profile.uid}
                  onConnect={connect}
                />
              ))}
            </div>
            {suggestions.length > visibleSuggestions.length ? (
              <button
                type="button"
                className={styles.suggestionLoadMore}
                aria-haspopup="dialog"
                aria-expanded={suggestionsOpen}
                onClick={() => setSuggestionsOpen(true)}
              >
                <span className={styles.suggestionLoadMoreIcon} aria-hidden="true"><Users size={18} /></span>
                <span className={styles.suggestionLoadMoreCopy}>
                  <strong>Explore more people</strong>
                  <small>{suggestions.length - visibleSuggestions.length} more suggestions waiting</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ) : null}
          </>
        ) : !profilesLoaded ? (
          <>
            <div className={styles.suggestionHeading}>
              <div>
                <span className={styles.suggestionEyebrow}>Grow your circle</span>
                <h2 id="people-you-may-know-title">People you may know</h2>
                <p>Based on your contacts and nearby community</p>
              </div>
            </div>
            <div className={styles.suggestionList}>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={styles.suggestionSkeleton}>
                  <span className={styles.skeletonCircle} />
                  <span className={styles.skeletonLines}>
                    <span className={styles.skeletonLine} style={{ width: '60%' }} />
                    <span className={styles.skeletonLine} style={{ width: '40%' }} />
                  </span>
                  <span className={styles.skeletonPill} />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {profile ? <div data-onboarding="recognition-folders"><ProfileRecognitionFolders profile={profile} isSelf communityLeadersHref="/leaderboard" showAttributes={false} /></div> : null}

        <div className={styles.insight}>
          <span><Activity /></span>
          <div><h3>{summary.delta >= 0 ? 'Your trust is trending upward' : 'Small reliable actions rebuild momentum'}</h3><p>Consistency, genuine interactions, and community help shape your score.</p></div>
        </div>

        {/* Explore Map — always renders; live/stored location improves its centre. */}
        <div className={styles.mapStage}>
          <div
            ref={mapWrapRef}
            data-onboarding="home-map"
            className={styles.mapWrap}
            role="link"
            tabIndex={0}
            aria-label="Open the People Nearby map"
            onClick={openExplore}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') openExplore(); }}
          >
            <div className={styles.mapContainer}>
              <ExploreMap
                people={people}
                currentLocation={currentLocation}
                preview
                myPhotoURL={profile?.photoURL}
              />
            </div>
            <div className={styles.mapFade} />
          </div>

          <button type="button" data-onboarding="nearby-action" onClick={openExplore} className={styles.nearbyPill} aria-label="Swipe up for nearby people">
            <ArrowUp aria-hidden="true" />
            <span>Swipe up for nearby people</span>
          </button>
        </div>
        </div>
      </div>

      {exploreTransition ? (
        <div className={styles.exploreTransition} style={transitionOrigin} role="status" aria-label="Opening Explore map">
          <div className={styles.exploreTransitionMap}>
            <canvas ref={transitionCanvasRef} aria-hidden="true" />
          </div>
        </div>
      ) : null}

      <Sheet open={suggestionsOpen} onClose={() => setSuggestionsOpen(false)} title="People you may know">
        <div className={styles.suggestionSheet}>
          <p>All {suggestions.length} suggestions</p>
          <div className={styles.suggestionList}>
            {suggestions.map((suggestion) => (
              <PeopleListRow
                key={suggestion.profile.uid}
                suggestion={suggestion}
                requested={outgoingUids.has(suggestion.profile.uid)}
                busy={connectingUid === suggestion.profile.uid}
                onConnect={connect}
              />
            ))}
          </div>
        </div>
      </Sheet>
    </section>
  );
}

function getRatingDotColor(label: string): string {
  switch (label) {
    case 'TRUST': return '#2e8068';
    case 'GOOD': return '#4a9e82';
    case 'FAIR': return '#c7880a';
    default: return '#c0392b';
  }
}

function PeopleListRow({
  suggestion,
  requested,
  busy,
  onConnect,
}: {
  suggestion: HomeSuggestion;
  requested: boolean;
  busy: boolean;
  onConnect: (suggestion: HomeSuggestion) => Promise<void>;
}) {
  const candidate = suggestion.profile;
  const name = candidate.fullName || candidate.firstName || 'Canact user';
  const initial = name.slice(0, 1).toUpperCase();
  const handle = candidate.firstName
    ? `@${candidate.firstName.toLowerCase().replace(/\s+/g, '.')}`
    : '@canact.user';
  const { score, label } = calculateCanactScore(candidate);
  const dotColor = getRatingDotColor(label);
  const matchReason = suggestion.source === 'contact'
    ? 'In your contacts'
    : suggestion.distanceMeters == null
      ? 'Near you'
      : `${formatDistance(suggestion.distanceMeters)} away`;

  return (
    <Link
      href={`/profile/${encodeURIComponent(candidate.uid)}`}
      className={styles.suggestionRow}
    >
      {/* Avatar */}
      <span className={styles.suggestionAvatar}>
        {candidate.photoURL ? (
          <img src={candidate.photoURL} alt="" loading="lazy" />
        ) : (
          <span className={styles.suggestionAvatarFallback}>{initial}</span>
        )}
        <span className={styles.suggestionSourceIcon} aria-hidden="true">
          {suggestion.source === 'contact' ? <UserPlus size={10} /> : <MapPin size={10} />}
        </span>
      </span>

      {/* Name + handle */}
      <span className={styles.suggestionIdentity}>
        <span className={styles.suggestionName}>
          {name}
          {candidate.profileVerified || candidate.verificationStatus === 'approved' ? <VerifiedBadge size={16} /> : null}
        </span>
        <span className={styles.suggestionHandle}>{handle}</span>
        <span className={styles.suggestionMeta}>
          <span className={styles.suggestionReason}>
            {suggestion.source === 'contact' ? <UserPlus size={10} /> : <MapPin size={10} />}
            {matchReason}
          </span>
          <span className={styles.suggestionScoreArea} title={`${label} Canact score`}>
            <span className={styles.suggestionDot} style={{ background: dotColor }} />
            <b className={styles.suggestionScore}>{score}</b>
            <span>score</span>
          </span>
        </span>
      </span>

      {/* Connect */}
      <button
        type="button"
        className={styles.suggestionConnect}
        disabled={busy || requested}
        aria-label={requested ? `Get In Touch request sent to ${name}` : `Get In Touch with ${name}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); void onConnect(suggestion); }}
      >
        {requested ? <Check size={14} aria-hidden="true" /> : <UserPlus size={14} aria-hidden="true" />}
        <span>{busy ? 'Sending…' : requested ? 'Sent' : 'Get In Touch'}</span>
      </button>
    </Link>
  );
}

function normalizedHomeLocation(value?: HomeProfile['lastLocation']) {
  if (typeof value?.lat !== 'number' || typeof value.lng !== 'number') return null;
  return { lat: value.lat, lng: value.lng };
}

function suggestionHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
