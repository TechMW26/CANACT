'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { calculateCanactScore } from '@/lib/canactScore';
import { DistanceProvider, RADIUS_OPTIONS, useDistance } from '@/lib/distance';
import { Brand } from './Brand';
import { Avatar } from './Avatar';
import { PageTransition } from './PageTransition';
import { PullToRefresh } from './PullToRefresh';
import { PlusSheet } from './PlusSheet';
import { RadialCreateMenu } from './RadialCreateMenu';
import { PostDetailSheet, type PostDetailSheetItem } from './PostDetailSheet';
import { ShareToChatSheet } from './ShareToChatSheet';
import { VicinityTracker } from './VicinityTracker';
import { Splash } from './Splash';
import { IncomingCallRinger } from './IncomingCallRinger';
import { ScrollRestoration } from './ScrollRestoration';
import NativePermissionsBootstrapper from './NativePermissionsBootstrapper';
import NativeCallDeepLinkRouter from './NativeCallDeepLinkRouter';
import { HelpAlertManager } from './HelpAlertManager';
import { IncomingCardEnvelope } from './IncomingCardEnvelope';
import { OnboardingTaskGuide } from './OnboardingTaskGuide';
import { MandatoryPhoneSheet } from './MandatoryPhoneSheet';
import { haptic } from '@/lib/haptics';
import { useInboxBadges } from '@/lib/useInboxBadges';
import { ATTR_LABELS, NEGATIVE_ATTRS, POSITIVE_ATTRS, type ChatAttachment, type UserProfile } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import {
  Home, Compass, HeartHandshake, Plus, Trophy, UserIcon, Search, Bell, MessageSquare,
  Heart, Eye, Settings as SettingsIcon, Sparkles, MapPin, Grid3X3, Activity, Camera, Pencil, AlignLeft, X,
} from './icons';

type Tab = { href: string; label: string; Icon: LucideIcon; isFab?: boolean };

const TABS: Tab[] = [
  { href: '/',            label: 'Home',      Icon: Home },
  { href: '/favourites',  label: 'Nearby',    Icon: MapPin },
  { href: '/feed',        label: 'Community', Icon: Grid3X3 },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Activity },
];

const SIDE_LINKS = [
  { href: '/',             label: 'Home',          Icon: Home },
  { href: '/feed',         label: 'Feed',          Icon: Compass },
  { href: '/inbox',        label: 'Inbox',         Icon: MessageSquare },
  { href: '/help',         label: 'Help',          Icon: HeartHandshake },
  { href: '/leaderboard',  label: 'Leaderboard',   Icon: Trophy },
  { href: '/notifications',label: 'Notifications', Icon: Bell },
  { href: '/favourites',   label: 'Favourites',    Icon: Heart },
  { href: '/search',       label: 'Search',        Icon: Search },
  { href: '/underground',  label: 'Underground',   Icon: Eye },
  { href: '/profile',      label: 'My Profile',    Icon: UserIcon },
  { href: '/settings',     label: 'Settings',      Icon: SettingsIcon },
];

const ROUTE_PREFETCH_HREFS = [
  '/',
  '/feed',
  '/leaderboard',
  '/profile',
  '/favourites',
  '/search',
  '/inbox',
  '/help',
  '/notifications',
  '/settings',
  '/post/create',
  '/story/create',
  '/poll/create',
  '/rateme/start',
  '/help/create',
];

const LIQUID_GLASS_FILL_STYLE = { position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' } as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <DistanceProvider>
      <AppShellInner>{children}</AppShellInner>
    </DistanceProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [plusOpen, setPlusOpen] = useState(false);
  const [radialCreateOpen, setRadialCreateOpen] = useState(false);
  const [globalDetailItem, setGlobalDetailItem] = useState<PostDetailSheetItem | null>(null);
  const [postShareAttachment, setPostShareAttachment] = useState<ChatAttachment | null>(null);
  const [mobileHeaderTopInset, setMobileHeaderTopInset] = useState<string | null>(null);
  const [pageBlendChrome, setPageBlendChrome] = useState(false);
  const [navbarHrefs, setNavbarHrefs] = useState<{ tabs: string[]; plusIcon?: string; plusItems?: string[] } | null>(null);
  const prefetchedRoutesRef = useRef(new Set<string>());
  // Live counters for the chat icon (header) and Inbox sidebar entry.
  const { total: inboxTotal } = useInboxBadges();
  const routeProfileHero = false;
  const routeFadeChrome = !!pathname && pathname === '/favourites';
  const routeLeaderboard = pathname === '/leaderboard';
  const headerOverContent = pathname === '/' || pathname === '/favourites' || !!pathname?.startsWith('/profile');
  const profileChrome = routeProfileHero;
  const footerFadeChrome = !profileChrome && (routeFadeChrome || pageBlendChrome);
  const chromeOverContent = profileChrome || footerFadeChrome;

  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-canact-profile-route', routeProfileHero);
    return () => document.documentElement.removeAttribute('data-canact-profile-route');
  }, [routeProfileHero]);

  useEffect(() => {
    const onBlendChrome = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setPageBlendChrome(!!detail?.active);
    };
    window.addEventListener('canact:set-page-blend-chrome', onBlendChrome as EventListener);
    return () => window.removeEventListener('canact:set-page-blend-chrome', onBlendChrome as EventListener);
  }, []);

  // Read navbar visibility config from Firebase
  useEffect(() => {
    return onValue(dbRef(db, 'config/navbar'), (snap) => {
      const val = snap.val() as { tabs?: string[]; plusIcon?: string; plusItems?: string[] } | null;
      if (val) setNavbarHrefs({ tabs: val.tabs ?? [], plusIcon: val.plusIcon, plusItems: val.plusItems });
      else setNavbarHrefs(null);
    });
  }, []);

  const visibleTabs = useMemo(() => {
    if (!navbarHrefs) return TABS;
    return TABS.filter((t) => navbarHrefs.tabs.includes(t.href));
  }, [navbarHrefs]);

  const plusIconName = navbarHrefs?.plusIcon ?? 'Plus';

  const anyTabActive = useMemo(() => visibleTabs.some((t) => isNavLinkActive(pathname, t.href, user?.uid)), [pathname, visibleTabs, user?.uid]);

  const navWidth = useMemo(() => Math.max(180, visibleTabs.length * 60 + (visibleTabs.length - 1) * 10 + 16), [visibleTabs]);
  const BUTTON_SIZE = 76;
  const BUTTON_GAP = 24;
  const combinedWidth = navWidth + BUTTON_GAP + BUTTON_SIZE;

  const liquidNav = useLiquidNavSlider(pathname, user?.uid, router, visibleTabs);

  useEffect(() => { setPageBlendChrome(false); setRadialCreateOpen(false); }, [pathname]);

  const prefetchRoute = useCallback((href: string) => {
    if (href === '/create' || prefetchedRoutesRef.current.has(href)) return;
    prefetchedRoutesRef.current.add(href);
    try { router.prefetch(href); } catch { /* prefetch is best-effort */ }
  }, [router]);

  useEffect(() => {
    if (!user) return;
    const cancelIdle = scheduleIdleWork(() => {
      ROUTE_PREFETCH_HREFS.forEach(prefetchRoute);
    }, 1800);
    return cancelIdle;
  }, [prefetchRoute, user]);

  useEffect(() => {
    setMobileHeaderTopInset(getMobileHeaderTopInset());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--canact-header-top-inset', mobileHeaderTopInset ?? '0px');
    root.style.setProperty('--canact-map-header-fade-start', mobileHeaderTopInset ? `calc(${mobileHeaderTopInset} + 55px)` : '55px');
    return () => {
      root.style.removeProperty('--canact-header-top-inset');
      root.style.removeProperty('--canact-map-header-fade-start');
    };
  }, [mobileHeaderTopInset]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/welcome'); return; }
    if (profile?.profileComplete === false) router.replace('/onboard');
  }, [user, profile?.profileComplete, loading, router]);

  useEffect(() => {
    if (pathname !== '/create') return;
    if (loading || !user || !profile || profile.profileComplete === false) return;
    setPlusOpen(true);
    router.replace('/feed', { scroll: false });
  }, [pathname, router, loading, user, profile]);

  useEffect(() => {
    const item = detailPopupItemFromPath(pathname);
    if (!item) return;
    setGlobalDetailItem(item);
    router.replace('/feed', { scroll: false });
  }, [pathname, router]);

  useEffect(() => {
    const openDetailPopup = (event: Event) => {
      const path = (event as CustomEvent<{ path?: string }>).detail?.path;
      const item = detailPopupItemFromPath(path ?? null);
      if (!item) return;
      event.preventDefault();
      haptic('subtle');
      setGlobalDetailItem(item);
    };
    window.addEventListener('canact:open-detail', openDetailPopup);
    return () => window.removeEventListener('canact:open-detail', openDetailPopup);
  }, []);

  useEffect(() => {
    const openDetailPopupFromLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const item = detailPopupItemFromPath(url.pathname);
      if (!item) return;
      event.preventDefault();
      haptic('subtle');
      setGlobalDetailItem(item);
    };
    document.addEventListener('click', openDetailPopupFromLink, true);
    return () => document.removeEventListener('click', openDetailPopupFromLink, true);
  }, []);

  // Cold-start route restore was sending users back to /inbox/<uid>
  // (or whatever screen they had open last) when they reopened the
  // app — which the user expects to feel like a fresh launch and land
  // on home. We keep recording `canact:lastRoute` for in-session
  // recovery (e.g. WebView reload mid-call) but no longer hijack the
  // first navigation after a cold start.
  const restoredRouteRef = useRef(true);

  if (loading || !user || profile?.profileComplete === false) {
    // Mount the ringer + deep-link router OUTSIDE the splash return so a
    // call answered from the lockscreen notification doesn't have to wait
    // for the WebView to finish loading the full app + profile data
    // before WebRTC can start. As soon as the user object resolves the
    // ringer can subscribe to incomingCalls and pick up the pre-decision.
    return (
      <>
        <Splash message={loading ? 'Loading…' : profile?.profileComplete === false ? 'Finishing your registration…' : user ? 'Getting your profile…' : 'Loading…'} />
        <NativeCallDeepLinkRouter />
        {user ? <IncomingCallRinger /> : null}
      </>
    );
  }

  // Full-screen routes: hide the unified header, page transition wrapper, and
  // bottom nav so the page can own the entire viewport (chat threads, etc).
  const isFullScreen = !!pathname && /^\/inbox\/[^/]+/.test(pathname);
  const postPopups = (
    <>
      <MandatoryPhoneSheet />
      <PostDetailSheet
        item={globalDetailItem}
        myUid={user.uid}
        myName={profile?.fullName ?? 'You'}
        onClose={() => setGlobalDetailItem(null)}
        onShare={setPostShareAttachment}
      />
      <ShareToChatSheet
        open={!!postShareAttachment}
        onClose={() => setPostShareAttachment(null)}
        attachment={postShareAttachment}
      />
    </>
  );

  if (isFullScreen) {
    return (
      <div id="canact-app-shell" className="min-h-[var(--canact-viewport-height)]">
        <IncomingCardEnvelope uid={user.uid} />
        <ScrollRestoration />
        {/* Pull-to-refresh is intentionally NOT mounted on chat threads:
            those use their own scroll container and a downward swipe at the
            top of a conversation should never reload the page mid-message. */}
        <PageTransition>{children}</PageTransition>
        <OnboardingTaskGuide />
        <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
        {postPopups}
        <HelpAlertManager />
        <IncomingCallRinger />
        <NativeCallDeepLinkRouter />
      </div>
    );
  }

  return (
    <div id="canact-app-shell" className="min-h-[var(--canact-viewport-height)]">
      <IncomingCardEnvelope uid={user.uid} />
      <ScrollRestoration />
      {/* Global swipe-down-to-refresh — mounted once for the whole app so
          every page (feed, profile, leaderboard, etc.) gets the gesture
          without having to wrap its own root. Pages that maintain client
          subscriptions can listen for the `canact:pull-refresh` event. */}
      <PullToRefresh disabled={pathname !== '/feed'} />
      <OnboardingTaskGuide />
      {/* `canact-app-content` is the element that gets the zoom-out transform
          when a sheet opens. The bottom nav lives OUTSIDE this wrapper so it
          stays anchored to the viewport and never disappears during sheet
          open / close transitions. */}
      {/* Desktop layout: full viewport width with a FIXED sidebar pinned
          to the left edge and the main content stretching to fill the
          remaining space (offset by `lg:pl-60` so it doesn't slide under
          the sidebar). We use `fixed` instead of `sticky` because the
          shell has multiple ancestors with `overflow` set, and even the
          slightest CSS containment / transform on any of them silently
          breaks `position: sticky`. Fixed has none of those constraints. */}
      <div id="canact-app-content" data-disable-sheet-zoom={chromeOverContent ? 'true' : undefined} className="lg:w-full lg:pl-60 ">
      {/* Desktop sidebar — fixed to the viewport so it's always in view
          regardless of how far the main column scrolls. Hidden under lg
          (tablet portrait still gets the floating mobile header + bottom nav). */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:left-0 lg:top-0 lg:bottom-0 lg:w-60 lg:gap-1 lg:py-6 lg:px-4 lg:overflow-y-auto lg:bg-white/60 lg:backdrop-blur lg:border-r lg:border-line lg:z-[2147482600]">
        <div className="px-3 py-2 mb-2">
          <Brand size={32} href="/" />
        </div>
        {SIDE_LINKS.map(({ href, label, Icon }) => {
          const active = isNavLinkActive(pathname, href, user.uid);
          // Inbox link gets a live badge that includes both unread
          // messages and pending chat requests so the user can see at
          // a glance there's something to deal with.
          const inboxBadge = href === '/inbox' ? inboxTotal : 0;
          return (
            <Link
              key={href}
              href={href}
              prefetch
              onPointerEnter={() => prefetchRoute(href)}
              onPointerDown={() => prefetchRoute(href)}
              onFocus={() => prefetchRoute(href)}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${active ? 'bg-brand-light text-brand font-bold' : 'text-ink hover:bg-brand-light/60'}`}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
              <span className="flex-1">{label}</span>
              {inboxBadge > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-extrabold leading-none text-white">
                  {inboxBadge > 99 ? '99+' : inboxBadge}
                </span>
              )}
            </Link>
          );
        })}
        <button
          type="button"
          data-liquid-glass="surface"
          data-liquid-radius="999"
          data-liquid-tint="31,107,85"
          data-liquid-tint-opacity="0.18"
          onClick={() => { haptic('strong'); setPlusOpen(true); }}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-transparent py-2.5 font-semibold text-brand"
        >
          <Sparkles size={18} /> <span>Create</span>
        </button>
      </aside>

      <main className="flex-1 min-w-0 lg:px-6 lg:pt-6">
        <UnifiedHeader home={pathname === '/'} profileChrome={profileChrome} fadeChrome={false} leaderboard={routeLeaderboard} topInset={mobileHeaderTopInset} />
        <div
          className={`canact-col ${pathname === '/' ? 'pb-0' : 'pb-[var(--canact-bottom-nav-height)]'} lg:!max-w-none lg:w-full lg:mx-0 lg:px-6 lg:pb-6`}
          style={!headerOverContent ? { paddingTop: mobileHeaderTopInset ? `calc(${mobileHeaderTopInset} + 92px)` : '92px' } : undefined}
        ><PageTransition>{children}</PageTransition></div>
        <VicinityTracker />
        <IncomingCallRinger />
        <HelpAlertManager />
        <NativePermissionsBootstrapper />
        <NativeCallDeepLinkRouter />
      </main>
      </div>{/* /canact-app-content */}

      {/* Mobile bottom nav group — centered, button on right */}
      <div className="canact-bottom-group fixed bottom-0 z-40 flex items-end gap-[1.5em] lg:hidden"
        style={{ left: `calc(50% - ${combinedWidth / 2}px)`, paddingBottom: 'max(6px, calc(12px + env(safe-area-inset-bottom) - var(--canact-ios-bottom-shift, 0px)))' }}>
        <nav
          data-canact-bottom-nav
          className="canact-bottom-nav-shell"
          style={{ width: `${navWidth}px` }}
        >
          <div
            ref={liquidNav.navRef}
            data-liquid-glass="surface"
            data-liquid-radius="999"
            data-liquid-blur="0"
            data-liquid-tint="250,248,242"
            data-liquid-tint-opacity="0.12"
            className="canact-figma-bottom-nav"
          >
            <div className="canact-bottom-dock-items relative z-10 flex h-full items-center justify-center"
              style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 60px)`, gap: '10px' }}>
              <div ref={liquidNav.glowRef} className="canact-bottom-nav-glow" aria-hidden="true" />
              <div ref={liquidNav.indicatorRef} data-liquid-glass="switcher" data-liquid-radius="999" data-liquid-tint="31,107,85" data-liquid-tint-opacity="0.08" className="canact-bottom-tab-indicator" aria-hidden="true" style={{ opacity: anyTabActive ? 1 : 0, transform: anyTabActive ? undefined : 'scale(0)' }} />
              {visibleTabs.map(({ href, label, Icon, isFab }, tabIndex) => {
                const active = isNavLinkActive(pathname, href, user.uid);
                const onTap = () => {
                  if (isFab) { haptic('strong'); setPlusOpen(true); return; }
                  if (!active) haptic('selection');
                };
                const cls = `canact-bottom-tab group relative flex h-16 w-16 items-center justify-center rounded-[22px] transition-colors duration-300 ${
                  active ? 'canact-bottom-tab-active bg-[#e7e1d1] text-[#1a4f3f]' : 'canact-bottom-tab-inactive text-[#707981] hover:text-ink'
                }`;
                if (isFab) {
                  return (
                    <button key={href} type="button" onPointerDown={(event) => liquidNav.begin(tabIndex, event)} onClick={(event) => { if (!liquidNav.consumeClick(event)) onTap(); }} aria-label="Create" className={cls}>
                      <Icon className="canact-adaptive-icon" size={25} strokeWidth={active ? 2.3 : 1.8} />
                    </button>
                  );
                }
                return (
                  <Link key={href} href={href} aria-label={label} prefetch onPointerEnter={() => prefetchRoute(href)} onPointerDown={(event) => { prefetchRoute(href); liquidNav.begin(tabIndex, event); }} onFocus={() => prefetchRoute(href)} onClick={(event) => { if (!liquidNav.consumeClick(event)) onTap(); }} className={cls}>
                    <Icon className="canact-adaptive-icon" size={25} strokeWidth={active ? 2.3 : 1.8} />
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </div>{/* /canact-bottom-group */}
      <button
        type="button"
        data-canact-create-button
        aria-label={radialCreateOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={radialCreateOpen}
        aria-controls="canact-radial-create-menu"
        data-liquid-glass="surface"
        data-liquid-radius="999"
        data-liquid-blur="0"
        data-liquid-thickness="28"
        data-liquid-bezel="18"
        data-liquid-specular-opacity="0.42"
        data-liquid-balanced-specular="true"
        data-liquid-tint="31,107,85"
        data-liquid-tint-opacity="0.14"
        onClick={() => { haptic('strong'); setRadialCreateOpen((value) => !value); }}
        className={`canact-create-nav-button fixed ${radialCreateOpen ? 'canact-create-nav-button-open' : ''} lg:hidden`}
        style={{
          left: `calc(50% - ${combinedWidth / 2}px + ${navWidth + BUTTON_GAP}px)`,
          bottom: 'max(6px, calc(12px + env(safe-area-inset-bottom) - var(--canact-ios-bottom-shift, 0px)))',
        }}
      >
        {radialCreateOpen ? <X className="canact-adaptive-icon" size={29} strokeWidth={2.3} style={{ color: '#1f6b55' }} /> : renderPlusIcon(plusIconName)}
      </button>
      <RadialCreateMenu open={radialCreateOpen} onClose={() => setRadialCreateOpen(false)} plusItems={navbarHrefs?.plusItems} />
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
      {postPopups}
    </div>
  );
}

function renderPlusIcon(name: string) {
  const size = 29; const sw = 2.3;
  const cls = 'canact-adaptive-icon canact-create-nav-icon';
  switch (name) {
    case 'Sparkles': return <Sparkles className={cls} size={size} strokeWidth={sw} />;
    case 'Camera': return <Camera className={cls} size={size} strokeWidth={sw} />;
    case 'Pencil': return <Pencil className={cls} size={size} strokeWidth={sw} />;
    case 'Menu': return <AlignLeft className={cls} size={size} strokeWidth={sw} />;
    default: return <Plus className={cls} size={size} strokeWidth={sw} />;
  }
}

function useLiquidNavSlider(pathname: string | null, userId: string | undefined, router: ReturnType<typeof useRouter>, tabs: Tab[]) {
  const navRef = useRef<HTMLDivElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const suppressClickUntil = useRef(0);
  const finishTimer = useRef(0);

  const activeIndex = useCallback(() => Math.max(0, tabs.findIndex((tab) => isNavLinkActive(pathname, tab.href, userId))), [pathname, userId, tabs]);
  const metrics = useCallback((index: number) => {
    const nav = navRef.current;
    const item = nav?.querySelectorAll<HTMLElement>('.canact-bottom-tab')[index];
    if (!nav || !item) return { left: 8, width: 56, center: 36 };
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const scale = navRect.width > 0 ? nav.clientWidth / navRect.width : 1;
    const left = (itemRect.left - navRect.left) * scale;
    const width = itemRect.width * scale;
    return { left, width, center: left + width / 2 };
  }, []);
  const snap = useCallback((index: number, animate: boolean) => {
    const indicator = indicatorRef.current;
    if (!indicator) return;
    const item = metrics(index);
    if (!animate) indicator.style.transition = 'none';
    indicator.style.left = `${item.left}px`;
    indicator.style.width = `${item.width}px`;
    if (!animate) requestAnimationFrame(() => { if (indicator) indicator.style.transition = ''; });
  }, [metrics]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => snap(activeIndex(), false));
    const onResize = () => snap(activeIndex(), false);
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [activeIndex, snap]);

  useEffect(() => () => { if (finishTimer.current) window.clearTimeout(finishTimer.current); }, []);

  const begin = useCallback((pressedIndex: number, event: React.PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    if (!nav || !indicator) return;
    event.preventDefault();
    nav.setPointerCapture?.(event.pointerId);
    if (finishTimer.current) window.clearTimeout(finishTimer.current);
    const startX = event.clientX;
    const startY = event.clientY;
    const pressedWidth = metrics(pressedIndex).width;
    let dragging = false;
    let targetIndex = pressedIndex;
    indicator.classList.add('interacting');
    nav.classList.add('engaged');

    const localX = (clientX: number) => {
      const rect = nav.getBoundingClientRect();
      return (clientX - rect.left) * (rect.width > 0 ? nav.clientWidth / rect.width : 1);
    };
    const setGlow = (clientX: number, clientY: number, alpha: number) => {
      const rect = nav.getBoundingClientRect();
      nav.style.setProperty('--gx', `${localX(clientX)}px`);
      nav.style.setProperty('--gy', `${clientY - rect.top}px`);
      nav.style.setProperty('--ga', String(alpha));
    };
    const nearest = (x: number) => {
      let result = 0;
      let distance = Number.POSITIVE_INFINITY;
      tabs.forEach((_, index) => {
        const nextDistance = Math.abs(x - metrics(index).center);
        if (nextDistance < distance) { distance = nextDistance; result = index; }
      });
      return result;
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const deltaX = Math.abs(moveEvent.clientX - startX);
      const deltaY = Math.abs(moveEvent.clientY - startY);
      if (!dragging && (deltaX > 6 || deltaY > 6)) { dragging = true; nav.classList.add('dragging'); }
      setGlow(moveEvent.clientX, moveEvent.clientY, dragging ? .18 : .22);
      if (!dragging) return;
      const x = localX(moveEvent.clientX);
      const left = Math.min(nav.clientWidth - pressedWidth + 22, Math.max(-22, x - pressedWidth / 2));
      indicator.style.left = `${left}px`;
      indicator.style.width = `${pressedWidth}px`;
      targetIndex = nearest(x);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const settle = () => {
      nav.classList.remove('dragging');
      snap(targetIndex, true);
      suppressClickUntil.current = performance.now() + 600;
      const target = tabs[targetIndex];
      if (target && !isNavLinkActive(pathname, target.href, userId)) {
        haptic('selection');
        router.push(target.href);
      }
      finishTimer.current = window.setTimeout(() => {
        indicator.classList.remove('interacting');
        nav.classList.remove('engaged');
        nav.style.setProperty('--ga', '0');
      }, 500);
    };
    function onUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== event.pointerId) return;
      cleanup();
      settle();
    }
    function onCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== event.pointerId) return;
      cleanup();
      nav!.classList.remove('dragging', 'engaged');
      indicator!.classList.remove('interacting');
      nav!.style.setProperty('--ga', '0');
      snap(activeIndex(), true);
    }
    setGlow(event.clientX, event.clientY, .24);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }, [activeIndex, metrics, pathname, router, snap, userId]);

  const consumeClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (event.detail === 0 || performance.now() > suppressClickUntil.current) return false;
    event.preventDefault();
    return true;
  }, []);

  return { navRef, indicatorRef, glowRef, begin, consumeClick };
}

function isNavLinkActive(pathname: string | null, href: string, currentUid?: string | null) {
  if (!pathname) return false;
  if (href === '/profile') {
    return pathname === '/profile' || (!!currentUid && pathname === `/profile/${encodeURIComponent(currentUid)}`);
  }
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function detailPopupItemFromPath(path: string | null): PostDetailSheetItem | null {
  if (!path) return null;
  const match = path.match(/^\/(post|poll|rateme)\/([^/]+)$/);
  if (!match) return null;
  const [, routeKind, rawId] = match;
  if ((routeKind === 'post' && rawId === 'create') || (routeKind === 'poll' && rawId === 'create') || (routeKind === 'rateme' && rawId === 'start')) return null;
  const id = decodeURIComponent(rawId);
  if (routeKind === 'post') return { kind: 'wha', id };
  if (routeKind === 'poll') return { kind: 'poll', id };
  return { kind: 'rateme', id };
}

function getMobileHeaderTopInset() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  if (isIOSDevice()) return 'max(env(safe-area-inset-top, 0px), 12px)';
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  if (!isAndroid) return null;
  const nativeShell = 'Capacitor' in window;
  const androidWebView = /; wv\)|\bwv\b/i.test(ua);
  const standalone = !!(
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches
  );
  return nativeShell || androidWebView || standalone ? 'max(env(safe-area-inset-top, 0px), 24px)' : null;
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function scheduleIdleWork(callback: () => void, timeout: number) {
  if (typeof window === 'undefined') return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const id = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 500);
  return () => window.clearTimeout(id);
}

function titleFor(path: string | null) {
  if (!path) return '';
  if (path === '/') return 'Home';
  if (path.startsWith('/feed')) return 'Feed';
  if (path.startsWith('/help')) return 'Help';
  if (path.startsWith('/create')) return 'Create';
  if (path.startsWith('/leaderboard')) return 'Leaderboard';
  if (path.startsWith('/profile')) return 'Profile';
  if (path.startsWith('/notifications')) return 'Notifications';
  if (path.startsWith('/favourites')) return 'Favourites';
  if (path.startsWith('/search')) return 'Search';
  if (path.startsWith('/underground')) return 'Underground';
  if (path.startsWith('/settings')) return 'Settings';
  if (path.startsWith('/edit-profile')) return 'Edit profile';
  return '';
}

function UnifiedHeader({ home = false, profileChrome = false, fadeChrome = false, leaderboard = false, topInset }: { home?: boolean; profileChrome?: boolean; fadeChrome?: boolean; leaderboard?: boolean; topInset?: string | null }) {
  const { radiusIdx, setRadiusIdx } = useDistance();
  const { user, profile } = useAuth();
  const [avatarPopup, setAvatarPopup] = useState(false);
  const [sidebarMounted, setSidebarMounted] = useState(false);
  const [sidebarEntered, setSidebarEntered] = useState(false);
  const [islandOpen, setIslandOpen] = useState(false);
  const islandRef = useRef<HTMLDivElement | null>(null);
  const islandPortalRef = useRef<HTMLDivElement | null>(null);
  const [islandAnchor, setIslandAnchor] = useState<{ top: number; left: number; expandedWidth: number } | null>(null);
  const [islandPortalMounted, setIslandPortalMounted] = useState(false);
  const [liveScore, setLiveScore] = useState(0);
  const [liveSummary, setLiveSummary] = useState<ReturnType<typeof calculateCanactScore> | null>(null);
  const prevScoreRef = useRef(0);
  const prevLikesRef = useRef<number | null>(null);
  const [scoreDelta, setScoreDelta] = useState(0);
  const [islandMoment, setIslandMoment] = useState<{ icon: string; label: string; tone: 'positive' | 'negative' | 'neutral' } | null>(null);
  const islandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deltaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerIslandMoment = useCallback((icon: string, label: string, tone: 'positive' | 'negative' | 'neutral' = 'neutral') => {
    setIslandMoment({ icon, label, tone });
    if (islandTimerRef.current) clearTimeout(islandTimerRef.current);
    islandTimerRef.current = setTimeout(() => { islandTimerRef.current = null; setIslandMoment(null); }, 2800);
  }, []);

  // Real-time score listener with delta tracking
  useEffect(() => {
    if (!user) return;
    prevScoreRef.current = 0;
    prevLikesRef.current = null;
    return onValue(dbRef(db, `users/${user.uid}`), (snap) => {
      const p = snap.val() as UserProfile | null;
      if (p) {
        const s = calculateCanactScore(p);
        const prev = prevScoreRef.current;
        const previousLikes = prevLikesRef.current;
        const likeDelta = previousLikes === null ? 0 : Math.max(0, (p.likesCount || 0) - previousLikes);
        if (prev !== 0 && s.score !== prev) {
          const diff = s.score - prev;
          setScoreDelta(diff);
          if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
          deltaTimerRef.current = setTimeout(() => { deltaTimerRef.current = null; setScoreDelta(0); }, 2400);
          if (!likeDelta) triggerIslandMoment(diff > 0 ? '↗' : '↘', `Score ${diff > 0 ? 'increased' : 'changed'} by ${Math.abs(diff)}`, diff > 0 ? 'positive' : 'negative');
        }
        if (likeDelta > 0) triggerIslandMoment('♥', `${likeDelta} new positive signal${likeDelta === 1 ? '' : 's'}`, 'positive');
        prevScoreRef.current = s.score;
        prevLikesRef.current = p.likesCount || 0;
        setLiveScore(s.score);
        setLiveSummary(s);
      }
    });
  }, [triggerIslandMoment, user?.uid]);

  useEffect(() => () => {
    if (islandTimerRef.current) clearTimeout(islandTimerRef.current);
    if (deltaTimerRef.current) clearTimeout(deltaTimerRef.current);
  }, []);

  // Listen for micro-events from other components
  useEffect(() => {
    const onMicroEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ emoji: string }>).detail;
      if (detail?.emoji) triggerIslandMoment(detail.emoji, 'New activity on Canact');
    };
    window.addEventListener('canact:pill-emoji', onMicroEvent);
    return () => window.removeEventListener('canact:pill-emoji', onMicroEvent);
  }, [triggerIslandMoment]);

  // Close island on outside click
  useEffect(() => {
    if (!islandOpen) return;
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return;
      if (!islandRef.current?.contains(e.target) && !islandPortalRef.current?.contains(e.target)) setIslandOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setIslandOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [islandOpen]);

  // Sidebar enter/exit animation lifecycle
  useEffect(() => {
    if (avatarPopup) {
      setSidebarMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSidebarEntered(true));
      });
      return () => cancelAnimationFrame(raf);
    }
    setSidebarEntered(false);
    const t = setTimeout(() => setSidebarMounted(false), 300);
    return () => clearTimeout(t);
  }, [avatarPopup]);

  const headerChromeClass = profileChrome ? 'canact-profile-header-chrome' : fadeChrome ? 'canact-fade-header-chrome' : '';

  const attrs = [...POSITIVE_ATTRS, ...NEGATIVE_ATTRS].map((key) => ({
    key,
    label: ATTR_LABELS[key],
    count: profile?.attrs?.[key] || 0,
    positive: POSITIVE_ATTRS.includes(key as (typeof POSITIVE_ATTRS)[number]),
  }));
  const islandExpanded = islandOpen || !!islandMoment;
  const scoreSummary = liveSummary ?? calculateCanactScore(profile);
  const scorePercent = Math.max(4, Math.min(100, (liveScore / Math.max(scoreSummary.max, 1)) * 100));

  useEffect(() => setIslandPortalMounted(true), []);

  useLayoutEffect(() => {
    if (!islandPortalMounted) return;

    let frame = 0;
    const updateAnchor = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const trigger = islandRef.current;
        if (!trigger) return;
        const rect = trigger.getBoundingClientRect();
        const header = trigger.closest('.canact-figma-header')?.getBoundingClientRect();
        const expandedWidth = Math.min(window.innerWidth - 16, Math.max(280, (header?.width ?? window.innerWidth - 24) * .98));
        const halfWidth = expandedWidth / 2;
        const left = Math.min(window.innerWidth - 8 - halfWidth, Math.max(8 + halfWidth, rect.left + rect.width / 2));
        const top = Math.min(window.innerHeight - 44, Math.max(8, rect.top));
        setIslandAnchor((current) => current?.top === top && current.left === left && current.expandedWidth === expandedWidth
          ? current
          : { top, left, expandedWidth });
      });
    };

    updateAnchor();
    window.addEventListener('resize', updateAnchor);
    window.addEventListener('scroll', updateAnchor, true);
    window.visualViewport?.addEventListener('resize', updateAnchor);
    window.visualViewport?.addEventListener('scroll', updateAnchor);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateAnchor);
      window.removeEventListener('scroll', updateAnchor, true);
      window.visualViewport?.removeEventListener('resize', updateAnchor);
      window.visualViewport?.removeEventListener('scroll', updateAnchor);
    };
  }, [islandPortalMounted]);

  return (
    <>
      <header
      data-canact-header
      className={`canact-header-shell fixed z-30 lg:hidden ${headerChromeClass}`}
      style={{ top: topInset ? `calc(${topInset} + var(--canact-header-offset, 0px))` : 'var(--canact-header-offset, 0px)' }}
    >
      <div
        data-liquid-glass="surface"
        data-liquid-radius="999"
        data-liquid-blur="18"
        data-liquid-tint="250,248,242"
        data-liquid-tint-opacity="0.48"
        className="canact-figma-header"
      >
        <div className={`canact-header-inner flex items-center gap-2 px-4 relative ${profileChrome ? 'canact-profile-header-content' : ''}`}>
          <Brand size={38} href="/" />

          {/* Dynamic Island score pill */}
          <div
            ref={islandRef}
            className="canact-score-island-shell"
          >
            <button
              type="button"
              onClick={() => { haptic('subtle'); setIslandOpen((v) => !v); }}
              data-canact-score-target
              aria-label={`Canact score ${liveScore}`}
              aria-expanded={islandExpanded}
              className="canact-score-island"
              data-expanded="false"
              data-tone={islandMoment?.tone ?? 'neutral'}
            >
              <span className="canact-score-island-compact">
                <i />
                <strong>{liveScore}</strong>
                <small>{scoreDelta ? `${scoreDelta > 0 ? '+' : '−'}${Math.abs(scoreDelta)}` : 'GOOD'}</small>
              </span>
            </button>
          </div>

          <div className="ml-auto inline-flex items-center gap-3">
            {/* Avatar — opens sidebar with range selector + profile link */}
            <div className="relative">
              <button
                type="button"
                aria-label="Open profile menu"
                onClick={() => { haptic('subtle'); setAvatarPopup((v) => !v); }}
                className={`inline-flex h-22 w-22 shrink-0 items-center justify-center rounded-full overflow-hidden transition ${profileChrome ? 'canact-profile-header-icon' : 'text-ink hover:text-brand'}`}
              >
                <Avatar src={profile?.photoURL ?? null} name={profile?.fullName ?? 'You'} size={50} />
              </button>
              {sidebarMounted && createPortal(
                <>
                  {/* Backdrop — fades in/out */}
                  <div
                    className={`fixed inset-0 z-[2147482600] bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${sidebarEntered ? 'opacity-100' : 'opacity-0'}`}
                    onClick={() => { setAvatarPopup(false); haptic('subtle'); }}
                    aria-hidden="true"
                  />
                  {/* Sidebar panel — slides in from right, 80% width */}
                  <aside
                    className={`fixed inset-y-0 right-0 z-[2147482601] flex w-[80%] max-w-[400px] flex-col bg-[#faf8f2] shadow-2xl rounded-l-[32px] transition-transform duration-300 ease-out ${sidebarEntered ? 'translate-x-0' : 'translate-x-full'}`}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Profile menu"
                  >
                    {/* Close button */}
                    <div className="flex items-center justify-end px-4 pt-4">
                      <button
                        type="button"
                        onClick={() => { setAvatarPopup(false); haptic('subtle'); }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-ink/60 hover:bg-ink/10"
                        aria-label="Close menu"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    {/* User info */}
                    <div className="flex items-center gap-3 px-5 pt-2 pb-4 border-b border-ink/6">
                      <Avatar src={profile?.photoURL ?? null} name={profile?.fullName ?? 'You'} size={48} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-base font-extrabold text-ink">{profile?.firstName || profile?.fullName || 'You'}</div>
                        {profile && (
                          <div className="mt-0.5 inline-flex items-center gap-1.5 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-bold text-brand">
                            {liveScore} {scoreSummary.label}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Discovery range */}
                    <div className="flex-1 overflow-y-auto px-5 py-4">
                      <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-ink/40 mb-3">Discovery range</p>
                      <div className="grid grid-cols-2 gap-2">
                        {RADIUS_OPTIONS.map((option) => (
                          <button
                            key={option.index}
                            type="button"
                            onClick={() => { setRadiusIdx(option.index); haptic('selection'); }}
                            className={`rounded-xl py-3 text-sm font-extrabold transition-colors ${option.index === radiusIdx ? 'bg-brand text-white' : 'bg-ink/5 text-ink/60 hover:bg-ink/10'}`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* View Profile button */}
                    <div className="border-t border-ink/6 px-5 py-4">
                      <Link
                        href="/profile"
                        prefetch
                        onClick={() => { setAvatarPopup(false); haptic('subtle'); }}
                        className="flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-white transition active:scale-[0.98]"
                      >
                        <UserIcon size={18} />
                        <span>View Profile</span>
                      </Link>
                    </div>
                  </aside>
                </>,
                document.body,
              )}
            </div>
          </div>
        </div>
      </div>
      </header>
      {islandPortalMounted && islandAnchor && createPortal(
        <div
          ref={islandPortalRef}
          className="canact-score-island-portal"
          data-expanded={islandExpanded}
          style={{
            top: islandAnchor.top,
            left: islandAnchor.left,
            opacity: 1,
            '--canact-island-expanded-width': `${islandAnchor.expandedWidth}px`,
          } as React.CSSProperties}
          role={islandExpanded ? 'dialog' : undefined}
          aria-label={islandExpanded ? 'Canact score details' : undefined}
        >
          <button
            type="button"
            className="canact-score-island"
            data-expanded={islandExpanded}
            data-tone={islandMoment?.tone ?? 'neutral'}
            data-canact-score-target
            aria-label={islandExpanded ? 'Close Canact score details' : `Canact score ${liveScore}`}
            aria-expanded={islandExpanded}
            onClick={() => {
              haptic('subtle');
              if (islandExpanded) {
                setIslandOpen(false);
                setIslandMoment(null);
                if (islandTimerRef.current) clearTimeout(islandTimerRef.current);
              } else {
                setIslandOpen(true);
              }
            }}
          >
            <span className="canact-score-island-compact">
              <i />
              <strong>{liveScore}</strong>
              <small>{scoreDelta ? `${scoreDelta > 0 ? '+' : '−'}${Math.abs(scoreDelta)}` : 'GOOD'}</small>
            </span>
            <span className="canact-score-island-panel">
              <span className="canact-score-island-event">
                <i>{islandMoment?.icon ?? <Activity size={16} />}</i>
                <span><small>{islandMoment ? 'Live update' : 'Canact score'}</small><strong>{islandMoment?.label ?? `${scoreSummary.club} club`}</strong></span>
              </span>
              <span className="canact-score-island-value"><b>{liveScore}</b>{scoreDelta !== 0 ? <em data-positive={scoreDelta > 0}>{scoreDelta > 0 ? '+' : '−'}{Math.abs(scoreDelta)}</em> : null}</span>
              <span className="canact-score-island-meter"><i style={{ width: `${scorePercent}%` }} /></span>
              <span className="canact-score-island-meta"><small>{scoreSummary.club} club</small><small>{attrs.reduce((sum, attr) => sum + attr.count, 0)} attribute signals</small></span>
              <span className="canact-score-island-attributes">
                {attrs.map((attr) => (
                  <span key={attr.key} data-positive={attr.positive}>
                    <small>{attr.label}</small>
                    <b>{attr.count}</b>
                  </span>
                ))}
              </span>
            </span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

const LEADERBOARD_SCOPES = [
  { id: 'app', label: 'Global Rank' },
  { id: 'city', label: 'City Rank' },
  { id: 'country', label: 'Country Rank' },
  { id: 'favourites', label: 'Favourites' },
] as const;

function LeaderboardScopeDropdown({ blendChrome }: { blendChrome: boolean }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<(typeof LEADERBOARD_SCOPES)[number]>(LEADERBOARD_SCOPES[0]);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        data-liquid-glass="switcher"
        data-liquid-radius="999"
        data-liquid-tint="31,107,85"
        data-liquid-tint-opacity="0.05"
        aria-label="Leaderboard scope"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`canact-distance-pill inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full px-3 text-[13px] font-semibold leading-none ${blendChrome ? 'canact-profile-header-select' : 'text-ink'}`}
        onClick={() => { haptic('subtle'); setOpen((value) => !value); }}
      >
        <span>{selected.label}</span>
      </button>
      {open && (
        <div role="listbox" aria-label="Leaderboard scope" data-liquid-glass="surface" data-liquid-radius="16" data-liquid-blur="0" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.1" data-liquid-thickness="36" data-liquid-bezel="14" className="canact-glass-dropdown absolute left-1/2 top-[calc(100%+8px)] z-50 w-36 -translate-x-1/2 overflow-hidden rounded-2xl p-1 text-ink">
          {LEADERBOARD_SCOPES.map((option) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={selected.id === option.id}
              className={`flex h-9 w-full items-center justify-center rounded-xl px-3 text-xs font-extrabold ${selected.id === option.id ? 'text-brand' : 'text-ink/75'}`}
              onClick={() => {
                setSelected(option);
                setOpen(false);
                window.dispatchEvent(new CustomEvent('canact:leaderboard-scope', { detail: option.id }));
                haptic('selection');
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DistanceDropdown({ radiusIdx, setRadiusIdx, blendChrome }: { radiusIdx: number; setRadiusIdx: (value: number) => void; blendChrome: boolean }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = RADIUS_OPTIONS.find((option) => option.index === radiusIdx) ?? RADIUS_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const pillClassName = `canact-distance-pill inline-flex h-9 w-auto min-w-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-center text-[13px] font-normal leading-none transition [&:focus-visible]:outline-none [&:focus-visible]:ring-2 [&:focus-visible]:ring-brand/25 ${blendChrome ? 'canact-profile-header-select' : 'border border-[#D9DDE5] bg-white text-ink'}`;
  const menuClassName = `canact-glass-dropdown absolute left-1/2 top-[calc(100%+8px)] z-50 w-36 -translate-x-1/2 overflow-hidden rounded-2xl bg-transparent p-1 text-ink`;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        data-liquid-glass="switcher"
        data-liquid-radius="999"
        data-liquid-tint="31,107,85"
        data-liquid-tint-opacity="0.05"
        aria-label="Feed distance filter"
        aria-haspopup="listbox"
        aria-expanded={open}
        className={pillClassName}
        onClick={() => {
          haptic('subtle');
          setOpen((wasOpen) => !wasOpen);
        }}
      >
        <span className="block text-center">{selectedOption.label}</span>
      </button>
      {open && (
        <div role="listbox" aria-label="Feed distance filter" data-liquid-glass="surface" data-liquid-radius="16" data-liquid-blur="0" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.1" data-liquid-thickness="36" data-liquid-bezel="14" className={menuClassName}>
          {RADIUS_OPTIONS.map((option) => {
            const selected = option.index === radiusIdx;
            return (
              <button
                key={option.index}
                type="button"
                role="option"
                aria-selected={selected}
                data-liquid-glass={selected ? 'switcher' : 'none'}
                data-liquid-radius="12"
                className={`flex h-9 w-full items-center justify-center rounded-xl bg-transparent px-3 text-center text-xs font-extrabold transition ${selected ? 'text-brand' : 'text-ink/75 hover:text-brand'}`}
                onClick={() => {
                  setRadiusIdx(option.index);
                  setOpen(false);
                  haptic('selection');
                }}
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
