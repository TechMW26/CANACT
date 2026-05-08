'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { DistanceProvider, RADIUS_OPTIONS, useDistance } from '@/lib/distance';
import { Avatar } from './Avatar';
import { Brand } from './Brand';
import { PageTransition } from './PageTransition';
import { PullToRefresh } from './PullToRefresh';
import { PlusSheet } from './PlusSheet';
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
  Home, LifeBuoy, Plus, Trophy, UserIcon, Search, Bell, MessageSquare,
  Heart, Eye, Settings as SettingsIcon, Sparkles,
} from './icons';

type Tab = { href: string; label: string; Icon: LucideIcon; isFab?: boolean };

const TABS: Tab[] = [
  { href: '/feed',        label: 'Feed',  Icon: Home },
  { href: '/help',        label: 'Help',  Icon: LifeBuoy },
  { href: '/create',      label: '',      Icon: Plus, isFab: true },
  { href: '/leaderboard', label: 'Top',   Icon: Trophy },
  { href: '/profile',     label: 'Me',    Icon: UserIcon },
];

const SIDE_LINKS = [
  { href: '/feed',         label: 'Feed',          Icon: Home },
  { href: '/inbox',        label: 'Inbox',         Icon: MessageSquare },
  { href: '/help',         label: 'Help',          Icon: LifeBuoy },
  { href: '/leaderboard',  label: 'Leaderboard',   Icon: Trophy },
  { href: '/notifications',label: 'Notifications', Icon: Bell },
  { href: '/favourites',   label: 'Favourites',    Icon: Heart },
  { href: '/search',       label: 'Search',        Icon: Search },
  { href: '/underground',  label: 'Underground',   Icon: Eye },
  { href: '/profile',      label: 'My Profile',    Icon: UserIcon },
  { href: '/settings',     label: 'Settings',      Icon: SettingsIcon },
];

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
  const [globalDetailItem, setGlobalDetailItem] = useState<PostDetailSheetItem | null>(null);
  const [postShareAttachment, setPostShareAttachment] = useState<ChatAttachment | null>(null);
  const [profileTimedOut, setProfileTimedOut] = useState(false);
  const [mobileHeaderTopInset, setMobileHeaderTopInset] = useState<string | null>(null);
  const [mobileBottomNavSafeInset, setMobileBottomNavSafeInset] = useState<string | null>(null);
  // Live counters for the chat icon (header) and Inbox sidebar entry.
  const { total: inboxTotal } = useInboxBadges();
  const profileBlendChrome = !!pathname && (pathname === '/profile' || (pathname.startsWith('/profile/') && !pathname.startsWith('/profile/settings')));

  useEffect(() => {
    if (!user || profile) { setProfileTimedOut(false); return; }
    const id = setTimeout(() => setProfileTimedOut(true), 7000);
    return () => clearTimeout(id);
  }, [user, profile]);

  useEffect(() => {
    setMobileHeaderTopInset(getMobileHeaderTopInset());
    const updateViewportChrome = () => {
      updatePopupViewportVars();
      setMobileBottomNavSafeInset(getMobileBottomNavSafeInset());
    };
    updateViewportChrome();
    window.addEventListener('resize', updateViewportChrome);
    window.addEventListener('orientationchange', updateViewportChrome);
    window.visualViewport?.addEventListener('resize', updateViewportChrome);
    window.visualViewport?.addEventListener('scroll', updateViewportChrome);
    return () => {
      window.removeEventListener('resize', updateViewportChrome);
      window.removeEventListener('orientationchange', updateViewportChrome);
      window.visualViewport?.removeEventListener('resize', updateViewportChrome);
      window.visualViewport?.removeEventListener('scroll', updateViewportChrome);
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/welcome'); return; }
    // Don't bounce to /onboard while the profile subscription is still pending.
    if (!profile && !profileTimedOut) return;
    if ((!profile || profile.profileComplete === false) && !pathname?.startsWith('/onboard')) {
      router.replace('/onboard');
    }
  }, [user, profile, loading, pathname, router, profileTimedOut]);

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
  // on /feed. We keep recording `canact:lastRoute` for in-session
  // recovery (e.g. WebView reload mid-call) but no longer hijack the
  // first navigation after a cold start.
  const restoredRouteRef = useRef(true);

  if (loading || !user || (!profile && !profileTimedOut)) {
    // Mount the ringer + deep-link router OUTSIDE the splash return so a
    // call answered from the lockscreen notification doesn't have to wait
    // for the WebView to finish loading the full app + profile data
    // before WebRTC can start. As soon as the user object resolves the
    // ringer can subscribe to incomingCalls and pick up the pre-decision.
    return (
      <>
        <Splash message={loading ? 'Loading…' : user ? 'Getting your profile…' : 'Loading…'} />
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
      <div id="canact-app-shell" className="min-h-screen">
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
    <div id="canact-app-shell" className="min-h-screen pb-28 lg:pb-6">
      <ScrollDirectionWatcher />
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
      <div id="canact-app-content" data-disable-sheet-zoom={profileBlendChrome ? 'true' : undefined} className="lg:w-full lg:pl-60">
      {/* Desktop sidebar — fixed to the viewport so it's always in view
          regardless of how far the main column scrolls. Hidden under lg
          (tablet portrait still gets the floating mobile header + bottom nav). */}
      <aside className="hidden lg:flex lg:flex-col lg:fixed lg:left-0 lg:top-0 lg:bottom-0 lg:w-60 lg:gap-1 lg:py-6 lg:px-4 lg:overflow-y-auto lg:bg-white/60 lg:backdrop-blur lg:border-r lg:border-line lg:z-20">
        <div className="px-3 py-2 mb-2">
          <Brand size={32} href="/feed" />
        </div>
        {SIDE_LINKS.map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
          // Inbox link gets a live badge that includes both unread
          // messages and pending chat requests so the user can see at
          // a glance there's something to deal with.
          const inboxBadge = href === '/inbox' ? inboxTotal : 0;
          return (
            <Link
              key={href}
              href={href}
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
        <UnifiedHeader blendChrome={profileBlendChrome} topInset={mobileHeaderTopInset} />
        {/* Spacer mirroring the fixed top bar so page content starts below it.
          Top bar = safe-area-inset-top + 56px (h-14 row). */}
        <div
          data-canact-header-spacer
          aria-hidden
          className="lg:hidden"
          style={{ height: mobileHeaderTopInset ? `calc(${mobileHeaderTopInset} + 56px)` : '56px' }}
        />
        <div className="canact-col pb-20 lg:!max-w-none lg:w-full lg:mx-0 lg:px-6 lg:pb-6"><PageTransition>{children}</PageTransition></div>
        <VicinityTracker />
        <IncomingCallRinger />
        <HelpAlertManager />
        <NativePermissionsBootstrapper />
        <NativeCallDeepLinkRouter />
      </main>
      </div>{/* /canact-app-content */}

        {/* Mobile bottom nav is profile-blended on profile routes and standard
          white elsewhere. Active tab gets the brand pill treatment. */}
      <nav
        className={`lg:hidden fixed inset-x-0 bottom-0 z-40 transition-colors duration-500 ease-out ${profileBlendChrome ? 'canact-profile-footer-chrome border-t-0 pt-8' : 'bg-white border-t border-line'}`}
        style={{ paddingBottom: mobileBottomNavSafeInset ?? undefined }}
      >
        <div className="relative z-10 flex h-16 items-center justify-around px-2">
            {TABS.map(({ href, label, Icon, isFab }) => {
              const active = (pathname === href || pathname?.startsWith(href));
              const isProfile = href === '/profile';
              const onTap = () => {
                if (isFab) { haptic('strong'); setPlusOpen(true); return; }
                if (!active) haptic('selection');
              };
              const inner = (
                <>
                  {isProfile ? (
                    <span className={`inline-flex rounded-full ${active ? 'ring-2 ring-white/80' : ''}`}>
                      <Avatar src={profile?.photoURL ?? null} name={profile?.fullName} size={24} />
                    </span>
                  ) : (
                    <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
                  )}
                  <span
                    className={`overflow-hidden whitespace-nowrap text-sm font-extrabold transition-[max-width,margin,opacity] duration-300 ease-out ${
                      active ? 'ml-2 max-w-[80px] opacity-100' : 'ml-0 max-w-0 opacity-0'
                    }`}
                  >
                    {label || (isProfile ? 'Me' : isFab ? 'Add' : '')}
                  </span>
                </>
              );
              const cls = `canact-bottom-tab group relative flex h-12 items-center justify-center rounded-full px-3 transition-[background-color,padding,color,box-shadow] duration-300 ease-out ${
                active
                  ? 'canact-bottom-tab-active bg-brand text-white pl-3 pr-4'
                  : 'canact-bottom-tab-inactive text-ink/65 hover:text-ink'
              }`;
              if (isFab) {
                return (
                  <button key={href} type="button" onClick={onTap} aria-label="Create" className={cls}>
                    {inner}
                  </button>
                );
              }
              return (
                <Link key={href} href={href} aria-label={label || href} onClick={onTap} className={cls}>
                  {inner}
                </Link>
              );
            })}
        </div>
      </nav>
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
      {postPopups}
    </div>
  );
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

function getMobileBottomNavSafeInset() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (isIPhoneDevice()) return 'max(env(safe-area-inset-bottom, 0px), 8px)';
  return measureSafeAreaInsetBottom() > 0 ? 'max(env(safe-area-inset-bottom, 0px), 8px)' : null;
}

function updatePopupViewportVars() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const viewport = window.visualViewport;
  const height = Math.max(0, Math.round(viewport?.height ?? window.innerHeight));
  const bottomInset = Math.max(0, Math.round(window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0)));
  const root = document.documentElement;
  root.style.setProperty('--canact-visual-viewport-height', `${height}px`);
  root.style.setProperty('--canact-visual-viewport-bottom', `${bottomInset}px`);
}

function measureSafeAreaInsetBottom() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;bottom:0;height:0;width:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(probe);
  const value = Number.parseFloat(window.getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  return value;
}

function isIPhoneDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPod/.test(navigator.userAgent || '');
}

function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function titleFor(path: string | null) {
  if (!path) return '';
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

function UnifiedHeader({ blendChrome = false, topInset }: { blendChrome?: boolean; topInset?: string | null }) {
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

  return (
    <header
      data-canact-header
      className={`fixed top-0 left-0 right-0 z-30 lg:hidden transition-colors duration-500 ease-out ${blendChrome ? 'canact-profile-header-chrome border-b-0 pb-8' : 'bg-white border-b border-line'}`}
      style={{ paddingTop: topInset ?? undefined }}
    >
      <div className={`relative z-10 flex h-14 items-center gap-2 px-4 ${blendChrome ? 'canact-profile-header-content' : ''}`}>
        <Brand size={26} href="/feed" />
        <div className="ml-auto inline-flex items-center gap-2">
          <DistanceDropdown radiusIdx={radiusIdx} setRadiusIdx={setRadiusIdx} blendChrome={blendChrome} />
          <Link href="/search" aria-label="Search" prefetch onClick={() => haptic('subtle')} className={`inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full transition ${blendChrome ? 'canact-profile-header-icon' : 'text-ink/70 hover:bg-brand-light hover:text-brand'}`}>
            <Search size={18} strokeWidth={2.2} />
          </Link>
          <Link href="/favourites" aria-label="Friends and favourites" prefetch onClick={() => haptic('subtle')} className={`relative inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full transition ${blendChrome ? 'canact-profile-header-icon' : 'text-ink/70 hover:bg-brand-light hover:text-brand'}`}>
            <Heart size={18} strokeWidth={2.2} />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
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
  const menuClassName = `absolute right-0 top-[calc(100%+8px)] z-50 w-36 overflow-hidden rounded-2xl border p-1 backdrop-blur-xl ${blendChrome ? 'border-white/50 bg-white/90 text-ink' : 'border-line bg-white text-ink'}`;

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
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
        <div role="listbox" aria-label="Feed distance filter" className={menuClassName}>
          {RADIUS_OPTIONS.map((option) => {
            const selected = option.index === radiusIdx;
            return (
              <button
                key={option.index}
                type="button"
                role="option"
                aria-selected={selected}
                className={`flex h-9 w-full items-center justify-center rounded-xl px-3 text-center text-xs font-extrabold transition ${selected ? 'bg-brand text-white' : 'text-ink/75 hover:bg-brand-light hover:text-brand'}`}
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

/** Watches window scroll and toggles `data-header-hidden` on the shell so
 *  CSS can slide the unified header up and the stories strip into its place. */
function ScrollDirectionWatcher() {
  useEffect(() => {
    const shell = document.getElementById('canact-app-shell');
    if (!shell) return;
    let lastY = window.scrollY;
    let ticking = false;
    const TOP_GUARD = 8;      // always show when this close to top
    const DELTA = 2;          // ignore only sub-pixel jitter — even ~4px scroll hides

    const update = () => {
      const y = window.scrollY;
      const dy = y - lastY;
      if (y < TOP_GUARD) {
        shell.setAttribute('data-header-hidden', 'false');
      } else if (dy > DELTA) {
        // any downward scroll past tiny jitter — hide immediately
        shell.setAttribute('data-header-hidden', 'true');
      } else if (dy < -DELTA) {
        // upward scroll — show again
        shell.setAttribute('data-header-hidden', 'false');
      }
      lastY = y;
      ticking = false;
    };
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return null;
}
