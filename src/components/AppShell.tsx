'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { DistanceProvider, RADIUS_OPTIONS, useDistance } from '@/lib/distance';
import { Avatar } from './Avatar';
import { Brand } from './Brand';
import { PageTransition } from './PageTransition';
import { PlusSheet } from './PlusSheet';
import { VicinityTracker } from './VicinityTracker';
import { Splash } from './Splash';
import { Select } from './Input';
import { haptic } from '@/lib/haptics';
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

  if (loading || !user || (!profile && !profileTimedOut)) {
    return <Splash message={loading ? 'Loading…' : user ? 'Getting your profile…' : 'Loading…'} />;
  }

  return (
    <div id="canact-app-shell" className="min-h-screen pb-28 md:pb-6 md:flex">
      <ScrollDirectionWatcher />
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:flex-col md:w-60 md:shrink-0 md:gap-1 md:py-4 md:pr-2">
        <div className="px-3 py-2 mb-2">
          <Brand size={32} href="/feed" />
        </div>
        {SIDE_LINKS.map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== '/' && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${active ? 'bg-brand-light text-brand font-bold' : 'text-ink hover:bg-brand-light/60'}`}
            >
              <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
              <span>{label}</span>
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

      <main className="flex-1 md:pl-2">
        <UnifiedHeader />
        <div className="canact-col px-2 pb-4 md:max-w-none md:px-6 md:pb-6"><PageTransition>{children}</PageTransition></div>
        <VicinityTracker />
      </main>

      {/* Floating mobile bottom nav */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 pb-3 safe-bottom pointer-events-none">
        <div className="canact-col pointer-events-auto rounded-[28px] bg-white/90 backdrop-blur-md border border-white/60 shadow-[0_12px_32px_-12px_rgba(10,10,10,0.28)]">
          <div className="grid grid-cols-5 h-16 items-center">
            {TABS.map(({ href, label, Icon, isFab }) => {
              const active = !isFab && (pathname === href || pathname?.startsWith(href));
              if (isFab) {
                return (
                  <button
                    key={href}
                    type="button"
                    onClick={() => { haptic('strong'); setPlusOpen(true); }}
                    aria-label="Create"
                    className="flex items-center justify-center"
                  >
                    <span className="-mt-8 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-[0_10px_24px_-6px_rgba(200,16,46,0.55)] ring-4 ring-white hover:bg-brand-dark active:scale-95 transition">
                      <Icon size={26} strokeWidth={2.4} />
                    </span>
                  </button>
                );
              }
              const isProfile = href === '/profile';
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label={label || href}
                  onClick={() => { if (!active) haptic('selection'); }}
                  className={`relative flex flex-col items-center justify-center h-16 transition ${active ? 'text-brand' : 'text-ink/60 hover:text-ink'}`}
                >
                  {isProfile ? (
                    <span className={`inline-flex rounded-full ${active ? 'ring-2 ring-brand ring-offset-2 ring-offset-white' : 'ring-1 ring-line'}`}>
                      <Avatar src={profile?.photoURL ?? null} name={profile?.fullName} size={28} />
                    </span>
                  ) : (
                    <Icon size={24} strokeWidth={active ? 2.4 : 1.9} />
                  )}
                  <span className={`absolute bottom-1.5 h-1 w-1 rounded-full bg-brand transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
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
  return (
    <header
      data-canact-header
      className="sticky top-0 z-30 pt-3 pb-3 safe-top md:px-6 md:pt-4"
    >
      <div className="canact-col md:max-w-none flex items-center gap-2 rounded-2xl bg-white/85 backdrop-blur-md border border-white/60 shadow-[0_6px_20px_-8px_rgba(10,10,10,0.18)] px-3 py-2">
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
          <Link href="/search" aria-label="Search" onClick={() => haptic('subtle')} className="inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full border border-[#F1D7DC] bg-white/90 text-ink/70 hover:bg-brand-light hover:text-brand transition">
            <Search size={16} strokeWidth={2.2} />
          </Link>
          <Link href="/inbox" aria-label="Inbox" onClick={() => haptic('subtle')} className="inline-flex h-9 w-9 shrink-0 aspect-square items-center justify-center rounded-full border border-[#F1D7DC] bg-white/90 text-ink/70 hover:bg-brand-light hover:text-brand transition">
            <MessageSquare size={16} strokeWidth={2.2} />
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
