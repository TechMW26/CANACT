'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { onValue, ref as dbRef } from 'firebase/database';
import { db } from '@/lib/firebase';
import { useAuth } from '@/lib/auth';
import { calculateCanactScore } from '@/lib/canactScore';
import { DEFAULT_RADIUS_INDEX, DistanceProvider, RADIUS_OPTIONS, useDistance } from '@/lib/distance';
import { useGeo } from '@/lib/useGeo';
import { haversineMeters } from '@/lib/utils';
import { listenHelpFeed } from '@/lib/services/help';
import { Brand } from './Brand';
import { Avatar } from './Avatar';
import { PageTransition } from './PageTransition';
import { PlusSheet } from './PlusSheet';
import { RadialCreateMenu } from './RadialCreateMenu';
import { PostDetailSheet, type PostDetailSheetItem } from './PostDetailSheet';
import { ShareToChatSheet } from './ShareToChatSheet';
import { Sheet } from './Sheet';
import { VicinityTracker } from './VicinityTracker';
import { Splash } from './Splash';
import { IncomingCallRinger } from './IncomingCallRinger';
import { ScrollRestoration } from './ScrollRestoration';
import NativePermissionsBootstrapper from './NativePermissionsBootstrapper';
import ContactPermissionBootstrapper from './ContactPermissionBootstrapper';
import NativeCallDeepLinkRouter from './NativeCallDeepLinkRouter';
import { HelpAlertManager } from './HelpAlertManager';
import { IncomingCardEnvelope } from './IncomingCardEnvelope';
import { OnboardingTaskGuide } from './OnboardingTaskGuide';
import { MandatoryPhoneSheet } from './MandatoryPhoneSheet';
import { StickyHelpPullTab } from './StickyHelpPullTab';
import { haptic } from '@/lib/haptics';
import { useInboxBadges } from '@/lib/useInboxBadges';
import { listenIncomingRequests } from '@/lib/services/friends';
import { listenFollowRequests } from '@/lib/services/favourites';
import { recoverOrphanedPageScroll } from '@/lib/scrollLock';
import { ATTR_LABELS, NEGATIVE_ATTRS, POSITIVE_ATTRS, type ChatAttachment, type UserProfile } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';
import {
  Home, Compass, HeartHandshake, Plus, Trophy, UserIcon, Search, Bell, MessageSquare,
  Heart, Eye, Settings as SettingsIcon, Sparkles, MapPin, Grid3X3, Activity, Camera, Pencil, AlignLeft, X,
} from './icons';

type Tab = { href: string; label: string; Icon: LucideIcon; isFab?: boolean; badge?: number };

const TABS: Tab[] = [
  { href: '/',            label: 'Home',      Icon: Home },
  { href: '/help',        label: 'Help',      Icon: HeartHandshake },
  { href: '/feed',        label: 'Community', Icon: Grid3X3 },
  { href: '/inbox',       label: 'Messages',  Icon: MessageSquare },
];

const SIDE_LINKS = [
  { href: '/',             label: 'Home',          Icon: Home },
  { href: '/feed',         label: 'Feed',          Icon: Compass },
  { href: '/inbox',        label: 'Inbox',         Icon: MessageSquare },
  { href: '/help',         label: 'Help',          Icon: HeartHandshake },
  { href: '/mood',         label: 'Mood Board',    Icon: Activity },
  { href: '/leaderboard',  label: 'Leaderboard',   Icon: Trophy },
  { href: '/notifications',label: 'Notifications', Icon: Bell },
  { href: '/favourites',   label: 'Favourites',    Icon: Heart },
  { href: '/search',       label: 'Search',        Icon: Search },
  { href: '/underground',  label: 'Underground',   Icon: Eye },
  { href: '/profile',      label: 'My Profile',    Icon: UserIcon },
  { href: '/settings',     label: 'Settings',      Icon: SettingsIcon },
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
  const [mobileFooterBottomInset, setMobileFooterBottomInset] = useState<string | null>(null);
  const mobileHeaderInset = mobileHeaderTopInset ?? '0px';
  const [pageBlendChrome, setPageBlendChrome] = useState(false);
  const prefetchedRoutesRef = useRef(new Set<string>());
  // Live counters for the chat icon (header) and Inbox sidebar entry.
  const { total: inboxTotal } = useInboxBadges();
  const routeProfileHero = false;
  const routeFadeChrome = !!pathname && pathname === '/favourites';
  const routeLeaderboard = pathname === '/leaderboard';
  const isProfileRoute = !!pathname?.startsWith('/profile');
  const headerOverContent = pathname === '/' || pathname === '/favourites' || isProfileRoute;
  const profileChrome = routeProfileHero;
  const footerFadeChrome = !profileChrome && (routeFadeChrome || pageBlendChrome);
  const chromeOverContent = profileChrome || footerFadeChrome;
  const routeOwnsViewport = pathname === '/'
    || pathname === '/favourites'
    || (!!pathname && /^\/inbox\/[^/]+/.test(pathname));

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

  const visibleTabs = useMemo(() => {
    return TABS.map((t) => ({
      ...t,
      badge: t.href === '/inbox' ? inboxTotal : undefined,
    }));
  }, [inboxTotal]);

  // Live nearby help count for the Help tab badge and sheet bubble
  const { coords } = useGeo();
  const { radius } = useDistance();
  const [nearbyHelpCount, setNearbyHelpCount] = useState(0);
  useEffect(() => {
    if (!user) return;
    return listenHelpFeed((items) => {
      const nearby = items.filter((h) => {
        if (h.uid === user.uid) return false;
        if (h.status !== 'open') return false;
        if (h.lat == null || h.lng == null || !coords) return true;
        return haversineMeters(coords, { lat: h.lat, lng: h.lng }) <= (h.vicinityMeters ?? radius);
      });
      setNearbyHelpCount(nearby.length);
    });
  }, [user, coords, radius]);

  const anyTabActive = useMemo(() => visibleTabs.some((t) => isNavLinkActive(pathname, t.href, user?.uid)), [pathname, visibleTabs, user?.uid]);

  const createButtonLeft = 'calc(100% - 72px)';
  const createButtonBottom = 'calc(var(--canact-mobile-bottom-inset, 0px) + 8px)';

  const [helpOpen, setHelpOpen] = useState(false);
  const handleNavAction = useCallback((tab: Tab) => {
    if (tab.href !== '/help') return false;
    haptic('selection');
    setHelpOpen(true);
    return true;
  }, []);
  const liquidNav = useLiquidNavSlider(pathname, user?.uid, router, visibleTabs, handleNavAction);

  useEffect(() => { setPageBlendChrome(false); setRadialCreateOpen(false); }, [pathname]);

  useEffect(() => {
    const recover = () => {
      if (!routeOwnsViewport) {
        const root = document.documentElement;
        root.removeAttribute('data-canact-fullscreen-page');
        root.removeAttribute('data-canact-home-nearby');
        root.removeAttribute('data-canact-home-score');
        root.removeAttribute('data-canact-map-fade');
      }
      recoverOrphanedPageScroll();
    };
    let settledRouteFrame = 0;
    const recoverAfterRoute = requestAnimationFrame(() => {
      recover();
      settledRouteFrame = requestAnimationFrame(recover);
    });
    const recoverAfterTransition = window.setTimeout(recover, 400);
    window.addEventListener('pageshow', recover);
    window.addEventListener('focus', recover);
    window.addEventListener('pointerdown', recover, true);
    window.addEventListener('touchstart', recover, { capture: true, passive: true });
    window.addEventListener('wheel', recover, { capture: true, passive: true });
    window.addEventListener('popstate', recover);
    document.addEventListener('visibilitychange', recover);
    return () => {
      cancelAnimationFrame(recoverAfterRoute);
      cancelAnimationFrame(settledRouteFrame);
      window.clearTimeout(recoverAfterTransition);
      window.removeEventListener('pageshow', recover);
      window.removeEventListener('focus', recover);
      window.removeEventListener('pointerdown', recover, true);
      window.removeEventListener('touchstart', recover, true);
      window.removeEventListener('wheel', recover, true);
      window.removeEventListener('popstate', recover);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [pathname, routeOwnsViewport]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--canact-create-button-left', createButtonLeft);
    root.style.setProperty('--canact-create-button-bottom', createButtonBottom);
    return () => {
      root.style.removeProperty('--canact-create-button-left');
      root.style.removeProperty('--canact-create-button-bottom');
    };
  }, [createButtonLeft, createButtonBottom]);

  const prefetchRoute = useCallback((href: string) => {
    if (href === '/create' || prefetchedRoutesRef.current.has(href)) return;
    prefetchedRoutesRef.current.add(href);
    try { router.prefetch(href); } catch { /* prefetch is best-effort */ }
  }, [router]);

  useEffect(() => {
    setMobileHeaderTopInset(getMobileHeaderTopInset());
    setMobileFooterBottomInset(getMobileFooterBottomInset());
  }, []);

  useEffect(() => {
    if (!mobileFooterBottomInset) return;
    const root = document.documentElement;
    root.style.setProperty('--canact-mobile-bottom-inset', mobileFooterBottomInset);
    return () => {
      root.style.removeProperty('--canact-mobile-bottom-inset');
    };
  }, [mobileFooterBottomInset]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--canact-header-top-inset', mobileHeaderInset);
    root.style.setProperty('--canact-map-header-fade-start', `calc(${mobileHeaderInset} + 55px)`);
    return () => {
      root.style.removeProperty('--canact-header-top-inset');
      root.style.removeProperty('--canact-map-header-fade-start');
    };
  }, [mobileHeaderInset]);

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
        <ContactPermissionBootstrapper />
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
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:left-0 lg:top-0 lg:bottom-0 lg:w-60 lg:gap-1 lg:py-6 lg:px-4 lg:overflow-y-auto lg:bg-white lg:border-r lg:border-line lg:z-[2147482600]">
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
        <UnifiedHeader home={pathname === '/'} profileChrome={profileChrome} fadeChrome={false} leaderboard={routeLeaderboard} topInset={mobileHeaderInset} />
        <div
          className={`w-full ${pathname === '/' ? 'pb-0' : 'pb-[var(--canact-bottom-nav-height)]'} lg:px-6 lg:pb-6`}
          style={!headerOverContent ? { paddingTop: `calc(${mobileHeaderInset} + 92px)` } : undefined}
        ><PageTransition>{children}</PageTransition></div>
        <VicinityTracker />
        <IncomingCallRinger />
        <HelpAlertManager />
        <NativePermissionsBootstrapper />
        <ContactPermissionBootstrapper />
        <NativeCallDeepLinkRouter />
      </main>
      </div>{/* /canact-app-content */}

      {/* Mobile bottom nav group — centered, button on right */}
      <div className="canact-bottom-group fixed bottom-0 z-40 flex items-end gap-[1.5em] lg:hidden"
        style={{ left: 0, right: 0, paddingBottom: 'var(--canact-mobile-bottom-inset, 0px)' }}>
        <nav
          data-canact-bottom-nav
          className="canact-bottom-nav-shell canact-solid-footer"
          style={{ width: '100%' }}
        >
          <div
            ref={liquidNav.navRef}
            data-liquid-glass="none"
            data-liquid-radius="0"
            data-liquid-blur="0"
            data-liquid-tint="255,255,255"
            data-liquid-tint-opacity="1"
            className="canact-figma-bottom-nav"
          >
            <div className="canact-bottom-dock-items relative z-10 flex h-full items-center justify-center"
              style={{
                width: '100%',
                gridTemplateColumns: `repeat(${visibleTabs.length + 1}, 60px)`,
                justifyContent: 'space-between',
                gap: 0,
              }}>
              <div ref={liquidNav.glowRef} className="canact-bottom-nav-glow" aria-hidden="true" />
              <div ref={liquidNav.indicatorRef} data-liquid-glass="none" data-liquid-radius="999" data-liquid-tint="255,255,255" data-liquid-tint-opacity="1" className="canact-bottom-tab-indicator" aria-hidden="true" style={{ opacity: anyTabActive ? 1 : 0, transform: anyTabActive ? undefined : 'scale(0)' }} />
              {visibleTabs.map(({ href, label, Icon, isFab, badge }, tabIndex) => {
                const active = isNavLinkActive(pathname, href, user.uid);
                const tabBadge = href === '/inbox' ? inboxTotal : href === '/help' ? nearbyHelpCount : badge;
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
                if (href === '/help') {
                  return (
                    <button
                      key={href}
                      type="button"
                      aria-label={tabBadge ? `${label} — ${tabBadge} nearby request${tabBadge === 1 ? '' : 's'}` : label}
                      onPointerDown={(event) => {
                        prefetchRoute(href);
                        liquidNav.begin(tabIndex, event);
                      }}
                      onClick={(event) => {
                        if (!liquidNav.consumeClick(event)) {
                          onTap();
                          setHelpOpen(true);
                        }
                      }}
                      onFocus={() => prefetchRoute(href)}
                      className={cls}
                    >
                      <Icon className="canact-adaptive-icon canact-bottom-help-icon" size={25} strokeWidth={active ? 2.3 : 1.8} style={{ color: '#dc2626' }} />
                      {tabBadge && tabBadge > 0 ? (
                        <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#dc2626] px-1 text-[9px] font-extrabold text-white shadow-[0_2px_6px_rgba(220,38,38,.4)]">
                          {tabBadge > 99 ? '99+' : tabBadge}
                        </span>
                      ) : null}
                    </button>
                  );
                }
                return (
                  <Link key={href} href={href} aria-label={label} prefetch onPointerEnter={() => prefetchRoute(href)} onPointerDown={(event) => { prefetchRoute(href); liquidNav.begin(tabIndex, event); }} onFocus={() => prefetchRoute(href)} onClick={(event) => { if (!liquidNav.consumeClick(event)) onTap(); }} className={cls}>
                    <Icon className="canact-adaptive-icon" size={25} strokeWidth={active ? 2.3 : 1.8} />
                    {tabBadge && tabBadge > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e85d2c] border-2 border-white px-1 text-[9px] font-extrabold text-white shadow-[0_2px_6px_rgba(232,93,44,.4)]">
                        {tabBadge > 99 ? '99+' : tabBadge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </div>{/* /canact-bottom-group */}
      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title="Help">
        <div className="px-1 pb-4">
          <div className="flex items-center gap-3 rounded-2xl bg-[#fdf3ed] px-4 py-3">
            <strong className="text-[28px] font-extrabold leading-none text-[#b04820]">{nearbyHelpCount > 99 ? '99+' : nearbyHelpCount}</strong>
            <span className="text-[13px] font-bold leading-snug text-[#b04820]">{nearbyHelpCount === 1 ? 'person needs' : 'people need'} help near you</span>
          </div>
          <p className="mt-3 line-clamp-2 text-sm leading-5 text-ink/65">
            See who nearby needs support, or send a request when you need help from the community.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Link href="/help" onClick={() => setHelpOpen(false)} className="relative inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#fdf3ed] px-4 text-[14px] font-bold text-[#b85a2c] transition-colors hover:bg-[#fce8db]">
              <Eye size={15} strokeWidth={2.2} />
              View
              {nearbyHelpCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e85d2c] border-2 border-[#fdf3ed] px-1 text-[9px] font-extrabold text-white shadow-[0_2px_6px_rgba(232,93,44,.4)]">
                  {nearbyHelpCount > 99 ? '99+' : nearbyHelpCount}
                </span>
              )}
            </Link>
            <Link href="/help/create" onClick={() => setHelpOpen(false)} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#e85d2c] px-4 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-[#d14a1a]">
              <Plus size={15} strokeWidth={2.2} />
              Request
            </Link>
          </div>
        </div>
      </Sheet>
      {pathname === '/feed' && (
        <button
          type="button"
          data-canact-feed-create-button
          aria-label="Open posting choices"
          aria-haspopup="dialog"
          onClick={() => {
            haptic('strong');
            setRadialCreateOpen(false);
            setPlusOpen(true);
          }}
          className="canact-feed-quick-create-button fixed lg:hidden"
          style={{
            left: 'calc(var(--canact-create-button-left) + 4px)',
            bottom: 'calc(92px + var(--canact-mobile-bottom-inset, 0px))',
          }}
        >
          <Plus className="canact-adaptive-icon" size={27} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}
      <StickyHelpPullTab />
      <button
        type="button"
        data-canact-create-button
        aria-label={radialCreateOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={radialCreateOpen}
        aria-controls="canact-radial-create-menu"
        data-liquid-glass="none"
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
          left: 'var(--canact-create-button-left)',
          bottom: 'var(--canact-create-button-bottom)',
        }}
      >
        {radialCreateOpen ? <X className="canact-adaptive-icon" size={29} strokeWidth={2.3} style={{ color: '#fff' }} /> : <Compass className="canact-adaptive-icon" size={26} strokeWidth={2} style={{ color: '#fff' }} />}
      </button>
      <RadialCreateMenu open={radialCreateOpen} onClose={() => setRadialCreateOpen(false)} />
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
      {postPopups}
    </div>
  );
}

function useLiquidNavSlider(
  pathname: string | null,
  userId: string | undefined,
  router: ReturnType<typeof useRouter>,
  tabs: Tab[],
  handleAction?: (tab: Tab) => boolean,
) {
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
      if (target && handleAction?.(target)) {
        // Action tabs (such as Help) open UI without changing routes.
      } else if (target && !isNavLinkActive(pathname, target.href, userId)) {
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
  }, [activeIndex, handleAction, metrics, pathname, router, snap, tabs, userId]);

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
  if (isIOSDevice()) return 'env(safe-area-inset-top, 0px)';
  return isAndroidAppShell() ? 'max(env(safe-area-inset-top, 0px), 24px)' : null;
}

function getMobileFooterBottomInset() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  return isAndroidAppShell() ? 'max(env(safe-area-inset-bottom, 0px), 8px)' : null;
}

function isAndroidAppShell() {
  if (!/Android/i.test(navigator.userAgent || '')) return false;
  return 'Capacitor' in window
    || /; wv\)|\bwv\b/i.test(navigator.userAgent || '')
    || !!window.matchMedia?.('(display-mode: standalone)').matches
    || !!window.matchMedia?.('(display-mode: fullscreen)').matches;
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function titleFor(path: string | null) {
  if (!path) return '';
  if (path === '/') return 'Home';
  if (path.startsWith('/feed')) return 'Feed';
  if (path.startsWith('/help')) return 'Help';
  if (path.startsWith('/mood')) return 'Mood Board';
  if (path.startsWith('/create')) return 'Create';
  if (path.startsWith('/leaderboard')) return 'Leaderboard';
  if (path.startsWith('/profile')) return 'Profile';
  if (path.startsWith('/notifications')) return 'Notifications';
  if (path.startsWith('/favourites')) return 'Favourites';
  if (path.startsWith('/search')) return 'Search';
  if (path.startsWith('/underground')) return 'Underground';
  if (path.startsWith('/settings')) return 'Settings';
  if (path.startsWith('/terms')) return 'Terms of Service';
  if (path.startsWith('/privacy')) return 'Privacy Policy';
  if (path.startsWith('/edit-profile')) return 'Edit profile';
  return '';
}

type ScoreMotion = {
  delta: number;
  targetScore: number;
  summary: ReturnType<typeof calculateCanactScore>;
  icon: string;
  label: string;
  tone: 'positive' | 'negative';
};

function totalProfileValues(record?: Record<string, number> | null) {
  return Object.values(record ?? {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function describeScoreMotion(previous: UserProfile, next: UserProfile, delta: number): Omit<ScoreMotion, 'targetScore' | 'summary'> {
  const positive = delta > 0;
  const changed = (key: keyof UserProfile) => Number(next[key] || 0) - Number(previous[key] || 0);
  const onboardingDelta = Number(next.onboarding?.points || 0) - Number(previous.onboarding?.points || 0);
  const positiveAttrDelta = POSITIVE_ATTRS.reduce((sum, key) => sum + Number(next.attrs?.[key] || 0) - Number(previous.attrs?.[key] || 0), 0);
  const negativeAttrDelta = NEGATIVE_ATTRS.reduce((sum, key) => sum + Number(next.attrs?.[key] || 0) - Number(previous.attrs?.[key] || 0), 0);
  const cardDelta = totalProfileValues(next.cardsReceived) - totalProfileValues(previous.cardsReceived);
  const helpDelta = totalProfileValues(next.helpStats as Record<string, number> | undefined) - totalProfileValues(previous.helpStats as Record<string, number> | undefined);
  const profileSelfieCompleted = !previous.onboarding?.completed?.['face-identity'] && !!next.onboarding?.completed?.['face-identity'];

  if (changed('likesCount') > 0) return { delta, icon: '♥', label: 'Good rating received', tone: 'positive' };
  if (changed('dislikesCount') > 0) return { delta, icon: '↘', label: 'Community feedback changed your score', tone: 'negative' };
  if (positiveAttrDelta > 0) return { delta, icon: '✦', label: 'Positive attribute received', tone: 'positive' };
  if (negativeAttrDelta > 0) return { delta, icon: '↘', label: 'Attribute feedback received', tone: 'negative' };
  if (changed('contentLikes') > 0) return { delta, icon: '♥', label: 'Positive reaction on your content', tone: 'positive' };
  if (changed('contentDislikes') > 0) return { delta, icon: '↘', label: 'Content feedback changed your score', tone: 'negative' };
  if (changed('activityScorePoints') > 0) return { delta, icon: '✦', label: 'Community activity added to your score', tone: 'positive' };
  if (cardDelta > 0) return { delta, icon: '✦', label: 'Connection card received', tone: 'positive' };
  if (helpDelta !== 0) return { delta, icon: positive ? '♥' : '↘', label: positive ? 'Your help was recognised' : 'A help outcome changed your score', tone: positive ? 'positive' : 'negative' };
  if (profileSelfieCompleted) return { delta, icon: '✓', label: 'Profile selfie added', tone: 'positive' };
  if (onboardingDelta > 0) return { delta, icon: '✓', label: 'Setup milestone completed', tone: 'positive' };
  return { delta, icon: positive ? '↗' : '↘', label: `Score ${positive ? 'increased' : 'changed'} by ${Math.abs(delta)}`, tone: positive ? 'positive' : 'negative' };
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
  const [friendRequestCount, setFriendRequestCount] = useState(0);
  const [favouriteRequestCount, setFavouriteRequestCount] = useState(0);
  const [liveSummary, setLiveSummary] = useState<ReturnType<typeof calculateCanactScore> | null>(null);
  const prevScoreRef = useRef<number | null>(null);
  const prevScoreProfileRef = useRef<UserProfile | null>(null);
  const [scoreDelta, setScoreDelta] = useState(0);
  const [scoreFlights, setScoreFlights] = useState<Array<{ id: number; points: number; style: React.CSSProperties }>>([]);
  const [pillImpact, setPillImpact] = useState(false);
  const [islandMoment, setIslandMoment] = useState<{ icon: string; label: string; tone: 'positive' | 'negative' | 'neutral' } | null>(null);
  const islandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const motionQueueRef = useRef<ScoreMotion[]>([]);
  const motionBusyRef = useRef(false);
  const motionTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const processMotionRef = useRef<() => void>(() => {});
  const profileRequestCount = friendRequestCount + favouriteRequestCount;

  useEffect(() => {
    if (!user) {
      setFriendRequestCount(0);
      setFavouriteRequestCount(0);
      return;
    }
    const stopFriends = listenIncomingRequests(user.uid, (items) => setFriendRequestCount(items.length));
    const stopFavourites = listenFollowRequests(user.uid, (items) => setFavouriteRequestCount(items.length));
    return () => {
      stopFriends();
      stopFavourites();
    };
  }, [user?.uid]);

  const triggerIslandMoment = useCallback((icon: string, label: string, tone: 'positive' | 'negative' | 'neutral' = 'neutral') => {
    setIslandMoment({ icon, label, tone });
    if (islandTimerRef.current) clearTimeout(islandTimerRef.current);
    islandTimerRef.current = setTimeout(() => { islandTimerRef.current = null; setIslandMoment(null); }, 3400);
  }, []);

  const launchScoreFlight = useCallback((points: number) => {
    if (points === 0 || typeof window === 'undefined') return;
    const target = document.querySelector<HTMLElement>('.canact-score-island-portal [data-canact-score-target]')
      ?? document.querySelector<HTMLElement>('[data-canact-header] [data-canact-score-target]')
      ?? islandRef.current;
    const targetRect = target?.getBoundingClientRect();
    const startX = window.innerWidth / 2;
    const startY = Math.min(window.innerHeight * .72, window.innerHeight - 150);
    const endX = targetRect ? targetRect.left + targetRect.width / 2 : window.innerWidth / 2;
    const endY = targetRect ? targetRect.top + targetRect.height / 2 : 60;
    const id = Date.now() + Math.random();
    setScoreFlights((current) => [...current, {
      id,
      points,
      style: {
        left: startX,
        top: startY,
        '--reward-x': `${endX - startX}px`,
        '--reward-y': `${endY - startY}px`,
      } as React.CSSProperties,
    }]);
  }, []);

  const processScoreMotion = useCallback(() => {
    if (motionBusyRef.current) return;
    const motion = motionQueueRef.current.shift();
    if (!motion) return;
    motionBusyRef.current = true;
    launchScoreFlight(motion.delta);

    const impactTimer = setTimeout(() => {
      motionTimersRef.current.delete(impactTimer);
      setPillImpact(true);
      setLiveScore(motion.targetScore);
      setLiveSummary(motion.summary);
      setScoreDelta(motion.delta);
      const revealTimer = setTimeout(() => {
        motionTimersRef.current.delete(revealTimer);
        triggerIslandMoment(motion.icon, motion.label, motion.tone);
      }, 520);
      motionTimersRef.current.add(revealTimer);
      const settleTimer = setTimeout(() => {
        motionTimersRef.current.delete(settleTimer);
        setPillImpact(false);
      }, 720);
      motionTimersRef.current.add(settleTimer);
    }, 1320);
    motionTimersRef.current.add(impactTimer);

    const finishTimer = setTimeout(() => {
      motionTimersRef.current.delete(finishTimer);
      setScoreDelta(0);
      motionBusyRef.current = false;
      processMotionRef.current();
    }, 5200);
    motionTimersRef.current.add(finishTimer);
  }, [launchScoreFlight, triggerIslandMoment]);
  processMotionRef.current = processScoreMotion;

  const enqueueScoreMotion = useCallback((motion: ScoreMotion) => {
    motionQueueRef.current.push(motion);
    processMotionRef.current();
  }, []);

  // Real-time score listener with delta tracking
  useEffect(() => {
    if (!user) return;
    prevScoreRef.current = null;
    prevScoreProfileRef.current = null;
    const cursorKey = `canact:score-motion-cursor:${user.uid}`;
    const rawStoredScore = window.localStorage.getItem(cursorKey);
    const storedScore = rawStoredScore === null ? Number.NaN : Number(rawStoredScore);
    let consumedScore = Number.isFinite(storedScore) ? storedScore : null;
    let hydrated = false;
    let hydrateTimer: ReturnType<typeof setTimeout> | null = null;
    let cursorProfile: UserProfile | null = null;
    let latestProfile: UserProfile | null = null;

    const persistConsumedScore = (score: number) => {
      consumedScore = score;
      try { window.localStorage.setItem(cursorKey, String(score)); } catch { /* storage can be unavailable */ }
    };

    const stop = onValue(dbRef(db, `users/${user.uid}`), (snap) => {
      const p = snap.val() as UserProfile | null;
      if (p) {
        const s = calculateCanactScore(p);
        latestProfile = p;
        if (consumedScore !== null && s.score === consumedScore) cursorProfile = p;

        // RTDB can emit an older local cache before the server snapshot when
        // the app is reopened. Settle that hydration window before deciding
        // whether a score movement is genuinely new.
        if (!hydrated) {
          setLiveScore(consumedScore ?? s.score);
          setLiveSummary(s);
          prevScoreRef.current = s.score;
          prevScoreProfileRef.current = p;
          if (hydrateTimer) clearTimeout(hydrateTimer);
          hydrateTimer = setTimeout(() => {
            const settledProfile = latestProfile;
            if (!settledProfile) return;
            const settled = calculateCanactScore(settledProfile);
            const previousScore = consumedScore;
            hydrated = true;
            prevScoreRef.current = settled.score;
            prevScoreProfileRef.current = settledProfile;
            if (previousScore !== null && settled.score !== previousScore) {
              const diff = settled.score - previousScore;
              const description = cursorProfile
                ? describeScoreMotion(cursorProfile, settledProfile, diff)
                : { delta: diff, icon: diff > 0 ? '↗' : '↘', label: `Score ${diff > 0 ? 'increased' : 'changed'} by ${Math.abs(diff)}`, tone: diff > 0 ? 'positive' as const : 'negative' as const };
              persistConsumedScore(settled.score);
              enqueueScoreMotion({ targetScore: settled.score, summary: settled, ...description });
            } else {
              persistConsumedScore(settled.score);
              setLiveScore(settled.score);
              setLiveSummary(settled);
            }
          }, 320);
          return;
        }

        const prev = prevScoreRef.current;
        const previousProfile = prevScoreProfileRef.current;
        if (prev !== null && previousProfile && s.score !== prev) {
          const diff = s.score - prev;
          if (s.score !== consumedScore) {
            persistConsumedScore(s.score);
            enqueueScoreMotion({
              targetScore: s.score,
              summary: s,
              ...describeScoreMotion(previousProfile, p, diff),
            });
          } else {
            setLiveScore(s.score);
            setLiveSummary(s);
          }
        } else if (prev === null) {
          setLiveScore(s.score);
          setLiveSummary(s);
        } else if (!motionBusyRef.current && motionQueueRef.current.length === 0) {
          setLiveSummary(s);
        }
        prevScoreRef.current = s.score;
        prevScoreProfileRef.current = p;
      }
    });
    return () => {
      if (hydrateTimer) clearTimeout(hydrateTimer);
      stop();
    };
  }, [enqueueScoreMotion, user?.uid]);

  useEffect(() => () => {
    if (islandTimerRef.current) clearTimeout(islandTimerRef.current);
    motionTimersRef.current.forEach((timer) => clearTimeout(timer));
    motionTimersRef.current.clear();
    motionQueueRef.current = [];
    motionBusyRef.current = false;
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
  const nextClub = scoreSummary.clubMax;
  const pointsToNextClub = Math.max(0, nextClub - liveScore);
  const scorePercent = liveScore >= scoreSummary.max
    ? 100
    : Math.max(4, Math.min(100, ((liveScore - scoreSummary.clubMin) / Math.max(1, scoreSummary.clubMax - scoreSummary.clubMin)) * 100));

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
      className={`canact-header-shell canact-solid-header fixed z-30 lg:hidden ${headerChromeClass}`}
      style={{
        top: 'var(--canact-header-offset, 0px)',
        height: `calc(76px + ${topInset ?? '0px'})`,
        paddingTop: topInset ?? '0px',
      }}
    >
      <div
        data-liquid-glass="none"
        data-liquid-radius="0"
        data-liquid-blur="0"
        data-liquid-tint="255,255,255"
        data-liquid-tint-opacity="1"
        className="canact-figma-header"
      >
        <div className={`canact-header-inner flex items-center gap-2 px-4 relative ${profileChrome ? 'canact-profile-header-content' : ''}`}>
          <Brand size={38} href="/" className="-ml-3" />

          {/* The compact pill belongs to the header layout. Only its expanded
              dialog is portalled, so scrolling can never make the pill lag
              behind or move independently from the header. */}
          <div ref={islandRef} className="canact-score-island-shell" data-expanded={islandExpanded} data-impact={pillImpact}>
            <button
              type="button"
              className="canact-score-island canact-score-island-inline"
              data-canact-score-target
              aria-label={`Canact score ${liveScore}`}
              aria-expanded={islandExpanded}
              onClick={() => { haptic('subtle'); setIslandOpen(true); }}
            >
              <span className="canact-score-island-compact">
                <i><Activity size={17} /></i>
                <strong>{liveScore}</strong>
                <span><small>CANACT</small><small>SCORE</small></span>
                <em data-level={scoreSummary.label.toLowerCase()}>{scoreSummary.label}</em>
              </span>
            </button>
          </div>

          <div className="ml-auto inline-flex items-center gap-3">
            {/* Avatar — opens sidebar with range selector + profile link */}
            <div className="relative">
              <button
                type="button"
                aria-label={profileRequestCount > 0 ? `Open profile menu, ${profileRequestCount} pending requests` : 'Open profile menu'}
                onClick={() => { haptic('subtle'); setAvatarPopup((v) => !v); }}
                className={`inline-flex h-22 w-22 shrink-0 items-center justify-center rounded-full overflow-hidden transition ${profileChrome ? 'canact-profile-header-icon' : 'text-ink hover:text-brand'}`}
              >
                <Avatar src={profile?.photoURL ?? null} name={profile?.fullName ?? 'You'} size={50} />
              </button>
              {profileRequestCount > 0 ? (
                <span
                  className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#e34d4d] px-1 text-[9px] font-black leading-none text-white shadow-sm"
                  aria-hidden="true"
                >
                  {profileRequestCount > 9 ? '9+' : profileRequestCount}
                </span>
              ) : null}
              {sidebarMounted && createPortal(
                <>
                  {/* Backdrop — fades in/out */}
                  <div
                    className={`canact-popup-backdrop fixed inset-0 z-[2147482600] transition-opacity duration-300 ${sidebarEntered ? 'opacity-100' : 'opacity-0'}`}
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
                        className="relative flex w-full items-center justify-center gap-2 rounded-full bg-brand py-3 text-sm font-bold text-white transition active:scale-[0.98]"
                      >
                        <UserIcon size={18} />
                        <span>View Profile</span>
                        {profileRequestCount > 0 && (
                          <span className="absolute -right-1 -top-1 flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#e85d2c] border-2 border-brand px-1 text-[10px] font-extrabold text-white shadow-[0_2px_6px_rgba(232,93,44,.4)]">
                            {profileRequestCount > 99 ? '99+' : profileRequestCount}
                          </span>
                        )}
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
        <>
        <button
          type="button"
          className="canact-score-island-backdrop canact-popup-backdrop canact-popup-layer"
          data-expanded={islandExpanded}
          aria-label="Close Canact score details"
          tabIndex={islandExpanded ? 0 : -1}
          onClick={() => {
            setIslandOpen(false);
            setIslandMoment(null);
            if (islandTimerRef.current) clearTimeout(islandTimerRef.current);
          }}
        />
        <div
          ref={islandPortalRef}
          className="canact-score-island-portal canact-popup-layer-nested"
          data-expanded={islandExpanded}
          data-canact-popup="true"
          style={{
            top: islandAnchor.top,
            left: islandAnchor.left,
            '--canact-island-expanded-width': `${islandAnchor.expandedWidth}px`,
          } as React.CSSProperties}
          role={islandExpanded ? 'dialog' : undefined}
          aria-label={islandExpanded ? 'Canact score details' : undefined}
          aria-hidden={!islandExpanded}
        >
          <button
            type="button"
            className="canact-score-island"
            data-expanded={islandExpanded}
            data-tone={islandMoment?.tone ?? 'neutral'}
            data-canact-score-target
            aria-label="Close Canact score details"
            aria-expanded="true"
            tabIndex={islandExpanded ? 0 : -1}
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
            <span className="canact-score-island-compact" aria-hidden="true">
              <i><Activity size={17} /></i>
              <strong>{liveScore}</strong>
              <span><small>CANACT</small><small>SCORE</small></span>
              <em data-level={scoreSummary.label.toLowerCase()}>{scoreSummary.label}</em>
            </span>
            <span className="canact-score-island-panel">
              <span className="canact-score-island-hero">
                <i>{islandMoment?.icon ?? <Activity size={24} />}</i>
                <span><small>CANACT SCORE</small><strong>{liveScore}</strong></span>
                <b data-level={scoreSummary.label.toLowerCase()}>{scoreSummary.label}</b>
                {scoreDelta !== 0 ? <em data-positive={scoreDelta > 0}>{scoreDelta > 0 ? '+' : '−'}{Math.abs(scoreDelta)} earned</em> : null}
              </span>
              <span className="canact-score-island-club">
                <strong>{scoreSummary.club} Club</strong>
                <span className="canact-score-island-meter"><i style={{ width: `${scorePercent}%` }} /></span>
                <small>{pointsToNextClub ? `${pointsToNextClub} points to ${nextClub} Club` : 'Highest club reached'}</small>
              </span>
              <span className="canact-score-island-attribute-panel">
                <small>ATTRIBUTE GAINS</small>
                <span className="canact-score-island-attributes">
                {attrs.filter((attr) => attr.positive).map((attr) => (
                  <span key={attr.key} data-positive={attr.positive}>
                    <small>{attr.label}</small>
                    <b>+{attr.count}</b>
                  </span>
                ))}
                </span>
                <span className="canact-score-island-impact"><i>✓</i>{islandMoment?.label ?? 'Your positive impact was recognised.'}</span>
              </span>
            </span>
          </button>
        </div>
        </>,
        document.body,
      )}
      {scoreFlights.length && typeof document !== 'undefined' ? createPortal(
        scoreFlights.map((flight) => (
          <div
            key={flight.id}
            className="canact-score-reward-flight"
            data-positive={flight.points > 0}
            style={flight.style}
            onAnimationEnd={() => setScoreFlights((current) => current.filter((item) => item.id !== flight.id))}
            aria-live="polite"
          >
            {flight.points > 0 ? '+' : '−'}{Math.abs(flight.points)}
          </div>
        )),
        document.body,
      ) : null}
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
  const selectedOption = RADIUS_OPTIONS.find((option) => option.index === radiusIdx) ?? RADIUS_OPTIONS[DEFAULT_RADIUS_INDEX];

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
