'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref, get } from 'firebase/database';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/Avatar';
import { FriendsWorldMap, type FriendMapPerson } from '@/components/FriendsWorldMap';
import { toast } from '@/components/Toaster';
import { ThumbsDown, ThumbsUp, UserPlus, UserMinus, MapPin, Heart, MessageSquare, Eye, Star } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { CANACT_SCORE_MIN, calculateCanactScore, getCanactScoreLabel } from '@/lib/canactScore';
import { useDistance } from '@/lib/distance';
import { db } from '@/lib/firebase';
import { setLikeDislike, setAttribute, SIX_HOURS } from '@/lib/services/votes';
import { listenUserWhaPosts } from '@/lib/services/wha';
import { sendFriendRequest, listenFriendStatus, unfriend } from '@/lib/services/friends';
import { requestFollow } from '@/lib/services/favourites';
import type { UserProfile, WhaPost, FriendStatus, AttrKey } from '@/lib/types';
import { POSITIVE_ATTRS, NEGATIVE_ATTRS, ATTR_LABELS } from '@/lib/types';
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

function easeInOutCubic(value: number) {
  return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2;
}

function seededUnit(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

type TipGlyph = {
  char: string;
  blur: number;
  yOffset: number;
  xOffset: number;
  delay: number;
};

function buildTipGlyphs(text: string, phaseSeed: number, originGlyphs?: TipGlyph[]): TipGlyph[] {
  const hasOrigin = Boolean(originGlyphs && originGlyphs.length);
  return Array.from(text).map((char, index) => {
    const baseSeed = (text.charCodeAt(index) || 32) * (index + 11 + phaseSeed);
    const ySign = seededUnit(baseSeed + 1) > 0.5 ? 1 : -1;
    const xSign = seededUnit(baseSeed + 2) > 0.5 ? 1 : -1;
    const blur = 3 + Math.floor(seededUnit(baseSeed + 3) * 4);
    const yOffset = (2 + Math.floor(seededUnit(baseSeed + 4) * 6)) * ySign;
    const xOffset = (2 + Math.floor(seededUnit(baseSeed + 5) * 6)) * xSign;
    const delay = index * 10;
    const origin = hasOrigin ? originGlyphs?.[index % (originGlyphs?.length || 1)] : null;
    return {
      char,
      blur: origin?.blur ?? blur,
      yOffset: origin?.yOffset ?? yOffset,
      xOffset: origin?.xOffset ?? xOffset,
      delay: origin?.delay ?? delay,
    };
  });
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
  const [expandedCardUid, setExpandedCardUid] = useState<string | null>(null);
  const [expandedCardPerson, setExpandedCardPerson] = useState<NearbyPerson | null>(null);
  const [expandedCardClosing, setExpandedCardClosing] = useState(false);
  const [expandedUserPosts, setExpandedUserPosts] = useState<WhaPost[]>([]);
  const [expandedPostIndex, setExpandedPostIndex] = useState(0);
  const [expandedFriendStatus, setExpandedFriendStatus] = useState<FriendStatus | null>(null);
  const [expandedBusy, setExpandedBusy] = useState(false);
  const [expandedCardProfile, setExpandedCardProfile] = useState<UserProfile | null>(null);
  const [expandedMyVoteAttr, setExpandedMyVoteAttr] = useState<{ key: AttrKey; at: number } | null>(null);
  const [ratingUid, setRatingUid] = useState<string | null>(null);
  const [dragX, setDragX] = useState(0);
  const [liveProfile, setLiveProfile] = useState<UserProfile | null>(null);
  const [ratedUidsWithCooldown, setRatedUidsWithCooldown] = useState<Map<string, number>>(() => new Map());
  const dragRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    isDrag: boolean;
    canOpen: boolean;
    fromInteractive: boolean;
  } | null>(null);
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
  const pillContentRef = useRef<HTMLDivElement | null>(null);
  const pillScoreRef = useRef<HTMLSpanElement | null>(null);
  const pillLabelRef = useRef<HTMLSpanElement | null>(null);
  const pillAuraRef = useRef<HTMLDivElement | null>(null);
  const prevScoreRef = useRef<number | null>(null);
  const scoreCounterFrameRef = useRef(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [tipEnterKey, setTipEnterKey] = useState(0);
  const [leavingTip, setLeavingTip] = useState<{ id: number; text: string } | null>(null);
  const [isPerfLite, setIsPerfLite] = useState(false);
  const stageTransitionDurationMs = isPerfLite ? 360 : 680;
  const stageTransitionStyle = {
    '--home-stage-transition-duration': `${stageTransitionDurationMs}ms`,
    '--home-stage-transition-ease': 'cubic-bezier(.33, 0, .2, 1)',
  } as CSSProperties;
  const stageRef = useRef<HTMLElement | null>(null);
  const tipCardRef = useRef<HTMLDivElement | null>(null);
  const tipPrevRef = useRef<string>('');
  const tipTransitionIdRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const nav = navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
        deviceMemory?: number;
      };
      const reduceMotion = media.matches;
      const lowCpu = typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency <= 4;
      const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
      const saveData = Boolean(nav.connection?.saveData);
      const slowNetwork = typeof nav.connection?.effectiveType === 'string' && /2g|3g/.test(nav.connection.effectiveType);
      setIsPerfLite(reduceMotion || lowCpu || lowMemory || saveData || slowNetwork);
    };
    update();
    media.addEventListener?.('change', update);
    return () => {
      media.removeEventListener?.('change', update);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frame = 0;
    let stabilizeTimerA = 0;
    let stabilizeTimerB = 0;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    const updateLayout = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setLayoutVersion((version) => version + 1));
    };

    const stageEl = stageRef.current;
    const headerEl = document.querySelector('[data-canact-header]');
    const spacerEl = document.querySelector('[data-canact-header-spacer]');
    const greetingEl = greetingRef.current;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => updateLayout());
      if (stageEl) resizeObserver.observe(stageEl);
      if (headerEl instanceof HTMLElement) resizeObserver.observe(headerEl);
      if (spacerEl instanceof HTMLElement) resizeObserver.observe(spacerEl);
      if (greetingEl) resizeObserver.observe(greetingEl);
    }

    if (headerEl instanceof HTMLElement && typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(() => updateLayout());
      mutationObserver.observe(headerEl, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    // iOS Safari can settle viewport + safe-area metrics after first paint.
    // Force two follow-up recalculations so the score ring starts aligned.
    stabilizeTimerA = window.setTimeout(updateLayout, 80);
    stabilizeTimerB = window.setTimeout(updateLayout, 320);
    window.setTimeout(updateLayout, 560);

    document.fonts?.ready.then(() => updateLayout()).catch(() => {});

    updateLayout();
    window.addEventListener('load', updateLayout);
    window.addEventListener('resize', updateLayout);
    window.addEventListener('orientationchange', updateLayout);
    window.visualViewport?.addEventListener('resize', updateLayout);
    window.visualViewport?.addEventListener('scroll', updateLayout);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (stabilizeTimerA) window.clearTimeout(stabilizeTimerA);
      if (stabilizeTimerB) window.clearTimeout(stabilizeTimerB);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener('load', updateLayout);
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('orientationchange', updateLayout);
      window.visualViewport?.removeEventListener('resize', updateLayout);
      window.visualViewport?.removeEventListener('scroll', updateLayout);
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

  const COOLDOWN_24H = 24 * 3600 * 1000;
  const unratedPeople = useMemo(() => {
    const now = Date.now();
    return nearbyPeople.filter((person) => {
      const ratedAt = ratedUidsWithCooldown.get(person.uid);
      if (!ratedAt) return true;
      return now - ratedAt >= COOLDOWN_24H;
    });
  }, [nearbyPeople, ratedUidsWithCooldown]);
  const activeCardPerson = unratedPeople[Math.min(activeCardIndex, Math.max(unratedPeople.length - 1, 0))] ?? null;
  const activeCardFocusPoint = useMemo(
    () => (activeCardPerson && typeof activeCardPerson.lat === 'number' && typeof activeCardPerson.lng === 'number'
      ? { lat: activeCardPerson.lat, lng: activeCardPerson.lng }
      : null),
    [activeCardPerson],
  );

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
    const scoreActive = stage === 'score';
    const fullScreenActive = active || scoreActive;
    document.documentElement.toggleAttribute('data-canact-home-nearby', active);
    document.documentElement.toggleAttribute('data-canact-home-score', scoreActive);
    document.documentElement.toggleAttribute('data-canact-map-fade', active);
    document.documentElement.toggleAttribute('data-canact-fullscreen-page', fullScreenActive);
    window.dispatchEvent(new CustomEvent('canact:set-page-blend-chrome', { detail: { active } }));
    return () => {
      document.documentElement.removeAttribute('data-canact-home-nearby');
      document.documentElement.removeAttribute('data-canact-home-score');
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

  useLayoutEffect(() => {
    const circle = circleRef.current;
    const scoreWrap = scoreWrapRef.current;
    const scoreInner = scoreInnerRef.current;
    const scoreNum = scoreNumRef.current;
    const scorePulse = scorePulseRef.current;
    const greeting = greetingRef.current;
    const tipCard = tipCardRef.current;
    const pillContent = pillContentRef.current;
    const pillScore = pillScoreRef.current;
    const pillLabel = pillLabelRef.current;
    const pillAura = pillAuraRef.current;
    if (!circle || !scoreWrap || !scoreInner || !scoreNum || !scorePulse || !greeting || !pillContent || !pillScore || !pillLabel || !pillAura) return;

    const currentScore = scoreSummary.score;

    const updatePill = (score: number) => {
      pillContent.className = styles.pillContent;
      pillScore.textContent = String(score);
      pillLabel.textContent = getScoreLabel(score);
    };

    const applyProgress = (progress: number) => {
      const eased = easeInOutCubic(progress);
      const stageRect = stageRef.current?.getBoundingClientRect();
      const stageHeight = window.innerHeight || stageRect?.height || scoreWrap.parentElement?.getBoundingClientRect().height || 0;
      const viewportWidth = window.innerWidth || 390;
      const compactHeight = stageHeight < 620 || window.innerHeight < 740;
      const widthScale = Math.max(0.62, Math.min(1, (viewportWidth - 44) / 324));
      const startWidth = Math.round(viewportWidth * .96);
      const circleScale = Math.max(.88, Math.min(1.2, startWidth / 304));
      const endWidth = Math.round(188 * Math.max(0.88, Math.min(1, widthScale)));
      const startHeight = startWidth;
      const endHeight = Math.round(44 * Math.max(0.92, Math.min(1, widthScale)));
      const width = startWidth - eased * (startWidth - endWidth);
      const height = startHeight - eased * (startHeight - endHeight);
      const meterInset = Math.max(10, Math.round(18 * (width / 304)));

      const header = document.querySelector('[data-canact-header]');
      const bottomNav = document.querySelector('[data-canact-bottom-nav]');
      const headerBottom = header instanceof HTMLElement ? header.getBoundingClientRect().bottom : 82;
      const navTop = bottomNav instanceof HTMLElement ? bottomNav.getBoundingClientRect().top : (window.innerHeight - 76);
      const laneTop = Math.max(0, headerBottom + 14);
      const laneBottom = Math.max(laneTop + startHeight, navTop - 14);
      const greetingHeight = greeting.getBoundingClientRect().height || 56;
      const tipStableHeight = 58;
      const contentCenterY = laneTop + ((laneBottom - laneTop) / 2);
      const minimumCenterY = laneTop + greetingHeight + 14 + (startHeight / 2);
      const maximumCenterY = laneBottom - tipStableHeight - 14 - (startHeight / 2);
      const startCenterY = Math.round(minimumCenterY <= maximumCenterY
        ? Math.min(maximumCenterY, Math.max(minimumCenterY, contentCenterY))
        : contentCenterY);
      const endCenterY = Math.round(Math.max(laneTop + (height / 2), headerBottom + 10 + (height / 2)));
      const y = startCenterY - eased * (startCenterY - endCenterY);
      const circleTop = y - (height / 2);
      const circleBottom = y + (height / 2);
      const surroundGap = Math.round(Math.max(compactHeight ? 12 : 22, Math.min(52, stageHeight * 0.06)));
      const tipBottomInset = 12;
      const greetingTop = Math.max(headerBottom + 10, Math.round(circleTop - surroundGap - greetingHeight));
      const tipTop = Math.round(Math.min(navTop - tipStableHeight - tipBottomInset, circleBottom + surroundGap));
      const meterReveal = easeInOutQuart(Math.max(0, Math.min(1, (0.72 - progress) / 0.42)));
      const gradientBorderProgress = easeInOutQuart(Math.max(0, Math.min(1, (1 - progress) / 0.28)));
      const pillReveal = easeInOutQuart(Math.max(0, Math.min(1, (progress - 0.72) / 0.22)));

      const innerProgress = Math.min(progress / 0.42, 1);
      const innerOpacity = 1 - easeInOutQuart(innerProgress);
      const innerScale = 1 - innerProgress * 0.5;

      circle.style.width = `${width}px`;
      circle.style.height = `${height}px`;
      scoreWrap.style.width = `${width}px`;
      circle.style.borderRadius = `${height / 2}px`;
      circle.style.setProperty('--score-circle-scale', String(circleScale));
      circle.style.setProperty('--score-meter-opacity', String(meterReveal));
      circle.style.setProperty('--score-meter-scale', String(0.78 + meterReveal * 0.22));
      circle.style.setProperty('--score-meter-inset', `${meterInset}px`);
      circle.style.setProperty('--score-gradient-border-width', `${2 + gradientBorderProgress * 2}px`);
      circle.style.setProperty('--score-pill-opacity', String(pillReveal));
      circle.style.setProperty('--score-pill-scale', String(0.985 + pillReveal * 0.015));
      circle.toggleAttribute('data-pill-border', progress > 0.72);
      scoreWrap.style.top = `${y}px`;
      scoreWrap.style.transform = 'translate(-50%, -50%)';
      greeting.style.top = `${greetingTop}px`;
      if (tipCard) tipCard.style.top = `${tipTop}px`;
      scoreInner.style.opacity = String(innerOpacity);
      scoreInner.style.transform = `scale(${innerScale})`;
      greeting.style.opacity = String(1 - Math.min(progress / 0.2, 1));
      greeting.style.transform = `translateY(${-eased * 50}px)`;
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
      const duration = stageTransitionDurationMs;
      const animate = (time: number) => {
        const progress = Math.min((time - startedAt) / duration, 1);
        const eased = easeInOutCubic(progress);
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
  }, [layoutVersion, scoreSummary.score, stage, stageTransitionDurationMs, tipIndex]);

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
    const duration = previous == null ? (isPerfLite ? 780 : 1400) : (isPerfLite ? 420 : 700);
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
  }, [isPerfLite, scoreSummary.score]);

  const showNearby = useCallback(() => {
    setStage('nearby');
  }, []);

  const showScore = useCallback(() => {
    setSelectedMapPerson(null);
    setStage('score');
  }, []);

  const nearbyAvatarUsers = useMemo(() => nearbyPeople.slice(0, 5), [nearbyPeople]);
  const nearbyAvatarOverflow = Math.max(0, nearbyPeople.length - nearbyAvatarUsers.length);

  const handleNearbyAvatarJump = useCallback(() => {
    showNearby();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      });
    });
  }, [showNearby]);

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
      setRatedUidsWithCooldown((current) => {
        const next = new Map(current);
        next.set(person.uid, Date.now());
        return next;
      });
      setSelectedMapPerson(null);
      setDragX(0);
      toast(kind === 'like' ? 'Liked · reappears in 24h' : 'Disliked · reappears in 24h', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not rate user', 'error');
    } finally {
      setRatingUid(null);
    }
  }, [ratingUid, user?.uid]);

  const handleCardPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeCardPerson) return;
    const target = event.target as HTMLElement | null;
    const fromInteractive = !!target?.closest('button, a, input, textarea, select, [data-no-card-open="true"]');
    if (fromInteractive) {
      dragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        isDrag: false,
        canOpen: false,
        fromInteractive: true,
      };
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // Keep the bottom controls strip tap-safe: opening the expanded card is
    // allowed only from the main body area, not from the lower actions zone.
    const withinOpenZone = (event.clientY - rect.top) <= Math.max(0, rect.height - 74);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      active: true,
      isDrag: false,
      canOpen: withinOpenZone,
      fromInteractive: false,
    };
  }, [activeCardPerson]);

  const handleCardPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.fromInteractive || !drag.active) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = Math.abs(event.clientY - drag.startY);
    
    if (!drag.isDrag && Math.abs(deltaX) > 8) {
      drag.isDrag = true;
    }
    
    if (drag.isDrag) {
      setDragX(Math.max(-130, Math.min(130, deltaX)));
    }
  }, []);

  const handleCardPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.fromInteractive || !drag.active || !activeCardPerson) {
      setDragX(0);
      return;
    }
    
    if (drag.isDrag) {
      const deltaX = event.clientX - drag.startX;
      const deltaY = Math.abs(event.clientY - drag.startY);
      if (Math.abs(deltaX) > 76 && Math.abs(deltaX) > deltaY) {
        const direction = deltaX > 0 ? 1 : -1;
        setDragX(direction * 180);
        window.setTimeout(() => {
          void handleRate(activeCardPerson, direction > 0 ? 'like' : 'dislike');
        }, 110);
        return;
      }
    } else if (drag.canOpen && expandedCardUid === null && !expandedCardClosing) {
      handleExpandCard(activeCardPerson);
    }
    setDragX(0);
  }, [activeCardPerson, expandedCardUid, expandedCardClosing, handleRate]);

  const handleExpandCard = useCallback((person: NearbyPerson) => {
    if (!user?.uid) return;
    setExpandedCardClosing(false);
    setExpandedFriendStatus(null);
    setExpandedCardPerson(person);
    setExpandedCardUid(person.uid);
    setExpandedPostIndex(0);
  }, [user?.uid]);

  const handleCloseExpandedCard = useCallback(() => {
    if (expandedCardClosing) return;
    setExpandedCardClosing(true);
  }, [expandedCardClosing]);

  const handleExpandedCardClosed = useCallback(() => {
    setExpandedCardUid(null);
    setExpandedCardPerson(null);
    setExpandedCardClosing(false);
    setExpandedFriendStatus(null);
    setExpandedUserPosts([]);
    setExpandedPostIndex(0);
    setDragX(0);
  }, []);

  useEffect(() => {
    if (!expandedCardClosing) return;
    const id = window.setTimeout(() => {
      handleExpandedCardClosed();
    }, 360);
    return () => window.clearTimeout(id);
  }, [expandedCardClosing, handleExpandedCardClosed]);

  const handleAddFriend = useCallback(async () => {
    if (!user?.uid || !user.displayName || !expandedCardUid) return;
    setExpandedBusy(true);
    try {
      const otherUserSnap = await get(ref(db, `users/${expandedCardUid}`));
      const otherUser = otherUserSnap.val() as UserProfile | null;
      if (!otherUser) {
        toast('User not found', 'error');
        return;
      }
      await sendFriendRequest(
        { uid: user.uid, name: user.displayName, photoURL: user.photoURL ?? undefined },
        { uid: expandedCardUid, name: otherUser.fullName || otherUser.firstName || 'Canact user', photoURL: otherUser.photoURL ?? undefined }
      );
      toast('Friend request sent', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not send friend request', 'error');
    } finally {
      setExpandedBusy(false);
    }
  }, [user?.uid, user?.displayName, user?.photoURL, expandedCardUid]);

  const handleNavigateToProfile = useCallback(() => {
    if (!expandedCardUid) return;
    window.location.href = `/profile/${expandedCardUid}`;
  }, [expandedCardUid]);

  const handleAddFavourite = useCallback(async () => {
    if (!user?.uid || !expandedCardUid) return;
    const name = profile?.fullName || user.displayName || 'Someone';
    try {
      await requestFollow(user.uid, name, expandedCardUid);
      toast('Favourite request sent', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not send favourite request', 'error');
    }
  }, [user?.uid, user?.displayName, profile?.fullName, expandedCardUid]);

  const handleUnfriend = useCallback(async () => {
    if (!user?.uid || !expandedCardUid) return;
    try {
      await unfriend(user.uid, expandedCardUid);
      toast('Removed from friends', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not remove friend', 'error');
    }
  }, [user?.uid, expandedCardUid]);

  useEffect(() => {
    if (!expandedCardUid || !user?.uid) return;
    const unsub = listenUserWhaPosts(expandedCardUid, (posts) => {
      setExpandedUserPosts(posts);
      const maxIndex = posts.length;
      if (expandedPostIndex > maxIndex) {
        setExpandedPostIndex(maxIndex);
      }
    });
    return unsub;
  }, [expandedCardUid, user?.uid, expandedPostIndex]);

  useEffect(() => {
    if (!expandedCardUid || !user?.uid) return;
    const unsub = listenFriendStatus(user.uid, expandedCardUid, (status) => {
      setExpandedFriendStatus(status);
    });
    return unsub;
  }, [expandedCardUid, user?.uid]);

  useEffect(() => {
    if (!expandedCardUid) return;
    return onValue(ref(db, `users/${expandedCardUid}`), (s) => setExpandedCardProfile(s.val() as UserProfile | null));
  }, [expandedCardUid]);

  useEffect(() => {
    if (!expandedCardUid || !user?.uid) return;
    return onValue(ref(db, `votes/${expandedCardUid}/${user.uid}`), (s) => {
      const vote = s.val() ?? {};
      setExpandedMyVoteAttr(vote?.attr ?? null);
    });
  }, [expandedCardUid, user?.uid]);

  const handleExpandedAttr = useCallback(async (k: AttrKey) => {
    if (!user?.uid || !expandedCardUid) return;
    try {
      const result = await setAttribute(expandedCardUid, user.uid, k);
      if (!result.ok) {
        const m = Math.ceil((result.waitMs ?? 0) / 60000);
        toast(`Wait ${Math.ceil(m / 60)}h to vote attributes again`, 'error');
      } else toast('Attribute updated', 'success');
    } catch (error: any) {
      toast(error?.message ?? 'Could not update attribute', 'error');
    }
  }, [user?.uid, expandedCardUid]);

  const deltaLabel = scoreSummary.delta === 0
    ? `${scoreSummary.baseline} baseline`
    : `${scoreSummary.delta > 0 ? '↑' : '↓'} ${Math.abs(scoreSummary.delta)}`;
  const scoreTips = useMemo(() => {
    const tips: string[] = [];
    if (scoreSummary.delta > 0) {
      tips.push(`Momentum up ${scoreSummary.delta}. Keep consistent responses to sustain growth.`);
    } else if (scoreSummary.delta < 0) {
      tips.push(`Momentum down ${Math.abs(scoreSummary.delta)}. A few reliable interactions can recover quickly.`);
    } else {
      tips.push('Your score is steady. Consistent quality interactions are the fastest way to move up.');
    }

    if (!scoreProfile?.photoURL) tips.push('Add a profile photo to improve trust signals for new viewers.');
    if ((scoreProfile?.city || '').trim().length === 0) tips.push('Set your city so nearby users can trust your location context.');
    if (scoreSummary.score < 750) {
      tips.push('Reply fast and avoid no-shows this week to push toward the next club.');
    } else {
      tips.push('You are in a high-trust tier. Protect it with reliable follow-through every day.');
    }

    return Array.from(new Set(tips)).slice(0, 5);
  }, [scoreProfile?.city, scoreProfile?.photoURL, scoreSummary.delta, scoreSummary.score]);
  const activeTip = scoreTips[tipIndex] ?? 'Small daily consistency keeps your trust score healthy.';
  const leavingTipGlyphs = useMemo(() => {
    if (isPerfLite) return [];
    if (!leavingTip) return [];
    return buildTipGlyphs(leavingTip.text, 73);
  }, [isPerfLite, leavingTip]);
  const activeTipGlyphs = useMemo(() => {
    if (isPerfLite) return [];
    const origin = leavingTipGlyphs.length ? leavingTipGlyphs : undefined;
    return buildTipGlyphs(activeTip, 17, origin);
  }, [activeTip, isPerfLite, leavingTipGlyphs]);

  useEffect(() => {
    setTipIndex(0);
  }, [scoreTips.join('|')]);

  useEffect(() => {
    if (stage !== 'score' || scoreTips.length <= 1) return;
    const id = window.setInterval(() => {
      setTipIndex((index) => (index + 1) % scoreTips.length);
    }, isPerfLite ? 5400 : 4200);
    return () => window.clearInterval(id);
  }, [isPerfLite, scoreTips.length, stage]);

  useEffect(() => {
    if (isPerfLite) {
      tipPrevRef.current = activeTip;
      if (leavingTip) setLeavingTip(null);
      return;
    }
    if (!tipPrevRef.current) {
      tipPrevRef.current = activeTip;
      return;
    }
    if (tipPrevRef.current === activeTip) return;
    tipTransitionIdRef.current += 1;
    setLeavingTip({ id: tipTransitionIdRef.current, text: tipPrevRef.current });
    setTipEnterKey((value) => value + 1);
    tipPrevRef.current = activeTip;
  }, [activeTip, isPerfLite, leavingTip]);

  useEffect(() => {
    if (!leavingTip) return;
    const id = window.setTimeout(() => {
      setLeavingTip((current) => (current?.id === leavingTip.id ? null : current));
    }, 980);
    return () => window.clearTimeout(id);
  }, [leavingTip]);
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
      ref={stageRef}
      className={`${styles.animationStage} ${stage === 'nearby' ? styles.stageNearby : ''} ${isPerfLite ? styles.perfLite : ''}`}
      style={stageTransitionStyle}
      aria-label="Canact score"
      data-canact-no-refresh="true"
      onWheel={handleStageWheel}
      onPointerDown={handleStagePointerDown}
      onPointerUp={handleStagePointerUp}
    >
      <div className={`${styles.nearbyPanel} ${stage === 'nearby' ? styles.nearbyPanelActive : ''}`} aria-hidden={stage !== 'nearby'}>
        {stage === 'nearby' && currentLocation ? (
          <FriendsWorldMap
            friends={nearbyPeople}
            currentLocation={currentLocation}
            focusPoint={activeCardFocusPoint}
            liteMode={isPerfLite}
            className={styles.nearbyMap}
            emptyTitle="No nearby users yet"
            emptyBody={`People inside ${radiusLabel} will appear here when they share a recent location.`}
            onPersonSelect={handleMapPersonSelect}
          />
        ) : stage === 'nearby' ? (
          <div className={styles.nearbyEmpty}>
            <div className={styles.nearbyEmptyTitle}>Waiting for location</div>
            <div className={styles.nearbyEmptyBody}>Nearby people appear once your live location is available.</div>
          </div>
        ) : null}
        <NearbyDeck
          people={unratedPeople}
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
        {expandedCardUid && expandedCardPerson && typeof document !== 'undefined'
          ? createPortal(
            <>
              <div
                aria-hidden="true"
                className={`${styles.expandedBackdrop} ${expandedCardClosing ? styles.expandedBackdropClosing : ''}`}
              />
              <ExpandedCardModal
                person={expandedCardPerson}
                personProfile={expandedCardProfile}
                posts={expandedUserPosts}
                postIndex={expandedPostIndex}
                friendStatus={expandedFriendStatus}
                busy={expandedBusy}
                dragX={dragX}
                ratingUid={ratingUid}
                myVoteAttr={expandedMyVoteAttr}
                isClosing={expandedCardClosing}
                onPostIndexChange={setExpandedPostIndex}
                onClose={handleCloseExpandedCard}
                onCloseComplete={handleExpandedCardClosed}
                onAddFriend={handleAddFriend}
                onAddFavourite={handleAddFavourite}
                onUnfriend={handleUnfriend}
                onNavigateProfile={handleNavigateToProfile}
                onAttr={handleExpandedAttr}
                onLike={() => handleRate(expandedCardPerson, 'like')}
                onDislike={() => handleRate(expandedCardPerson, 'dislike')}
                onPointerDown={handleCardPointerDown}
                onPointerMove={handleCardPointerMove}
                onPointerEnd={handleCardPointerEnd}
              />
            </>,
            document.body,
          )
          : null}
      </div>

      <div className={styles.greeting} ref={greetingRef}>
        {stage === 'score' ? (
          <button
            type="button"
            className={styles.greetingAvatarRail}
            onClick={handleNearbyAvatarJump}
            aria-label="Open nearby users"
          >
            <div className={styles.greetingAvatars}>
              {nearbyAvatarUsers.map((person, index) => (
                <span
                  key={`nearby-avatar-${person.uid}`}
                  className={styles.greetingAvatarItem}
                  style={{ zIndex: nearbyAvatarUsers.length - index } as CSSProperties}
                >
                  {person.photoURL ? (
                    <img className={styles.greetingAvatarImage} src={person.photoURL} alt={person.name || 'Nearby user'} />
                  ) : (
                    <span className={styles.greetingAvatarFallback}>{(person.name || '?').slice(0, 1).toUpperCase()}</span>
                  )}
                </span>
              ))}
              {nearbyAvatarOverflow > 0 ? (
                <span className={styles.greetingAvatarCount}>+{nearbyAvatarOverflow}</span>
              ) : null}
            </div>
            <span className={styles.greetingAvatarHint}>Nearby people</span>
          </button>
        ) : null}
        <h2>hey {firstName},</h2>
        <h1>you&apos;re in the <span>{scoreSummary.club} club</span> now</h1>
      </div>

      {stage === 'score' ? (
        <div ref={tipCardRef} className={styles.tipCard} aria-live="polite" aria-label={activeTip}>
          {isPerfLite ? (
            <span key={`lite-tip-${tipEnterKey}-${activeTip}`} className={styles.tipTextLite}>{activeTip}</span>
          ) : (
            <span className={styles.tipTextViewport} aria-hidden="true">
              {leavingTip ? (
                <span key={`leave-${leavingTip.id}`} className={`${styles.tipTextLayer} ${styles.tipTextLayerExit}`}>
                  {leavingTipGlyphs.map((glyph, index) => (
                    <span
                      key={`leave-${leavingTip.id}-${glyph.char}-${index}`}
                      className={`${styles.tipGlyph} ${styles.tipGlyphExit}`}
                      style={{
                        '--tip-shadow-y': `${glyph.yOffset}px`,
                        '--tip-shadow-x': `${glyph.xOffset}px`,
                        '--tip-shadow-blur': `${glyph.blur}px`,
                        '--tip-delay': `${glyph.delay}ms`,
                      } as CSSProperties}
                    >
                      {glyph.char === ' ' ? '\u00A0' : glyph.char}
                    </span>
                  ))}
                </span>
              ) : null}
              <span
                key={`enter-${tipEnterKey}-${activeTip}`}
                className={`${styles.tipTextLayer} ${styles.tipTextLayerEnter} ${leavingTip ? styles.tipTextLayerEnterDelayed : ''}`}
              >
                {activeTipGlyphs.map((glyph, index) => (
                  <span
                    key={`enter-${tipEnterKey}-${glyph.char}-${index}`}
                    className={`${styles.tipGlyph} ${styles.tipGlyphEnter}`}
                    style={{
                      '--tip-shadow-y': `${glyph.yOffset}px`,
                      '--tip-shadow-x': `${glyph.xOffset}px`,
                      '--tip-shadow-blur': `${glyph.blur}px`,
                      '--tip-delay': `${glyph.delay + (leavingTip ? 240 : 0)}ms`,
                    } as CSSProperties}
                  >
                    {glyph.char === ' ' ? '\u00A0' : glyph.char}
                  </span>
                ))}
              </span>
            </span>
          )}
        </div>
      ) : null}

      <div className={`${styles.scoreWrap} ${stage === 'score' ? styles.scoreWrapFixed : ''}`} ref={scoreWrapRef}>
        <div className={styles.pillAura} ref={pillAuraRef} />
        <div className={styles.scoreCirclePulse} ref={scorePulseRef} />

        <button type="button" className={`${styles.scoreCircle} ${styles[getScoreClass(scoreSummary.score)]}`} ref={circleRef} style={scoreMeterStyle} onClick={() => { if (stage === 'nearby' || progressRef.current > 0.6) showScore(); }} aria-label="Canact score">
          <div className={styles.scoreMeterCanvas} aria-hidden="true">
            <svg className={styles.scoreMeterSvg} viewBox="0 0 340 340">
              <defs>
                <linearGradient id="home-score-meter-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--score-meter-start)" />
                  <stop offset="100%" stopColor="var(--score-meter-end)" />
                </linearGradient>
              </defs>
              <path className={styles.scoreMeterTrack} d="M 75.734 295.55 A 157 157 0 1 1 264.266 295.55" pathLength="79.5" />
              <path className={styles.scoreMeterProgress} d="M 75.734 295.55 A 157 157 0 1 1 264.266 295.55" pathLength="79.5" />
            </svg>
          </div>
          <div className={styles.scoreInner} ref={scoreInnerRef}>
            <div className={styles.scoreLabel}>canact score</div>
            <div className={styles.scoreNum} ref={scoreNumRef}>{scoreSummary.score}</div>
            <div className={styles.scoreChange}>{deltaLabel}</div>
            <div className={styles.scoreSource}>{scoreSummary.max} MAX</div>
          </div>

          <div className={styles.scorePillFrame} aria-hidden="true">
            <div className={styles.scorePillFill} />
          </div>
          <div className={styles.pillContent} ref={pillContentRef}>
            <span className={styles.pillDot} />
            <span className={styles.pillScore} ref={pillScoreRef}>{scoreSummary.score}</span>
            <span className={styles.pillLabel} ref={pillLabelRef}>TRUST</span>
          </div>
        </button>
      </div>

    </section>
  );
}

function NearbyDeck({
  people,
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
  people: NearbyPerson[];
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
  const visibleDeckPeople = people.slice(0, 3);
  const person = visibleDeckPeople[0] ?? null;
  const stack = visibleDeckPeople.slice(1);
  const rotation = dragX / 18;
  return (
    <div className={styles.deckShell}>
      <div className={styles.deckMeta}>
        <span>Nearby</span>
        <span>{nearbyCount} found</span>
      </div>
      {stack.length > 0 ? (
        <div className={styles.deckStack} aria-hidden="true">
          {stack.slice().reverse().map((candidate, index) => {
            const depth = stack.length - index;
            return (
              <div
                key={candidate.uid}
                className={styles.swipeCardBack}
                style={{ '--stack-depth': String(depth) } as CSSProperties}
              >
                <div className={styles.cardBackContent}>
                  <Avatar src={candidate.photoURL ?? null} name={candidate.name} size={66} />
                  <div className={styles.cardBackText}>
                    <h4>{candidate.name}</h4>
                    <p>{formatDistance(candidate.distanceMeters)} away{candidate.city ? ` · ${candidate.city}` : ''}</p>
                  </div>
                  <div className={styles.cardBackActions}>
                    <span className={styles.cardBackGhostBtn} />
                    <span className={styles.cardBackCounter}>next</span>
                    <span className={styles.cardBackGhostBtn} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
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
          <div className={styles.cardActions} data-no-card-open="true">
            <button
              type="button"
              className={styles.dislikeButton}
              disabled={ratingUid === person.uid}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onDislike(person);
              }}
              aria-label="Dislike"
            >
              <ThumbsDown size={20} />
            </button>
            <span>{Math.max(total, 1)} cards</span>
            <button
              type="button"
              className={styles.likeButton}
              disabled={ratingUid === person.uid}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onLike(person);
              }}
              aria-label="Like"
            >
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

function ExpandedCardModal({
  person,
  personProfile,
  posts,
  postIndex,
  friendStatus,
  busy,
  dragX,
  ratingUid,
  myVoteAttr,
  isClosing,
  onPostIndexChange,
  onClose,
  onCloseComplete,
  onAddFriend,
  onAddFavourite,
  onUnfriend,
  onNavigateProfile,
  onAttr,
  onLike,
  onDislike,
  onPointerDown,
  onPointerMove,
  onPointerEnd,
}: {
  person: NearbyPerson;
  personProfile: UserProfile | null;
  posts: WhaPost[];
  postIndex: number;
  friendStatus: FriendStatus | null;
  busy: boolean;
  dragX: number;
  ratingUid: string | null;
  myVoteAttr: { key: AttrKey; at: number } | null;
  isClosing: boolean;
  onPostIndexChange: (index: number) => void;
  onClose: () => void;
  onCloseComplete: () => void;
  onAddFriend: () => void;
  onAddFavourite: () => void;
  onUnfriend: () => void;
  onNavigateProfile: () => void;
  onAttr: (attr: AttrKey) => Promise<void>;
  onLike: () => void | Promise<void>;
  onDislike: () => void | Promise<void>;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);
  const postGestureRef = useRef<{ postStartX: number; postStartY: number; active: boolean } | null>(null);
  const [postDragX, setPostDragX] = useState(0);
  const [postDragging, setPostDragging] = useState(false);
  const mediaItems = useMemo(() => {
    const items: Array<{ kind: 'profile' } | { kind: 'post'; post: WhaPost }> = [{ kind: 'profile' }];
    posts.forEach((post) => items.push({ kind: 'post', post }));
    return items;
  }, [posts]);
  
  const handlePostPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    postGestureRef.current = { postStartX: event.clientX, postStartY: event.clientY, active: true };
    setPostDragging(true);
  }, []);

  const handlePostPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!postGestureRef.current?.active) return;
    const deltaX = event.clientX - postGestureRef.current.postStartX;
    setPostDragX(Math.max(-130, Math.min(130, deltaX)));
  }, []);

  const handlePostPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = postGestureRef.current;
    postGestureRef.current = null;
    if (!gesture?.active) {
      setPostDragX(0);
      setPostDragging(false);
      return;
    }
    
    const deltaX = event.clientX - gesture.postStartX;
    const deltaY = Math.abs(event.clientY - gesture.postStartY);
    
    if (Math.abs(deltaX) > 76 && Math.abs(deltaX) > deltaY) {
      const nextIndex = deltaX > 0 ? postIndex - 1 : postIndex + 1;
      if (nextIndex >= 0 && nextIndex < mediaItems.length) {
        onPostIndexChange(nextIndex);
      }
      setPostDragX(0);
      setPostDragging(false);
    } else if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) {
      setPostDragX(0);
      setPostDragging(false);
      onNavigateProfile();
    } else {
      setPostDragX(0);
      setPostDragging(false);
    }
  }, [mediaItems.length, postIndex, onPostIndexChange, onNavigateProfile]);

  useEffect(() => {
    if (mediaItems.length <= 1 || postDragging || isClosing) return;
    const id = window.setInterval(() => {
      onPostIndexChange((postIndex + 1) % mediaItems.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [isClosing, mediaItems.length, onPostIndexChange, postDragging, postIndex]);

  const friendButtonText = friendStatus === 'requested' ? 'Requested' : friendStatus === 'incoming' ? 'Accept' : 'Add Friend';
  const friendButtonDisabled = friendStatus === null || friendStatus === 'friends' || friendStatus === 'requested' || busy;
  const expandedRotation = dragX / 18;
  const showFriendOptions = friendStatus === 'friends';

  useEffect(() => {
    if (isClosing) return;
    const maybeClose = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return;
      if (!modalRef.current?.contains(target)) onClose();
    };
    const onPointerDown = (event: PointerEvent) => maybeClose(event.target);
    const onWheel = (event: WheelEvent) => maybeClose(event.target);
    const onTouchMove = (event: TouchEvent) => maybeClose(event.target);

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('wheel', onWheel, true);
    document.addEventListener('touchmove', onTouchMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('wheel', onWheel, true);
      document.removeEventListener('touchmove', onTouchMove, true);
    };
  }, [isClosing, onClose]);

  const handleMessageFriend = useCallback(() => {
    window.location.href = `/inbox/${person.uid}`;
  }, [person.uid]);

  const handleViewProfile = useCallback(() => {
    window.location.href = `/profile/${person.uid}`;
  }, [person.uid]);
  
  return (
    <div
      ref={modalRef}
      className={`${styles.expandedModal} ${isClosing ? styles.expandedModalClosing : ''}`}
      style={{ transform: `translateX(calc(-50% + ${dragX}px)) rotate(${expandedRotation}deg)` }}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.propertyName !== 'opacity') return;
        if (isClosing) onCloseComplete();
      }}
    >
      <button type="button" className={styles.expandedClose} onClick={onClose} aria-label="Close">×</button>

      <div className={styles.expandedPostsSection}>
        <div
          className={styles.expandedPost}
          onPointerDown={handlePostPointerDown}
          onPointerMove={handlePostPointerMove}
          onPointerUp={handlePostPointerEnd}
          onPointerCancel={handlePostPointerEnd}
        >
          <div
            className={styles.expandedPostTrack}
            style={{
              transform: `translateX(calc(${-postIndex * 100}% + ${postDragX}px))`,
              transition: postDragging ? 'none' : 'transform .26s cubic-bezier(.22, .88, .32, 1)',
            }}
          >
            {mediaItems.map((item, index) => {
              const key = item.kind === 'profile' ? 'profile' : `post-${item.post.id || index}`;
              const mediaSrc = item.kind === 'post'
                ? (item.post.mediaPosters?.[0] || item.post.mediaUrls?.[0] || null)
                : person.photoURL;
              return (
                <div key={key} className={styles.expandedPostSlide}>
                  {mediaSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mediaSrc} alt={item.kind === 'profile' ? person.name : 'User post'} className={styles.expandedPostImage} />
                  ) : (
                    <div className={styles.expandedPostEmptyFallback}>
                      <Avatar src={null} name={person.name} size={124} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {mediaItems.length > 1 ? (
            <div className={styles.expandedPostDots}>
              {mediaItems.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  className={`${styles.expandedPostDot} ${index === postIndex ? styles.expandedPostDotActive : ''}`}
                  onClick={() => onPostIndexChange(index)}
                  aria-label={`Show media ${index + 1}`}
                />
              ))}
            </div>
          ) : null}
        </div>
        {posts.length === 0 ? (
          <div className={styles.expandedPostEmptyOverlay}>No posts yet</div>
        ) : null}
      </div>

      <div className={styles.expandedDetails}>
        <div className={styles.expandedPersonInfo}>
          <h2>{person.name}</h2>
          <p className={styles.expandedLocation}>
            <MapPin size={12} />
            {formatDistance(person.distanceMeters)} away {person.city ? `· ${person.city}` : ''}
          </p>
        </div>

        <div className={styles.expandedRatings}>
          {typeof person.rating === 'number' && (
            <div className={styles.expandedRatingItem}>
              <Heart size={14} />
              <span>{person.rating.toFixed(1)}</span>
            </div>
          )}
        </div>

        <div className={styles.expandedAttrSection}>
          <div className={styles.expandedAttrGroup}>
            <h3 className={styles.expandedAttrGroupTitle}>Positive Traits</h3>
            <div className={styles.expandedAttrs}>
              {POSITIVE_ATTRS.map((attr) => {
                const selected = myVoteAttr?.key === attr;
                const cooldownLeft = (() => {
                  if (!myVoteAttr?.at || myVoteAttr.key !== attr) return 0;
                  const left = SIX_HOURS - (Date.now() - myVoteAttr.at);
                  return left > 0 ? left : 0;
                })();
                const disabled = cooldownLeft > 0;
                const count = personProfile?.attrs?.[attr] ?? 0;
                return (
                  <button
                    key={attr}
                    type="button"
                    disabled={disabled}
                    onClick={() => onAttr(attr)}
                    className={`${styles.expandedAttrButton} ${selected ? styles.expandedAttrSelected : ''} ${disabled ? styles.expandedAttrDisabled : ''}`}
                    title={disabled ? `Available in ${Math.ceil(cooldownLeft / 3600000)}h` : undefined}
                  >
                    <span className={styles.expandedAttrName}>{ATTR_LABELS[attr]}</span>
                    <span className={styles.expandedAttrCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className={styles.expandedAttrGroup}>
            <h3 className={styles.expandedAttrGroupTitle}>Concerns</h3>
            <div className={styles.expandedAttrs}>
              {NEGATIVE_ATTRS.map((attr) => {
                const selected = myVoteAttr?.key === attr;
                const cooldownLeft = (() => {
                  if (!myVoteAttr?.at || myVoteAttr.key !== attr) return 0;
                  const left = SIX_HOURS - (Date.now() - myVoteAttr.at);
                  return left > 0 ? left : 0;
                })();
                const disabled = cooldownLeft > 0;
                const count = personProfile?.attrs?.[attr] ?? 0;
                return (
                  <button
                    key={attr}
                    type="button"
                    disabled={disabled}
                    onClick={() => onAttr(attr)}
                    className={`${styles.expandedAttrButton} ${selected ? styles.expandedAttrSelected : ''} ${disabled ? styles.expandedAttrDisabled : ''}`}
                    title={disabled ? `Available in ${Math.ceil(cooldownLeft / 3600000)}h` : undefined}
                  >
                    <span className={styles.expandedAttrName}>{ATTR_LABELS[attr]}</span>
                    <span className={styles.expandedAttrCount}>{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className={styles.expandedActions}>
          <button
            type="button"
            className={styles.dislikeButton}
            disabled={ratingUid === person.uid}
            onClick={onDislike}
            aria-label="Dislike"
          >
            <ThumbsDown size={20} />
          </button>
          {friendStatus === null ? (
            <div className={styles.expandedFriendOptionsLoading} aria-hidden="true">
              <span className={styles.friendOptionDot} />
              <span className={styles.friendOptionDot} />
              <span className={styles.friendOptionDot} />
              <span className={styles.friendOptionDot} />
            </div>
          ) : showFriendOptions ? (
            <div className={styles.expandedFriendOptions}>
              <button type="button" className={styles.friendOptionButton} onClick={handleMessageFriend} aria-label="Message friend" title="Message">
                <MessageSquare size={18} />
              </button>
              <button type="button" className={styles.friendOptionButton} onClick={handleViewProfile} aria-label="View profile" title="Profile">
                <Eye size={18} />
              </button>
              <button type="button" className={styles.friendOptionButton} onClick={onAddFavourite} aria-label="Add to favourites" title="Favourite">
                <Star size={18} />
              </button>
              <button type="button" className={styles.friendOptionButton} onClick={onUnfriend} aria-label="Remove friend" title="Unfriend">
                <UserMinus size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.friendButton}
              disabled={friendButtonDisabled}
              onClick={onAddFriend}
            >
              <UserPlus size={18} />
              {friendButtonText}
            </button>
          )}
          <button
            type="button"
            className={styles.likeButton}
            disabled={ratingUid === person.uid}
            onClick={onLike}
            aria-label="Like"
          >
            <ThumbsUp size={20} />
          </button>
        </div>
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
