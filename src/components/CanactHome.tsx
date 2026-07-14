'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Activity, ArrowUp, Heart, Sparkles, Users } from '@/components/icons';
import { ProfileRecognitionFolders } from '@/components/ProfileRecognitionFolders';
import { ExploreMap } from '@/components/ExploreMap';
import { useAuth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { useGeo } from '@/lib/useGeo';
import { listenFriends } from '@/lib/services/friends';
import { calculateCanactScore, getCanactScoreLabel } from '@/lib/canactScore';
import { haptic } from '@/lib/haptics';
import type { FriendEdge, UserProfile } from '@/lib/types';
import type { FriendMapPerson } from '@/components/FriendsWorldMap';
import styles from './CanactHome.module.css';

function firstName(value?: string | null) {
  return String(value || 'there').trim().split(/\s+/)[0] || 'there';
}

export function CanactHome() {
  const { profile, user } = useAuth();
  const router = useRouter();
  const { coords } = useGeo();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scoreRef = useRef<HTMLDivElement | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const atEndRef = useRef(false);
  const endReachedAtRef = useRef(0);
  const pullRef = useRef(0);
  const pullResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionRouteTimerRef = useRef<number | null>(null);
  const transitionResetTimerRef = useRef<number | null>(null);
  const transitioningRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [exploreTransition, setExploreTransition] = useState(false);
  const [transitionOrigin, setTransitionOrigin] = useState<React.CSSProperties>();
  const [people, setPeople] = useState<FriendMapPerson[]>([]);
  const summary = useMemo(() => calculateCanactScore(profile), [profile]);
  const score = summary.score;
  const tier = getCanactScoreLabel(score);
  const name = firstName(profile?.firstName || profile?.fullName || user?.displayName);
  const positiveSignals = Math.max(0, (profile?.likesCount || 0) + (profile?.ratingCount || 0));
  const goodActs = (profile?.helpStats?.resolved || 0) + (profile?.helpStats?.confirmed || 0);

  const storedLocation = (profile as (UserProfile & { lastLocation?: { lat?: number; lng?: number } }) | null)?.lastLocation;
  const currentLocation = coords
    ? { lat: coords.lat, lng: coords.lng }
    : typeof storedLocation?.lat === 'number' && typeof storedLocation?.lng === 'number'
      ? { lat: storedLocation.lat, lng: storedLocation.lng }
      : null;

  // Load friends with location data for the map
  useEffect(() => {
    if (!user) return;
    return listenFriends(user.uid, (edges: FriendEdge[]) => {
      const uids = edges.map((e) => e.uid);
      if (!uids.length) { setPeople([]); return; }
      const unsubs = uids.map((uid) => onValue(ref(db, `users/${uid}`), (snap) => {
        const p = snap.val() as (UserProfile & { lastLocation?: { lat?: number; lng?: number } }) | null;
        setPeople((prev) => {
          const loc = p?.lastLocation;
          if (!p || typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') {
            return prev.filter((x) => x.uid !== uid);
          }
          const entry: FriendMapPerson = {
            uid, name: p.fullName || 'User', photoURL: p.photoURL || null,
            lat: loc.lat, lng: loc.lng, city: p.city, country: p.country,
          };
          const existing = prev.find((x) => x.uid === uid);
          if (existing) return prev.map((x) => x.uid === uid ? entry : x);
          return [...prev, entry];
        });
      }));
      return () => unsubs.forEach((u) => u());
    });
  }, [user?.uid]);

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
      setAtEnd(reachedEnd);
      if (!reachedEnd) pullRef.current = 0;
      setProgress(Math.min(Math.max(st / 180, 0), 1));
    });
  }, []);

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
    setTransitionOrigin({
      '--map-transition-top': `${rect?.top ?? 0}px`,
      '--map-transition-left': `${rect?.left ?? 0}px`,
      '--map-transition-width': `${rect?.width ?? window.innerWidth}px`,
      '--map-transition-height': `${rect?.height ?? window.innerHeight}px`,
    } as React.CSSProperties);
    setExploreTransition(true);
    haptic('selection');
    transitionRouteTimerRef.current = window.setTimeout(() => router.push('/favourites'), 680);
    transitionResetTimerRef.current = window.setTimeout(() => {
      transitioningRef.current = false;
      pullRef.current = 0;
      endReachedAtRef.current = 0;
      atEndRef.current = false;
      setExploreTransition(false);
      setTransitionOrigin(undefined);
      requestAnimationFrame(handleScroll);
    }, 1200);
  }, [handleScroll, router]);

  useEffect(() => {
    const rearm = () => {
      transitioningRef.current = false;
      pullRef.current = 0;
      endReachedAtRef.current = 0;
      atEndRef.current = false;
      setExploreTransition(false);
      setTransitionOrigin(undefined);
      requestAnimationFrame(handleScroll);
    };
    window.addEventListener('pageshow', rearm);
    return () => {
      window.removeEventListener('pageshow', rearm);
      if (transitionRouteTimerRef.current) clearTimeout(transitionRouteTimerRef.current);
      if (transitionResetTimerRef.current) clearTimeout(transitionResetTimerRef.current);
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

        <div className={styles.scoreDock}>
          <div ref={scoreRef} className={styles.scoreCircle}>
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
        </div>

        <div className={styles.belowFold}>
        <div className={styles.statsRow}>
          <div className={styles.statItem}><span><Heart /></span><b>{positiveSignals}</b><small>Positive</small></div>
          <div className={styles.statItem}><span><Users /></span><b>{profile?.ratingCount || 0}</b><small>Connections</small></div>
          <div className={styles.statItem}><span><Sparkles /></span><b>{goodActs}</b><small>Good acts</small></div>
        </div>

        {profile ? <ProfileRecognitionFolders profile={profile} isSelf communityLeadersHref="/leaderboard" /> : null}

        <div className={styles.insight}>
          <span><Activity /></span>
          <div><h3>{summary.delta >= 0 ? 'Your trust is trending upward' : 'Small reliable actions rebuild momentum'}</h3><p>Consistency, genuine interactions, and community help shape your score.</p></div>
        </div>

        {/* Explore Map — always renders; live/stored location improves its centre. */}
        <div className={styles.mapStage}>
          <div
            ref={mapWrapRef}
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
              />
            </div>
            <div className={styles.mapFade} />
          </div>

          <button type="button" className={styles.exploreCue} data-visible={atEnd} onClick={openExplore} aria-label="Continue to the Explore map">
            <ArrowUp aria-hidden="true" />
            <span>Swipe up to explore</span>
          </button>
        </div>
        </div>
      </div>

      <button type="button" onClick={openExplore} className={styles.nearbyPill} aria-label="Explore active people near you">
        <i aria-hidden="true" />
        <span>People near you</span>
        <strong>→</strong>
      </button>

      {exploreTransition ? (
        <div className={styles.exploreTransition} style={transitionOrigin} role="status" aria-label="Opening Explore map">
          <div className={styles.exploreTransitionMap}>
            <ExploreMap people={people} currentLocation={currentLocation} preview />
          </div>
        </div>
      ) : null}
    </section>
  );
}
