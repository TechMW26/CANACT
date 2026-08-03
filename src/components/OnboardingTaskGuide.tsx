'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { ref, update } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import {
  ONBOARDING_MAX_POINTS,
  ONBOARDING_TASKS,
  currentOnboardingTask,
  markOnboardingPromptShown,
  markOnboardingTour,
  recordOnboardingActivity,
  recordOnboardingSignal,
  snoozeOnboardingTask,
  type OnboardingProgress,
  type OnboardingTaskId,
} from '@/lib/services/onboarding';
import {
  isNativeContactSyncAvailable,
  parseVCardContacts,
  readAllDeviceContacts,
  syncContactRecords,
} from '@/lib/services/contactSync';
import { toast } from './Toaster';
import styles from './OnboardingTaskGuide.module.css';

type TourStep = { selector: string; eyebrow: string; title: string; body: string };
type SpotlightRect = { top: number; left: number; width: number; height: number; radius: number };

const ROUTE_TOURS: Record<string, TourStep[]> = {
  home: [
    { selector: '[data-onboarding="score"]', eyebrow: 'Your progress', title: 'Your Canact Score', body: 'Your score reflects positive impact, authentic engagement, and trust within your community.' },
    { selector: '[data-canact-score-target]', eyebrow: 'Live updates', title: 'Your score island', body: 'Points, new signals, and score changes arrive here without interrupting what you are doing.' },
    { selector: '[data-onboarding="recognition-folders"]', eyebrow: 'Recognition', title: 'Cards that mean something', body: 'View connection and lifetime cards you receive, and send meaningful cards to people who earned them.' },
    { selector: '[data-onboarding="home-map"]', eyebrow: 'Around you', title: 'A live community map', body: 'See activity and people nearby while keeping the map connected to your current location.' },
    { selector: '[data-onboarding="nearby-action"]', eyebrow: 'Start here', title: 'Meet people nearby', body: 'Open Explore when you are ready to recognise someone after a real interaction.' },
    { selector: '[data-canact-bottom-nav]', eyebrow: 'Move around', title: 'Your main navigation', body: 'Home, Explore, Feed and Leaderboard are always within reach.' },
  ],
  favourites: [
    { selector: '[data-canact-map="true"]', eyebrow: 'Explore', title: 'Your live nearby map', body: 'Activity, posts, stories and nearby people move with the map.' },
    { selector: '[data-onboarding="people-nearby"]', eyebrow: 'People nearby', title: 'Swipe through real people', body: 'Open the nearby panel to rate people only after a genuine interaction.' },
    { selector: '[data-canact-bottom-nav]', eyebrow: 'Navigate', title: 'Return anytime', body: 'Explore stays one tap away from every main screen.' },
  ],
  feed: [
    { selector: '[data-onboarding="feed"]', eyebrow: 'Community', title: 'What is happening around you', body: 'Nearby posts, polls, Rate Me activity, stories and reels live in one feed.' },
    { selector: '[data-onboarding="feed-stories"]', eyebrow: 'Fresh activity', title: 'Stories and filters', body: 'Catch recent moments or narrow the feed to the content you care about.' },
    { selector: '[data-canact-create-button]', eyebrow: 'Contribute', title: 'Create something useful', body: 'Share a post, poll, story, Rate Me session, or offer Help from this menu.' },
  ],
  leaderboard: [
    { selector: 'main', eyebrow: 'Community trust', title: 'See positive impact grow', body: 'Rankings refresh from real trust signals across your chosen community.' },
    { selector: '[data-canact-bottom-nav]', eyebrow: 'Navigate', title: 'Your main navigation', body: 'Move between your score, nearby activity and the community feed.' },
  ],
  profile: [
    { selector: 'main', eyebrow: 'Your identity', title: 'Your Canact profile', body: 'Your profile brings together trust, activity, recognition cards and helpful actions.' },
    { selector: '[data-onboarding="recognition-folders"]', eyebrow: 'Recognition', title: 'Connection and lifetime cards', body: 'Cards are separate from attributes and celebrate meaningful human impact.' },
  ],
  help: [
    { selector: 'main', eyebrow: 'Help', title: 'Show up when it matters', body: 'Respond only when you can genuinely contribute, then keep the Help flow updated.' },
    { selector: '[data-canact-create-button]', eyebrow: 'Ask or offer', title: 'Open the action menu', body: 'Create Help requests and other community activity from one consistent place.' },
  ],
};

export function OnboardingTaskGuide() {
  const { user, profile } = useAuth();
  const pathname = usePathname() || '/';
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const sentRef = useRef(new Set<string>());
  const previousPointsRef = useRef<number | null>(null);
  const promptTimerRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<OnboardingTaskId | null>(null);
  const [tour, setTour] = useState<{ key: string; steps: TourStep[]; index: number } | null>(null);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const [reward, setReward] = useState<{ id: number; points: number; style: CSSProperties } | null>(null);

  const progress = profile?.onboarding?.version === 1 ? profile.onboarding as OnboardingProgress : null;
  const activeTask = activeTaskId ? ONBOARDING_TASKS.find((item) => item.id === activeTaskId) ?? null : null;
  const completedCount = ONBOARDING_TASKS.filter((item) => progress?.completed?.[item.id]).length;
  const routeKey = routeTourKey(pathname);

  const candidateTask = useMemo(() => currentOnboardingTask(progress, pathname), [pathname, progress]);

  const signal = async (id: OnboardingTaskId) => {
    if (!user || sentRef.current.has(id)) return;
    sentRef.current.add(id);
    try { return await recordOnboardingSignal(user.uid, id); }
    catch (error) { sentRef.current.delete(id); throw error; }
  };

  useEffect(() => {
    if (!user || !progress) return;
    void recordOnboardingActivity(user.uid, pathname).catch(() => {});
  }, [pathname, progress?.version, user?.uid]);

  useEffect(() => {
    if (!user || !progress) return;
    if (profile?.profileComplete) void signal('complete-profile');
    if (profile?.photoURL) void signal('face-identity');
    if (profile?.profileVerified) void signal('verify-identity');
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') void signal('enable-notifications');
  }, [profile?.photoURL, profile?.profileComplete, profile?.profileVerified, progress?.version, user?.uid]);

  useEffect(() => {
    if (!progress) return;
    const next = Number(progress.points || 0);
    const previous = previousPointsRef.current;
    previousPointsRef.current = next;
    if (previous !== null && next > previous) launchReward(next - previous);
  }, [progress?.points]);

  useEffect(() => {
    if (activeTaskId && progress?.completed?.[activeTaskId]) setActiveTaskId(null);
  }, [activeTaskId, progress?.completed]);

  useEffect(() => {
    if (!user || !progress || activeTaskId || tour || !routeKey) return;
    if (progress.tours?.[routeKey]?.completedAt || progress.tours?.[routeKey]?.skippedAt) return;
    if (routeKey !== 'home' && !progress.tours?.home) return;
    const definitions = ROUTE_TOURS[routeKey] || [];
    const timer = window.setTimeout(() => {
      const steps = definitions.filter((step) => document.querySelector(step.selector));
      if (steps.length) setTour({ key: routeKey, steps, index: 0 });
    }, routeKey === 'home' ? 1000 : 1800);
    return () => window.clearTimeout(timer);
  }, [activeTaskId, progress, routeKey, tour, user?.uid]);

  useEffect(() => {
    if (!user || !progress || activeTaskId || tour || !candidateTask) return;
    if (promptTimerRef.current) window.clearTimeout(promptTimerRef.current);
    promptTimerRef.current = window.setTimeout(() => {
      setActiveTaskId(candidateTask.id);
      void markOnboardingPromptShown(user.uid, candidateTask.id);
    }, 1600);
    return () => { if (promptTimerRef.current) window.clearTimeout(promptTimerRef.current); };
  }, [activeTaskId, candidateTask?.id, progress?.version, tour, user?.uid]);

  useEffect(() => {
    if (!tour) { setSpotlight(null); return; }
    const element = document.querySelector(tour.steps[tour.index]?.selector);
    if (!(element instanceof HTMLElement)) { setSpotlight(null); return; }
    const updateSpotlight = () => {
      const rect = element.getBoundingClientRect();
      const pad = Math.min(14, Math.max(7, rect.width * 0.025));
      setSpotlight({
        top: Math.max(8, rect.top - pad),
        left: Math.max(8, rect.left - pad),
        width: Math.min(window.innerWidth - 16, rect.width + pad * 2),
        height: Math.min(window.innerHeight - 16, rect.height + pad * 2),
        radius: Math.min(34, Math.max(18, parseFloat(getComputedStyle(element).borderRadius) || 22)),
      });
    };
    const initialRect = element.getBoundingClientRect();
    const safeBottom = window.innerHeight - 318;
    if (initialRect.top < 12 || initialRect.bottom > safeBottom) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    updateSpotlight();
    const settleTimer = window.setTimeout(updateSpotlight, 460);
    window.addEventListener('scroll', updateSpotlight, { passive: true });
    window.addEventListener('resize', updateSpotlight);
    window.visualViewport?.addEventListener('resize', updateSpotlight);
    return () => {
      window.clearTimeout(settleTimer);
      window.removeEventListener('scroll', updateSpotlight);
      window.removeEventListener('resize', updateSpotlight);
      window.visualViewport?.removeEventListener('resize', updateSpotlight);
    };
  }, [tour]);

  if (!user || !progress) return null;

  const performAction = async () => {
    if (!activeTask) return;
    if (activeTask.id === 'sync-contacts') {
      if (!isNativeContactSyncAvailable()) { fileRef.current?.click(); return; }
      setBusy(true);
      try {
        const contacts = await readAllDeviceContacts();
        if (!contacts.length) return;
        const result = await syncContactRecords(contacts, profile?.countryCode);
        await signal('sync-contacts');
        toast(`${result.synced} contacts synced · ${result.matched} already on Canact · +${activeTask.points} points`, 'success');
      } catch (error: any) { if (error?.name !== 'AbortError') toast(error?.message || 'Could not sync contacts', 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (activeTask.id === 'enable-notifications') {
      setBusy(true);
      try {
        let granted = false;
        const cap = (window as any).Capacitor;
        if (cap?.isNativePlatform?.()) {
          const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
          granted = (await FirebaseMessaging.requestPermissions()).receive === 'granted';
        } else if (typeof Notification !== 'undefined') granted = (await Notification.requestPermission()) === 'granted';
        if (!granted) throw new Error('Notification permission was not granted');
        await signal(activeTask.id);
        toast('Notifications enabled', 'success');
      } catch (error: any) { toast(error?.message || 'Could not enable notifications', 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (activeTask.id === 'enable-location') {
      setBusy(true);
      try {
        const position = await requestLocation();
        await update(ref(db, `users/${user.uid}/lastLocation`), { lat: position.lat, lng: position.lng, at: Date.now() });
        await signal(activeTask.id);
        toast('Nearby discovery enabled', 'success');
      } catch (error: any) { toast(error?.message || 'Location permission is required', 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (activeTask.href) {
      setActiveTaskId(null);
      router.push(activeTask.href);
    }
  };

  const onContactFile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const contacts = parseVCardContacts(await file.text());
      if (!contacts.length) throw new Error('No contacts were found in that file');
      const result = await syncContactRecords(contacts, profile?.countryCode);
      await signal('sync-contacts');
      toast(`${result.synced} contacts synced · ${result.matched} already on Canact`, 'success');
    } catch (error: any) { toast(error?.message || 'Could not import contacts', 'error'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const snooze = async () => {
    if (!activeTask) return;
    setActiveTaskId(null);
    await snoozeOnboardingTask(user.uid, activeTask.id).catch(() => {});
  };

  const finishTour = async (outcome: 'completed' | 'skipped') => {
    if (!tour) return;
    const key = tour.key;
    setTour(null);
    await markOnboardingTour(user.uid, key, outcome).catch(() => {});
  };

  const advanceTour = () => {
    if (!tour) return;
    if (tour.index >= tour.steps.length - 1) { void finishTour('completed'); return; }
    setTour({ ...tour, index: tour.index + 1 });
  };

  const launchReward = (points: number) => {
    const target = findVisibleScoreTarget();
    const targetRect = target?.getBoundingClientRect();
    const startX = window.innerWidth / 2;
    const startY = Math.min(window.innerHeight * 0.72, window.innerHeight - 150);
    const endX = targetRect ? targetRect.left + targetRect.width / 2 : window.innerWidth / 2;
    const endY = targetRect ? targetRect.top + targetRect.height / 2 : 60;
    setReward({
      id: Date.now(),
      points,
      style: {
        left: startX,
        top: startY,
        '--reward-x': `${endX - startX}px`,
        '--reward-y': `${endY - startY}px`,
      } as CSSProperties,
    });
    window.dispatchEvent(new CustomEvent('canact:pill-emoji', { detail: { emoji: `+${points}` } }));
  };

  return (
    <>
      {tour && spotlight && typeof document !== 'undefined' ? createPortal(
        <div className={styles.tutorial} role="dialog" aria-modal="true" aria-label="Canact tutorial">
          <TutorialMask rect={spotlight} />
          <div className={styles.focusRing} style={{ top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height, borderRadius: spotlight.radius }} />
          <section className={styles.tutorialCard} data-placement={spotlight.top > window.innerHeight * .54 ? 'top' : 'bottom'}>
            <div className={styles.tutorialTopline}>
              <strong>{tour.index + 1} of {tour.steps.length}</strong>
              <button type="button" onClick={() => void finishTour('skipped')}>Skip tutorial</button>
            </div>
            <span className={styles.eyebrow}>{tour.steps[tour.index].eyebrow}</span>
            <h2>{tour.steps[tour.index].title}</h2>
            <p>{tour.steps[tour.index].body}</p>
            <div className={styles.tutorialFooter}>
              <div className={styles.dots}>{tour.steps.map((_, index) => <i key={index} data-active={index === tour.index} />)}</div>
              <button type="button" className={styles.next} onClick={advanceTour}>{tour.index === tour.steps.length - 1 ? 'Done' : 'Next'} <span>→</span></button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}

      {activeTask && typeof document !== 'undefined' ? createPortal(
        <div className={styles.guideLayer}>
          <div className={`${styles.taskBackdrop} canact-popup-backdrop`} aria-hidden="true" />
          <aside className={styles.guide} role="dialog" aria-modal="true" aria-live="polite" aria-label="Canact onboarding task">
            <div className={styles.progress}><span style={{ width: `${(Number(progress.points || 0) / ONBOARDING_MAX_POINTS) * 100}%` }} /></div>
            <div className={styles.taskHeader}>
              <span>{completedCount + 1} of {ONBOARDING_TASKS.length}</span>
              <button type="button" onClick={() => void snooze()}>Not now</button>
            </div>
            <div className={styles.body}>
              <div className={styles.points}>+{activeTask.points}</div>
              <div className={styles.copy}>
                <strong>{activeTask.title}</strong><p>{activeTask.description}</p>
                <div className={styles.meta}>{progress.points}/{ONBOARDING_MAX_POINTS} setup points</div>
              </div>
              <button type="button" className={styles.action} disabled={busy} onClick={() => void performAction()}>{busy ? 'Working…' : actionLabel(activeTask.id)} <span>→</span></button>
            </div>
          </aside>
        </div>,
        document.body,
      ) : null}

      <input ref={fileRef} className={styles.file} type="file" accept=".vcf,.vcard,text/vcard" aria-label="Import contacts file" onChange={(event) => void onContactFile(event.target.files?.[0])} />

      {reward && typeof document !== 'undefined' ? createPortal(
        <div key={reward.id} className={styles.reward} style={reward.style} onAnimationEnd={() => setReward(null)} aria-live="polite">+{reward.points}</div>,
        document.body,
      ) : null}
    </>
  );
}

function TutorialMask({ rect }: { rect: SpotlightRect }) {
  const common = { position: 'fixed' } as CSSProperties;
  return <>
    <div className={styles.mask} style={{ ...common, inset: `0 0 auto 0`, height: rect.top }} />
    <div className={styles.mask} style={{ ...common, top: rect.top, left: 0, width: rect.left, height: rect.height }} />
    <div className={styles.mask} style={{ ...common, top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} />
    <div className={styles.mask} style={{ ...common, top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
  </>;
}

function routeTourKey(pathname: string) {
  if (pathname === '/') return 'home';
  if (pathname.startsWith('/favourites')) return 'favourites';
  if (pathname.startsWith('/feed')) return 'feed';
  if (pathname.startsWith('/leaderboard')) return 'leaderboard';
  if (pathname.startsWith('/profile')) return 'profile';
  if (pathname.startsWith('/help')) return 'help';
  return '';
}

function findVisibleScoreTarget() {
  const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-onboarding="score"], [data-canact-score-target]'));
  return targets.find((element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  }) || null;
}

function actionLabel(id: OnboardingTaskId) {
  if (id === 'sync-contacts') return 'Sync contacts';
  if (id === 'enable-notifications' || id === 'enable-location') return 'Allow';
  if (id === 'verify-identity') return 'Verify';
  if (id === 'offer-help') return 'See requests';
  if (id === 'create-post') return 'Create post';
  return 'Open';
}

async function requestLocation() {
  const cap = (window as any).Capacitor;
  if (cap?.isNativePlatform?.()) {
    const { Geolocation } = await import('@capacitor/geolocation');
    const permission = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') throw new Error('Location permission was not granted');
    const result = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 15000 });
    return { lat: result.coords.latitude, lng: result.coords.longitude };
  }
  if (!navigator.geolocation) throw new Error('Location is not supported on this device');
  return new Promise<{ lat: number; lng: number }>((resolve, reject) => navigator.geolocation.getCurrentPosition(
    (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
    reject,
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 30000 },
  ));
}
