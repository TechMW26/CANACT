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
    <div className="min-h-screen pb-28 md:pb-6 md:flex">
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
        {/* Floating glass top bar */}
        <header className="sticky top-0 z-30 px-3 pt-3 md:pt-4 safe-top">
          <div className="flex items-center gap-1 rounded-2xl bg-white/85 backdrop-blur-md border border-white/60 shadow-[0_6px_20px_-8px_rgba(10,10,10,0.18)] px-3 py-2">
            <Link href="/feed" className="flex-1 inline-flex items-center gap-2 min-w-0">
              <span className="md:hidden"><Brand size={26} /></span>
              <span className="hidden md:inline text-lg font-bold text-ink truncate">{titleFor(pathname)}</span>
            </Link>
            <Link href="/search" aria-label="Search" className="rounded-full p-2 text-ink/80 hover:bg-brand-light hover:text-brand transition">
              <Search size={20} strokeWidth={2} />
            </Link>
            <Link href="/notifications" aria-label="Notifications" className="rounded-full p-2 text-ink/80 hover:bg-brand-light hover:text-brand transition">
              <Bell size={20} strokeWidth={2} />
            </Link>
            <Link href="/profile" aria-label="My profile" className="ml-1 ring-2 ring-white rounded-full">
              <Avatar src={profile?.photoURL ?? null} name={profile?.fullName} size={32} />
            </Link>
          </div>
        </header>
        <div className="p-4 md:p-6"><PageTransition>{children}</PageTransition></div>
      </main>

      {/* Floating mobile bottom nav */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-40 px-3 pb-3 safe-bottom pointer-events-none">
        <div className="pointer-events-auto mx-auto max-w-md rounded-[28px] bg-white/90 backdrop-blur-md border border-white/60 shadow-[0_12px_32px_-12px_rgba(10,10,10,0.28)]">
          <div className="grid grid-cols-5 h-16 items-center">
            {TABS.map(({ href, label, Icon, isFab }) => {
              const active = !isFab && (pathname === href || pathname?.startsWith(href));
              if (isFab) {
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-label="Create"
                    className="flex items-center justify-center"
                  >
                    <span className="-mt-8 inline-flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-[0_10px_24px_-6px_rgba(200,16,46,0.55)] ring-4 ring-white hover:bg-brand-dark active:scale-95 transition">
                      <Icon size={26} strokeWidth={2.4} />
                    </span>
                  </Link>
                );
              }
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex flex-col items-center justify-center gap-0.5 h-16 transition ${active ? 'text-brand' : 'text-ink/60 hover:text-ink'}`}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
                  <span className="text-[11px] font-semibold">{label}</span>
                  <span className={`absolute bottom-1.5 h-1 w-1 rounded-full bg-brand transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`} />
                </Link>
              );
            })}
          </div>
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
