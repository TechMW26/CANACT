'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { Avatar } from './Avatar';
import { Brand } from './Brand';
import { PageTransition } from './PageTransition';
import type { LucideIcon } from 'lucide-react';
import {
  Home, LifeBuoy, Plus, Trophy, UserIcon, Search, Bell,
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
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24 md:pb-6 md:flex">
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
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-candy/95 backdrop-blur safe-top">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
            <Link href="/feed" className="flex-1 inline-flex items-center gap-2">
              <span className="md:hidden"><Brand size={26} /></span>
              <span className="hidden md:inline text-lg font-bold text-ink">{titleFor(pathname)}</span>
            </Link>
            <Link href="/search" aria-label="Search" className="rounded-full p-2 hover:bg-brand-light">
              <Search size={20} strokeWidth={2} />
            </Link>
            <Link href="/notifications" aria-label="Notifications" className="rounded-full p-2 hover:bg-brand-light">
              <Bell size={20} strokeWidth={2} />
            </Link>
            <Link href="/profile" aria-label="My profile">
              <Avatar src={profile?.photoURL ?? null} name={profile?.fullName} size={32} />
            </Link>
          </div>
        </header>
        <div className="p-4 md:p-6"><PageTransition>{children}</PageTransition></div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-surface/95 backdrop-blur border-t border-line safe-bottom">
        <div className="grid grid-cols-5 h-16 items-end">
          {TABS.map(({ href, label, Icon, isFab }) => {
            const active = !isFab && (pathname === href || pathname?.startsWith(href));
            if (isFab) {
              return (
                <Link
                  key={href}
                  href={href}
                  aria-label="Create"
                  className="flex items-end justify-center"
                >
                  <span className="-mt-7 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-card hover:bg-brand-dark transition">
                    <Icon size={26} strokeWidth={2.4} />
                  </span>
                </Link>
              );
            }
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center gap-0.5 h-16 ${active ? 'text-brand' : 'text-ink/70'}`}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
                <span className="text-[11px] font-semibold">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
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
