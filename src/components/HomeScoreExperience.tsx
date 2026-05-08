'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { Avatar } from '@/components/Avatar';
import { FriendsWorldMap, type FriendMapPerson } from '@/components/FriendsWorldMap';
import { toast } from '@/components/Toaster';
import { ThumbsDown, ThumbsUp } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { CANACT_SCORE_MIN, calculateCanactScore, getCanactScoreLabel } from '@/lib/canactScore';
import { useDistance } from '@/lib/distance';
import { db } from '@/lib/firebase';
import { setLikeDislike } from '@/lib/services/votes';
import type { UserProfile } from '@/lib/types';
import { formatDistance, haversineMeters } from '@/lib/utils';
import { useGeo } from '@/lib/useGeo';
import styles from './HomeScoreExperience.module.css';

type ScoreClassName = 'scoreExcellent' | 'scoreGood' | 'scoreFair' | 'scorePoor';
type HomeStage = 'score' | 'nearby';
type LastLocation = { lat?: unknown; lng?: unknown; at?: unknown };
type LocationPoint = { lat: number; lng: number; at?: number };
type UserWithLocation = Partial<UserProfile> & { uid?: string; lastLocation?: LastLocation };
type NearbyPerson = FriendMapPerson & { distanceMeters: number; rating?: number };

function getScoreClass(score: number): ScoreClassName {
  if (score >= 750) return 'scoreExcellent';
  if (score >= 650) return 'scoreGood';
  if (score >= 500) return 'scoreFair';
  return 'scorePoor';
}

function getScoreLabel(score: number) {
  return getCanactScoreLabel(score);
}

function easeInOutQuart(value: number) {
  return value < 0.5 ? 8 * value * value * value * value : 1 - ((-2 * value + 2) ** 4) / 2;
}

export function HomeScoreExperience() {
  const { user, profile } = useAuth();
  const { coords } = useGeo();
  const { radius } = useDistance();
  const [stage, setStage] = useState<HomeStage>('score');
  const [allProfiles, setAllProfiles] = useState<UserWithLocation[]>([]);
  const [ratedUids, setRatedUids] = useState<Set<string>>(() => new Set());
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [selectedMapPerson, setSelectedMapPerson] = useState<NearbyPerson | null>(null);
  const [ratingUid, setRatingUid] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [liveProfile, setLiveProfile] = useState<UserProfile | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; active: boolean } | null>(null);
  const stageGestureRef = useRef<{ startX: number; startY: number } | null>(null);
  const progressRef = useRef(0);
  const scoreProfile = liveProfile ?? profile;
  const scoreSummary = useMemo(() => calculateCanactScore(scoreProfile), [scoreProfile]);
  const firstName = useMemo(() => getFirstName(scoreProfile?.firstName || scoreProfile?.fullName), [scoreProfile?.firstName, scoreProfile?.fullName]);
  const circleRef = useRef<HTMLButtonElement | null>(null);
  const scoreWrapRef = useRef<HTMLDivElement | null>(null);
  const scoreInnerRef = useRef<HTMLDivElement | null>(null);
  const scoreNumRef = useRef<HTMLDivElement | null>(null);
  const scorePulseRef = useRef<HTMLDivElement | null>(null);
  const greetingRef = useRef<HTMLDivElement | null>(null);
  const scrollHintRef = useRef<HTMLDivElement | null>(null);
  const pillContentRef = useRef<HTMLDivElement | null>(null);
  const pillScoreRef = useRef<HTMLSpanElement | null>(null);
  const pillLabelRef = useRef<HTMLSpanElement | null>(null);
  const pillAuraRef = useRef<HTMLDivElement | null>(null);
  const prevScoreRef = useRef<number | null>(null);
  const scoreCounterFrameRef = useRef(0);
  const [layoutVersion, setLayoutVersion] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    const updateLayout = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setLayoutVersion((version) => version + 1));
    };
    window.addEventListener('resize', updateLayout);
    window.visualViewport?.addEventListener('resize', updateLayout);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateLayout);
      window.visualViewport?.removeEventListener('resize', updateLayout);
    };
  }, []);

  useEffect(() => {
    return onValue(ref(db, 'users'), (snapshot) => {
      const value = snapshot.val() as Record<string, UserWithLocation> | null;
      const profiles = Object.entries(value ?? {}).map(([uid, userProfile]) => ({ ...userProfile, uid: userProfile?.uid || uid }));
      setAllProfiles(profiles);
    });
  }, []);

  useEffect(() => {
    if (!user?.uid) { setLiveProfile(null); return; }
    return onValue(ref(db, `users/${user.uid}`), (snapshot) => {
      setLiveProfile(snapshot.val() as UserProfile | null);
    });
  }, [user?.uid]);

  const currentLocation = useMemo<LocationPoint | null>(() => {
    if (coords) return coords;
    return normalizeLocation((profile as UserWithLocation | null)?.lastLocation);
  }, [coords, profile]);

  const nearbyPeople = useMemo<NearbyPerson[]>(() => {
    if (!currentLocation || !user?.uid) return [];
    return allProfiles
      .map((candidate): NearbyPerson | null => {
        const uid = candidate.uid;
        const location = normalizeLocation(candidate.lastLocation);
        if (!uid || uid === user.uid || !location) return null;
        const distanceMeters = haversineMeters(currentLocation, location);
        if (Number.isFinite(radius) && distanceMeters > radius) return null;
        const person: NearbyPerson = {
          uid,
          name: candidate.fullName || candidate.firstName || 'Canact user',
          photoURL: candidate.photoURL ?? null,
          lat: location.lat,
          lng: location.lng,
          locationSource: 'live' as const,
          distanceMeters,
        };
        if (candidate.city) person.city = candidate.city;
        if (candidate.country) person.country = candidate.country;
        if (location.at) person.locationAt = location.at;
        if (typeof candidate.rating === 'number') person.rating = candidate.rating;
        return person;
      })
      .filter(isNearbyPerson)
      .sort((left, right) => left.distanceMeters - right.distanceMeters);
  }, [allProfiles, currentLocation, radius, user?.uid]);

  const unratedPeople = useMemo(() => nearbyPeople.filter((person) => !ratedUids.has(person.uid)), [nearbyPeople, ratedUids]);
  const activeCardPerson = unratedPeople[Math.min(activeCardIndex, Math.max(unratedPeople.length - 1, 0))] ?? null;

  useEffect(() => { setActiveCardIndex(0); }, [nearbyPeople.map((person) => person.uid).join('|')]);
  useEffect(() => {
    if (activeCardIndex >= unratedPeople.length) setActiveCardIndex(Math.max(unratedPeople.length - 1, 0));
  }, [activeCardIndex, unratedPeople.length]);

  useEffect(() => {
    const body = document.body;
    const html = document.documentElement;
    const shell = document.getElementById('canact-app-shell');
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousHtmlOverflow = html.style.overflow;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const previousShellHeight = shell?.style.height;
    const previousShellOverflow = shell?.style.overflow;

    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    if (shell) {
      shell.style.height = 'var(--canact-viewport-height)';
      shell.style.overflow = 'hidden';
    }

    return () => {
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscroll;
      html.style.overflow = previousHtmlOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      if (shell) {
        shell.style.height = previousShellHeight ?? '';
        shell.style.overflow = previousShellOverflow ?? '';
      }
    };
  }, []);

  useEffect(() => {
    const active = stage === 'nearby';
    document.documentElement.toggleAttribute('data-canact-home-nearby', active);
    document.documentElement.toggleAttribute('data-canact-map-fade', active);
    document.documentElement.toggleAttribute('data-canact-fullscreen-page', active);
    window.dispatchEvent(new CustomEvent('canact:set-page-blend-chrome', { detail: { active } }));
    return () => {
      document.documentElement.removeAttribute('data-canact-home-nearby');
      document.documentElement.removeAttribute('data-canact-map-fade');
      document.documentElement.removeAttribute('data-canact-fullscreen-page');
      window.dispatchEvent(new CustomEvent('canact:set-page-blend-chrome', { detail: { active: false } }));
    };
  }, [stage]);

  useEffect(() => {
    if (stage !== 'nearby') return;
    const root = document.documentElement;
    const properties = [
      '--canact-profile-top-rgb',
      '--canact-profile-bottom-rgb',
      '--canact-profile-top-ink',
      '--canact-profile-bottom-ink',
      '--canact-profile-top-light-opacity',
      '--canact-profile-top-dark-opacity',
      '--canact-profile-bottom-light-opacity',
      '--canact-profile-bottom-dark-opacity',
    ];
    properties.forEach((property) => root.style.removeProperty(property));
  }, [stage]);

  useEffect(() => {
    const circle = circleRef.current;
    const scoreWrap = scoreWrapRef.current;
    const scoreInner = scoreInnerRef.current;
    const scoreNum = scoreNumRef.current;
    const scorePulse = scorePulseRef.current;
    const greeting = greetingRef.current;
    const scrollHint = scrollHintRef.current;
    const pillContent = pillContentRef.current;
    const pillScore = pillScoreRef.current;
    const pillLabel = pillLabelRef.current;
    const pillAura = pillAuraRef.current;
    if (!circle || !scoreWrap || !scoreInner || !scoreNum || !scorePulse || !greeting || !scrollHint || !pillContent || !pillScore || !pillLabel || !pillAura) return;

    const currentScore = scoreSummary.score;

    const updatePill = (score: number) => {
      const className = getScoreClass(score);
      pillContent.className = `${styles.pillContent} ${styles[className]}`;
      pillScore.textContent = String(score);
      pillLabel.textContent = getScoreLabel(score);
    };

    const applyProgress = (progress: number) => {
      const eased = easeInOutQuart(progress);
      const stageRect = scoreWrap.parentElement?.getBoundingClientRect();
      const stageHeight = stageRect?.height || window.innerHeight;
      const viewportWidth = window.innerWidth || 390;
      const compactHeight = stageHeight < 620 || window.innerHeight < 740;
      const widthScale = Math.max(0.62, Math.min(1, (viewportWidth - 44) / 324));
      const heightScale = Math.max(0.54, Math.min(1, (stageHeight - (compactHeight ? 32 : 44)) / 334));
      const circleScale = Math.min(widthScale, heightScale);

      const startWidth = Math.round(304 * circleScale);
      const endWidth = Math.round(178 * Math.max(0.88, Math.min(1, widthScale)));
      const startHeight = startWidth;
      const endHeight = Math.round(46 * Math.max(0.92, Math.min(1, widthScale)));
      const width = startWidth - eased * (startWidth - endWidth);
      const height = startHeight - eased * (startHeight - endHeight);

      const startY = Math.round(Math.max(0, (stageHeight - startHeight) / 2));
      const header = document.querySelector('[data-canact-header]');
      const headerBottom = stageRect && header instanceof HTMLElement
        ? Math.max(0, header.getBoundingClientRect().bottom - stageRect.top)
        : 82;
      const endY = Math.round(Math.max(82, headerBottom + 10));
      const y = startY - eased * (startY - endY);
      const meterReveal = easeInOutQuart(Math.max(0, Math.min(1, (0.72 - progress) / 0.42)));
      const gradientBorderProgress = easeInOutQuart(Math.max(0, Math.min(1, (1 - progress) / 0.28)));

      const innerProgress = Math.min(progress / 0.42, 1);
      const innerOpacity = 1 - easeInOutQuart(innerProgress);
      const innerScale = 1 - innerProgress * 0.5;

      circle.style.width = `${width}px`;
      circle.style.height = `${height}px`;
      circle.style.borderRadius = `${height / 2}px`;
      circle.style.setProperty('--score-circle-scale', String(circleScale));
      circle.style.setProperty('--score-meter-opacity', String(meterReveal));
      circle.style.setProperty('--score-meter-scale', String(0.78 + meterReveal * 0.22));
      circle.style.setProperty('--score-gradient-border-width', `${3 + gradientBorderProgress * 7}px`);
      circle.toggleAttribute('data-pill-border', progress > 0.72);
      scoreWrap.style.transform = `translateY(${y}px)`;
      scoreInner.style.opacity = String(innerOpacity);
      scoreInner.style.transform = `scale(${innerScale})`;
      greeting.style.opacity = String(1 - Math.min(progress / 0.2, 1));
      greeting.style.transform = `translateY(${-eased * 50}px)`;
      scrollHint.style.opacity = String(1 - Math.min(progress / 0.15, 1));
      scorePulse.style.opacity = '0';
      pillAura.style.opacity = '0';

      if (progress > 0.86) {
        const textProgress = Math.min((progress - 0.86) / 0.10, 1);
        const textEase = easeInOutQuart(textProgress);
        pillContent.style.opacity = String(textEase);
        pillContent.style.transform = `translateY(${2 - 2 * textEase}px) scale(${0.96 + 0.04 * textEase})`;
        updatePill(currentScore);
      } else {
        pillContent.style.opacity = '0';
        pillContent.style.transform = 'translateY(2px) scale(.96)';
      }

      pillAura.style.transform = 'scale(.9)';
    };

    updatePill(currentScore);
    const startProgress = progressRef.current;
    const targetProgress = stage === 'nearby' ? 1 : 0;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animationFrame = 0;

    if (reduceMotion || Math.abs(startProgress - targetProgress) < 0.01) {
      progressRef.current = targetProgress;
      applyProgress(targetProgress);
    } else {
      const startedAt = performance.now();
      const duration = 420;
      const animate = (time: number) => {
        const progress = Math.min((time - startedAt) / duration, 1);
        const eased = easeInOutQuart(progress);
        const nextProgress = startProgress + (targetProgress - startProgress) * eased;
        progressRef.current = nextProgress;
        applyProgress(nextProgress);
        if (progress < 1) animationFrame = window.requestAnimationFrame(animate);
      };
      animationFrame = window.requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [layoutVersion, scoreSummary.score, stage]);

  // Animated sliding counter: animates from previous (or 0 on first mount) to
  // the current score, and toasts when the score changes between renders.
  useEffect(() => {
    const scoreNum = scoreNumRef.current;
    if (!scoreNum) return;
    const target = scoreSummary.score;
    const previous = prevScoreRef.current;
    prevScoreRef.current = target;

    if (previous != null && previous !== target) {
      const delta = target - previous;
      toast(
        `Canact score ${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)} → ${target}`,
        delta > 0 ? 'success' : 'info',
      );
    }

    const start = previous ?? 0;
    if (start === target) {
      scoreNum.textContent = String(target);
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      scoreNum.textContent = String(target);
      return;
    }

    if (scoreCounterFrameRef.current) window.cancelAnimationFrame(scoreCounterFrameRef.current);
    const startedAt = performance.now();
    const duration = previous == null ? 1400 : 700;
    const tick = (time: number) => {
      const progress = Math.min((time - startedAt) / duration, 1);
      const eased = easeInOutQuart(progress);
      const value = Math.round(start + (target - start) * eased);
      scoreNum.textContent = String(value);
      if (progress < 1) {
        scoreCounterFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        scoreCounterFrameRef.current = 0;
      }
    };
    scoreCounterFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (scoreCounterFrameRef.current) {
        window.cancelAnimationFrame(scoreCounterFrameRef.current);
        scoreCounterFrameRef.current = 0;
      }
    };
  }, [scoreSummary.score]);

  const showNearby = useCallback(() => {
    setStage('nearby');
  }, []);

  const showScore = useCallback(() => {
    setSelectedMapPerson(null);
    setStage('score');
  }, []);

  const handleStageWheel = useCallback((event: ReactWheelEvent<HTMLElement>) => {
    if (stage !== 'score') return;
    event.preventDefault();
    if (event.deltaY > 10) showNearby();
  }, [showNearby, stage]);

  const handleStagePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (stage !== 'score') return;
    stageGestureRef.current = { startX: event.clientX, startY: event.clientY };
  }, [stage]);

  const handleStagePointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (stage !== 'score') return;
    const gesture = stageGestureRef.current;
    stageGestureRef.current = null;
    if (!gesture) return;
    const deltaY = gesture.startY - event.clientY;
    const deltaX = Math.abs(gesture.startX - event.clientX);
    if (deltaY > 34 && deltaY > deltaX) showNearby();
  }, [showNearby, stage]);

  const handleMapPersonSelect = useCallback((person: FriendMapPerson) => {
    const nearbyPerson = nearbyPeople.find((candidate) => candidate.uid === person.uid);
    if (nearbyPerson) setSelectedMapPerson(nearbyPerson);
  }, [nearbyPeople]);

  const handleRate = useCallback(async (person: NearbyPerson, kind: 'like' | 'dislike') => {
    if (!user?.uid || ratingUid) return;
    setRatingUid(person.uid);
    try {
      await setLikeDislike(person.uid, user.uid, kind);
      setRatedUids((current) => {
        const next = new Set(current);
        next.add(person.uid);
        return next;
      });
      setSelectedMapPerson(null);
      setDragX(0);
      toast(kind === 'like' ? 'Liked' : 'Disliked', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not rate user', 'error');
    } finally {
      setRatingUid(null);
    }
  }, [ratingUid, user?.uid]);

  const handleCardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeCardPerson) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, active: true };
  }, [activeCardPerson]);

  const handleCardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const nextX = event.clientX - drag.startX;
    setDragX(Math.max(-130, Math.min(130, nextX)));
  }, []);

  const handleCardPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.active || !activeCardPerson) {
      setDragX(0);
      return;
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = Math.abs(event.clientY - drag.startY);
    if (Math.abs(deltaX) > 76 && Math.abs(deltaX) > deltaY) {
      void handleRate(activeCardPerson, deltaX > 0 ? 'like' : 'dislike');
      return;
    }
    setDragX(0);
  }, [activeCardPerson, handleRate]);

  const deltaLabel = scoreSummary.delta === 0
    ? `${scoreSummary.baseline} baseline`
    : `${scoreSummary.delta > 0 ? '↑' : '↓'} ${Math.abs(scoreSummary.delta)}`;
  const radiusLabel = Number.isFinite(radius) ? formatDistance(radius) : 'anywhere';
  const scoreMeterProgress = scoreSummary.max > CANACT_SCORE_MIN
    ? Math.max(0, Math.min(1, (scoreSummary.score - CANACT_SCORE_MIN) / (scoreSummary.max - CANACT_SCORE_MIN)))
    : 0;
  const meterArcLength = 79.5;
  const targetMeterFill = scoreMeterProgress * meterArcLength;
  const [revealedMeterFill, setRevealedMeterFill] = useState(0);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setRevealedMeterFill(targetMeterFill));
    });
    return () => window.cancelAnimationFrame(id);
  }, [targetMeterFill]);
  const scoreMeterStyle = {
    '--score-meter-arc': String(meterArcLength),
    '--score-meter-progress': String(revealedMeterFill),
  } as CSSProperties;

  return (
    <section
      className={`${styles.animationStage} ${stage === 'nearby' ? styles.stageNearby : ''}`}
      aria-label="Canact score"
      data-canact-no-refresh="true"
      onWheel={handleStageWheel}
      onPointerDown={handleStagePointerDown}
      onPointerUp={handleStagePointerUp}
    >
      <div className={`${styles.nearbyPanel} ${stage === 'nearby' ? styles.nearbyPanelActive : ''}`} aria-hidden={stage !== 'nearby'}>
        {currentLocation ? (
          <FriendsWorldMap
            friends={nearbyPeople}
            currentLocation={currentLocation}
            className={styles.nearbyMap}
            emptyTitle="No nearby users yet"
            emptyBody={`People inside ${radiusLabel} will appear here when they share a recent location.`}
            onPersonSelect={handleMapPersonSelect}
          />
        ) : (
          <div className={styles.nearbyEmpty}>
            <div className={styles.nearbyEmptyTitle}>Waiting for location</div>
            <div className={styles.nearbyEmptyBody}>Nearby people appear once your live location is available.</div>
          </div>
        )}
        <NearbyDeck
          person={activeCardPerson}
          total={unratedPeople.length}
          nearbyCount={nearbyPeople.length}
          dragX={dragX}
          ratingUid={ratingUid}
          onLike={(person) => handleRate(person, 'like')}
          onDislike={(person) => handleRate(person, 'dislike')}
          onPointerDown={handleCardPointerDown}
          onPointerMove={handleCardPointerMove}
          onPointerEnd={handleCardPointerEnd}
        />
        {selectedMapPerson ? (
          <MapRatingSheet
            person={selectedMapPerson}
            busy={ratingUid === selectedMapPerson.uid}
            onClose={() => setSelectedMapPerson(null)}
            onLike={() => handleRate(selectedMapPerson, 'like')}
            onDislike={() => handleRate(selectedMapPerson, 'dislike')}
          />
        ) : null}
      </div>

      <div className={styles.greeting} ref={greetingRef}>
        <h2>hey {firstName},</h2>
        <h1>you&apos;re in the <span>{scoreSummary.club} club</span> now</h1>
      </div>

      <div className={styles.scoreWrap} ref={scoreWrapRef}>
        <div className={styles.pillAura} ref={pillAuraRef} />
        <div className={styles.scoreCirclePulse} ref={scorePulseRef} />

        <button type="button" className={`${styles.scoreCircle} ${styles[getScoreClass(scoreSummary.score)]}`} ref={circleRef} style={scoreMeterStyle} onClick={() => { if (stage === 'nearby' || progressRef.current > 0.6) showScore(); }} aria-label="Canact score">
          <svg className={styles.scoreMeterSvg} viewBox="0 0 340 340" aria-hidden="true">
            <defs>
              <linearGradient id="home-score-meter-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--score-meter-start)" />
                <stop offset="100%" stopColor="var(--score-meter-end)" />
              </linearGradient>
            </defs>
            <path className={styles.scoreMeterTrack} d="M 75.734 295.55 A 157 157 0 1 1 264.266 295.55" pathLength="79.5" />
            <path className={styles.scoreMeterProgress} d="M 75.734 295.55 A 157 157 0 1 1 264.266 295.55" pathLength="79.5" />
          </svg>
          <div className={styles.scoreInner} ref={scoreInnerRef}>
            <div className={styles.scoreLabel}>canact score</div>
            <div className={styles.scoreNum} ref={scoreNumRef}>{scoreSummary.score}</div>
            <div className={styles.scoreChange}>{deltaLabel}</div>
            <div className={styles.scoreSource}>{scoreSummary.max} MAX</div>
          </div>

          <div className={`${styles.pillContent} ${styles[getScoreClass(scoreSummary.score)]}`} ref={pillContentRef}>
            <span className={styles.pillDot} />
            <span className={styles.pillScore} ref={pillScoreRef}>{scoreSummary.score}</span>
            <span className={styles.pillLabel} ref={pillLabelRef}>TRUST</span>
          </div>
        </button>
      </div>

      <div className={styles.hint} ref={scrollHintRef}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(220,20,60,.5)" strokeWidth="2" aria-hidden>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        scroll
      </div>
    </section>
  );
}

function NearbyDeck({
  person,
  total,
  nearbyCount,
  dragX,
  ratingUid,
  onLike,
  onDislike,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  person: NearbyPerson | null;
  total: number;
  nearbyCount: number;
  dragX: number;
  ratingUid: string | null;
  onLike: (person: NearbyPerson) => void | Promise<void>;
  onDislike: (person: NearbyPerson) => void | Promise<void>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const rotation = dragX / 18;
  return (
    <div className={styles.deckShell}>
      <div className={styles.deckMeta}>
        <span>Nearby</span>
        <span>{nearbyCount} found</span>
      </div>
      {person ? (
        <div
          className={styles.swipeCard}
          style={{ transform: `translateX(${dragX}px) rotate(${rotation}deg)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div className={styles.cardSignal} data-kind={dragX >= 0 ? 'like' : 'dislike'} style={{ opacity: Math.min(Math.abs(dragX) / 90, 1) }}>
            {dragX >= 0 ? 'LIKE' : 'DISLIKE'}
          </div>
          <Avatar src={person.photoURL ?? null} name={person.name} size={66} />
          <div className={styles.cardText}>
            <h3>{person.name}</h3>
            <p>{formatDistance(person.distanceMeters)} away{person.city ? ` · ${person.city}` : ''}</p>
          </div>
          <div className={styles.cardActions}>
            <button type="button" className={styles.dislikeButton} disabled={ratingUid === person.uid} onClick={() => onDislike(person)} aria-label="Dislike">
              <ThumbsDown size={20} />
            </button>
            <span>{Math.max(total, 1)} cards</span>
            <button type="button" className={styles.likeButton} disabled={ratingUid === person.uid} onClick={() => onLike(person)} aria-label="Like">
              <ThumbsUp size={20} />
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.emptyDeck}>
          <strong>No people left</strong>
          <span>{nearbyCount ? 'You rated everyone nearby.' : 'Nearby users will appear here.'}</span>
        </div>
      )}
    </div>
  );
}

function MapRatingSheet({
  person,
  busy,
  onClose,
  onLike,
  onDislike,
}: {
  person: NearbyPerson;
  busy: boolean;
  onClose: () => void;
  onLike: () => void | Promise<void>;
  onDislike: () => void | Promise<void>;
}) {
  return (
    <div className={styles.mapRatingSheet}>
      <button type="button" className={styles.sheetClose} onClick={onClose} aria-label="Close">×</button>
      <Avatar src={person.photoURL ?? null} name={person.name} size={54} />
      <div className={styles.sheetPersonText}>
        <strong>{person.name}</strong>
        <span>{formatDistance(person.distanceMeters)} away{person.city ? ` · ${person.city}` : ''}</span>
      </div>
      <div className={styles.sheetActions}>
        <button type="button" className={styles.dislikeButton} disabled={busy} onClick={onDislike} aria-label="Dislike">
          <ThumbsDown size={19} />
        </button>
        <button type="button" className={styles.likeButton} disabled={busy} onClick={onLike} aria-label="Like">
          <ThumbsUp size={19} />
        </button>
      </div>
    </div>
  );
}

function getFirstName(name?: string) {
  const trimmed = name?.trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0].toLowerCase();
}

function normalizeLocation(raw: LastLocation | null | undefined): LocationPoint | null {
  const lat = Number(raw?.lat);
  const lng = Number(raw?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const at = Number(raw?.at);
  return { lat, lng, at: Number.isFinite(at) ? at : undefined };
}

function isNearbyPerson(value: NearbyPerson | null): value is NearbyPerson {
  return !!value;
}