'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { DistanceProvider, RADIUS_OPTIONS, useDistance } from '@/lib/distance';
import { Brand } from './Brand';
import { PageTransition } from './PageTransition';
import { PullToRefresh } from './PullToRefresh';
import { PlusSheet } from './PlusSheet';
import { RadialCreateMenu } from './RadialCreateMenu';
import { LiquidGlassRuntime } from './LiquidGlassRuntime';
import { PostDetailSheet, type PostDetailSheetItem } from './PostDetailSheet';
import { ShareToChatSheet } from './ShareToChatSheet';
import { VicinityTracker } from './VicinityTracker';
import { Splash } from './Splash';
import { IncomingCallRinger } from './IncomingCallRinger';
import { ScrollRestoration } from './ScrollRestoration';
import NativePermissionsBootstrapper from './NativePermissionsBootstrapper';
import NativeCallDeepLinkRouter from './NativeCallDeepLinkRouter';
import { HelpAlertManager } from './HelpAlertManager';
import { haptic } from '@/lib/haptics';
import { useInboxBadges } from '@/lib/useInboxBadges';
import type { ChatAttachment } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import {
  Home, Compass, HeartHandshake, Plus, Trophy, UserIcon, Search, Bell, MessageSquare,
  Heart, Eye, Settings as SettingsIcon, Sparkles, MapPin, Grid3X3, Activity,
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
  const prefetchedRoutesRef = useRef(new Set<string>());
  const liquidNav = useLiquidNavSlider(pathname, user?.uid, router);
  // Live counters for the chat icon (header) and Inbox sidebar entry.
  const { total: inboxTotal } = useInboxBadges();
  const routeProfileHero = false;
  const routeFadeChrome = !!pathname && pathname === '/favourites';
  const routeFeed = pathname === '/feed';
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
    root.style.setProperty('--canact-map-header-fade-start', mobileHeaderTopInset ? `calc(${mobileHeaderTopInset} + 55px)` : '55px');
    return () => {
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
        <LiquidGlassRuntime />
        <ScrollRestoration />
        {/* Pull-to-refresh is intentionally NOT mounted on chat threads:
            those use their own scroll container and a downward swipe at the
            top of a conversation should never reload the page mid-message. */}
        <PageTransition>{children}</PageTransition>
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
      <LiquidGlassRuntime />
      <ScrollRestoration />
      {/* Global swipe-down-to-refresh — mounted once for the whole app so
          every page (feed, profile, leaderboard, etc.) gets the gesture
          without having to wrap its own root. Pages that maintain client
          subscriptions can listen for the `canact:pull-refresh` event. */}
      <PullToRefresh />
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
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:left-0 lg:top-0 lg:bottom-0 lg:w-60 lg:gap-1 lg:py-6 lg:px-4 lg:overflow-y-auto lg:bg-white/60 lg:backdrop-blur lg:border-r lg:border-line lg:z-20">
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
          onClick={() => { haptic('strong'); setPlusOpen(true); }}
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white font-semibold py-2.5 hover:bg-brand-dark"
        >
          <Sparkles size={18} /> Create
        </button>
      </aside>

      <main className="flex-1 min-w-0 lg:px-6 lg:pt-6">
        <UnifiedHeader profileChrome={profileChrome} fadeChrome={false} topInset={mobileHeaderTopInset} />
        <div
          className={`canact-col ${routeFeed ? 'pb-0' : 'pb-6'} lg:!max-w-none lg:w-full lg:mx-0 lg:px-6 lg:pb-6`}
          style={!headerOverContent ? { paddingTop: mobileHeaderTopInset ? `calc(${mobileHeaderTopInset} + 92px)` : '92px' } : undefined}
        ><PageTransition>{children}</PageTransition></div>
        <VicinityTracker />
        <IncomingCallRinger />
        <HelpAlertManager />
        <NativePermissionsBootstrapper />
        <NativeCallDeepLinkRouter />
      </main>
      </div>{/* /canact-app-content */}

        {/* Mobile bottom nav */}
      <nav
        ref={liquidNav.navRef}
        data-canact-bottom-nav
        data-liquid-glass="surface"
        data-liquid-radius="999"
        data-liquid-blur="0"
        data-liquid-tint="250,248,242"
        data-liquid-tint-opacity="0"
        className="canact-figma-bottom-nav lg:hidden fixed z-40"
      >
        <div className="canact-bottom-dock-items relative z-10 flex h-full items-center justify-between">
          <div ref={liquidNav.glowRef} className="canact-bottom-nav-glow" aria-hidden="true" />
          <div ref={liquidNav.indicatorRef} data-liquid-glass="switcher" data-liquid-radius="999" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0" className="canact-bottom-tab-indicator" aria-hidden="true" />
          {TABS.map(({ href, label, Icon, isFab }, tabIndex) => {
            const active = isNavLinkActive(pathname, href, user.uid);
            const onTap = () => {
              if (isFab) { haptic('strong'); setPlusOpen(true); return; }
              if (!active) haptic('selection');
            };
            const cls = `canact-bottom-tab group relative flex h-16 w-16 items-center justify-center rounded-[22px] transition-colors duration-300 ${
              active
                ? 'canact-bottom-tab-active bg-[#e7e1d1] text-[#1a4f3f]'
                : 'canact-bottom-tab-inactive text-[#707981] hover:text-ink'
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
      </nav>
      <RadialCreateMenu open={radialCreateOpen} onClose={() => setRadialCreateOpen(false)} />
      <button
        type="button"
        aria-label={radialCreateOpen ? 'Close create menu' : 'Open create menu'}
        aria-expanded={radialCreateOpen}
        aria-controls="canact-radial-create-menu"
        data-liquid-glass="surface"
        data-liquid-radius="999"
        data-liquid-tint="31,107,85"
        data-liquid-tint-opacity="0.10"
        onClick={() => { haptic('strong'); setRadialCreateOpen((value) => !value); }}
        className={`canact-create-nav-button fixed z-50 lg:hidden ${radialCreateOpen ? 'canact-create-nav-button-open' : ''}`}
      >
        <Plus className="canact-adaptive-icon" size={29} strokeWidth={2.3} />
      </button>
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
      {postPopups}
    </div>
  );
}

function useLiquidNavSlider(pathname: string | null, userId: string | undefined, router: ReturnType<typeof useRouter>) {
  const navRef = useRef<HTMLElement | null>(null);
  const indicatorRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);
  const suppressClickUntil = useRef(0);
  const finishTimer = useRef(0);

  const activeIndex = useCallback(() => Math.max(0, TABS.findIndex((tab) => isNavLinkActive(pathname, tab.href, userId))), [pathname, userId]);
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
      TABS.forEach((_, index) => {
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
      const target = TABS[targetIndex];
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

function UnifiedHeader({ profileChrome = false, fadeChrome = false, topInset }: { profileChrome?: boolean; fadeChrome?: boolean; topInset?: string | null }) {
  const { radiusIdx, setRadiusIdx } = useDistance();
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    if (!user) { setPendingCount(0); return; }
    let friends = 0, favs = 0;
    const update = () => setPendingCount(friends + favs);
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    (async () => {
      const friendsMod = await import('@/lib/services/friends');
      const favMod = await import('@/lib/services/favourites');
      off1 = friendsMod.listenIncomingRequests(user.uid, (items) => { friends = items.length; update(); });
      off2 = favMod.listenFollowRequests(user.uid, (items) => { favs = items.length; update(); });
    })();
    return () => { off1?.(); off2?.(); };
  }, [user?.uid]);

  const headerChromeClass = profileChrome ? 'canact-profile-header-chrome' : fadeChrome ? 'canact-fade-header-chrome' : '';

  return (
    <header
      data-canact-header
      data-liquid-glass="surface"
      data-liquid-radius="999"
      data-liquid-blur="0"
      data-liquid-tint="250,248,242"
      data-liquid-tint-opacity="0"
      className={`canact-figma-header fixed z-30 lg:hidden ${headerChromeClass}`}
      style={{ top: topInset ? `calc(${topInset} + 1em)` : '1em' }}
    >
      <div className={`canact-header-inner flex items-center gap-2 px-4 ${profileChrome ? 'canact-profile-header-content' : ''}`}>
        <Brand size={38} href="/" />
        <div className="ml-auto inline-flex items-center gap-4">
          <DistanceDropdown radiusIdx={radiusIdx} setRadiusIdx={setRadiusIdx} blendChrome={profileChrome} />
          <Link href="/favourites" data-liquid-glass="none" aria-label="Friends and favourites" prefetch onClick={() => haptic('subtle')} className={`relative inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full transition ${profileChrome ? 'canact-profile-header-icon' : 'text-ink hover:text-brand'}`}>
            <Heart className="canact-adaptive-icon" size={25} strokeWidth={2.2} />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </Link>
          <Link href="/profile" data-liquid-glass="none" aria-label="Open profile" prefetch onClick={() => haptic('subtle')} className={`inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full transition ${profileChrome ? 'canact-profile-header-icon' : 'text-ink hover:text-brand'}`}>
            <SettingsIcon className="canact-adaptive-icon" size={25} strokeWidth={2.2} />
          </Link>
        </div>
      </div>
    </header>
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
  const menuClassName = `absolute right-0 top-[calc(100%+8px)] z-50 w-36 overflow-hidden rounded-2xl border border-white/60 bg-transparent p-1 text-ink shadow-xl`;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        data-liquid-glass="none"
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
        <div role="listbox" aria-label="Feed distance filter" data-liquid-glass="surface" data-liquid-radius="16" data-liquid-tint="250,248,242" data-liquid-tint-opacity="0.12" className={menuClassName}>
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
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
