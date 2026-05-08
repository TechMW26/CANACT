'use client';
import { usePathname } from 'next/navigation';

/**
 * Page entrance animation. Single fade + slight rise + scale on the whole
 * subtree per route change — feels more app-like than per-child stagger.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const instantProfileHero = !!pathname && (pathname === '/profile' || (pathname.startsWith('/profile/') && !pathname.startsWith('/profile/settings')));
  return (
    <div key={pathname} className={instantProfileHero ? undefined : 'canact-fade-in'}>
      {children}
    </div>
  );
}
