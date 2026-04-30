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
import { VicinityTracker } from './VicinityTracker';
import { Splash } from './Splash';
import { Select } from './Input';
import { IncomingCallRinger } from './IncomingCallRinger';
import { ScrollRestoration } from './ScrollRestoration';
import NativePermissionsBootstrapper from './NativePermissionsBootstrapper';
import NativeCallDeepLinkRouter from './NativeCallDeepLinkRouter';
import { HelpAlertManager } from './HelpAlertManager';
import { haptic } from '@/lib/haptics';
import { useInboxBadges } from '@/lib/useInboxBadges';
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
  const [profileTimedOut, setProfileTimedOut] = useState(false);
  // Live counters for the chat icon (header) and Inbox sidebar entry.
  const { total: inboxTotal } = useInboxBadges();

  useEffect(() => {
    if (!user || profile) { setProfileTimedOut(false); return; }
    const id = setTimeout(() => setProfileTimedOut(true), 7000);
    return () => clearTimeout(id);
  }, [user, profile]);

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace('/welcome'); return; }
    // Don't bounce to /onboard while the profile subscription is still pending.
    if (!profile && !profileTimedOut) return;
    if ((!profile || profile.profileComplete === false) && !pathname?.startsWith('/onboard')) {
      router.replace('/onboard');
    }
  }, [user, profile, loading, pathname, router, profileTimedOut]);

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

  if (isFullScreen) {
    return (
      <div id="canact-app-shell" className="min-h-screen">
        <ScrollRestoration />
        {/* Pull-to-refresh is intentionally NOT mounted on chat threads:
            those use their own scroll container and a downward swipe at the
            top of a conversation should never reload the page mid-message. */}
        <PageTransition>{children}</PageTransition>
        <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
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
      {/* Desktop layout: full viewport width with a sticky sidebar on the
          left and the main content stretching to fill the remaining space.
          Previously capped at 1280px which left large empty gutters on
          wide monitors. `lg:pt-6` adds breathing room from the top so the
          sidebar (and main column) don't hug the very edge of the window. */}
      <div id="canact-app-content" className="lg:flex lg:items-start lg:gap-6 lg:w-full lg:px-6 lg:pt-6">
      {/* Desktop sidebar — sticky to the viewport top so it stays in view
          while the main column scrolls. Hidden under lg (i.e. tablet
          portrait still gets the floating mobile header + bottom nav). */}
      {/* Desktop sidebar — sticky to the viewport top so it stays in view
          while the main column scrolls. Hidden under lg (i.e. tablet
          portrait still gets the floating mobile header + bottom nav).
          `lg:top-6` gives the column a comfortable gap from the top of the
          viewport once it sticks; `lg:max-h-[calc(100vh-3rem)]` keeps it
          scrollable internally if the link list ever grows past the
          viewport height. */}
      <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:shrink-0 lg:gap-1 lg:py-4 lg:pr-2 lg:pl-2 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
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
        <Link
          href="/create"
          className="mt-3 inline-flex items-center justify-center gap-2 rounded-full bg-brand text-white font-semibold py-2.5 hover:bg-brand-dark"
        >
          <Sparkles size={18} /> Create
        </Link>
      </aside>

      <main className="flex-1 min-w-0 lg:pl-2">
        <UnifiedHeader />
        {/* Spacer that occupies the same vertical space as the fixed
            header so the page content starts below it instead of
            underneath. Header total ≈ safe-area-inset-top + 76px (pt-3 +
            pill 52px + pb-3); we mirror that with safe-top padding + a
            76px content height so the spacer scales with the notch. */}
        <div
          data-canact-header-spacer
          aria-hidden
          className="lg:hidden"
          style={{ height: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}
        />
        <div className="canact-col pb-4 lg:!max-w-none lg:w-full lg:mx-0 lg:px-6 lg:pb-6"><PageTransition>{children}</PageTransition></div>
        <VicinityTracker />
        <IncomingCallRinger />
        <HelpAlertManager />
        <NativePermissionsBootstrapper />
        <NativeCallDeepLinkRouter />
      </main>
      </div>{/* /canact-app-content */}

      {/* Floating mobile bottom nav (outside the zoom-target element so it
          stays put when sheets / popups open).
          Active tab expands into a brand-tinted pill that shows its label,
          mimicking the "Home" pill in the inspiration design. The smooth
          width transition is what gives it the animated feel without
          pulling in framer-motion. */}
      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 pt-2 pb-3 safe-bottom pointer-events-none">
        <div className="canact-col pointer-events-auto rounded-[28px] bg-white border border-line shadow-[0_14px_36px_-14px_rgba(10,10,10,0.32)]">
          <div className="flex h-16 items-center justify-around px-2">
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
              const cls = `group relative flex h-12 items-center justify-center rounded-full px-3 transition-[background-color,padding,color] duration-300 ease-out ${
                active
                  ? 'bg-brand text-white pl-3 pr-4 shadow-[0_8px_18px_-8px_rgba(200,16,46,0.6)]'
                  : 'text-ink/65 hover:text-ink'
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
        </div>
      </nav>
      <PlusSheet open={plusOpen} onClose={() => setPlusOpen(false)} />
    </div>
  );
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

function UnifiedHeader() {
  const { radiusIdx, setRadiusIdx } = useDistance();
  const { user } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  // Combined unread + pending request count for the chat icon. Uses the
  // same listener as the rest of the inbox UI so all three badges (header
  // icon, sidebar link, inbox tab pills) update in lockstep.
  const { total: inboxTotal } = useInboxBadges();

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
      className="fixed top-0 left-0 right-0 z-30 pt-3 pb-3 safe-top lg:hidden pointer-events-none"
    >
      <div className="canact-col md:max-w-none pointer-events-auto flex items-center gap-2 rounded-2xl bg-white border border-line shadow-[0_6px_20px_-8px_rgba(10,10,10,0.18)] px-3 py-2">
        <Brand size={26} href="/feed" />
        <div className="ml-auto inline-flex items-center gap-2">
          <Select
            aria-label="Feed distance filter"
            value={String(radiusIdx)}
            onChange={(e) => setRadiusIdx(Number(e.target.value))}
            className="h-8 w-auto min-w-[78px] rounded-full border border-[#F1D7DC] bg-brand-light px-2 text-center text-[11px] font-bold text-brand shadow-none [&:focus-visible]:outline-none [&:focus-visible]:ring-0"
          >
            {RADIUS_OPTIONS.map((option) => (
              <option key={option.index} value={option.index}>{option.label}</option>
            ))}
          </Select>
          <Link href="/search" aria-label="Search" prefetch onClick={() => haptic('subtle')} className="inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full border border-[#F1D7DC] bg-white/90 text-ink/70 hover:bg-brand-light hover:text-brand transition">
            <Search size={16} strokeWidth={2.2} />
          </Link>
          <Link href="/favourites" aria-label="Friends and favourites" prefetch onClick={() => haptic('subtle')} className="relative inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full border border-[#F1D7DC] bg-white/90 text-ink/70 hover:bg-brand-light hover:text-brand transition">
            <Heart size={16} strokeWidth={2.2} />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </Link>
          <Link href="/inbox" aria-label="Inbox" prefetch onClick={() => haptic('subtle')} className="relative inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full border border-[#F1D7DC] bg-white/90 text-ink/70 hover:bg-brand-light hover:text-brand transition">
            <MessageSquare size={16} strokeWidth={2.2} />
            {inboxTotal > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-extrabold leading-none text-white ring-2 ring-white">
                {inboxTotal > 9 ? '9+' : inboxTotal}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
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
