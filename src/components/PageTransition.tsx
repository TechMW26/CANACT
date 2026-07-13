'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const STACK_KEY = 'canact_nav_stack';

function getDirection(current: string, next: string): 'forward' | 'back' {
  if (typeof window === 'undefined') return 'forward';
  try {
    const raw = sessionStorage.getItem(STACK_KEY);
    const stack: string[] = raw ? JSON.parse(raw) : [];
    const idx = stack.indexOf(next);
    if (idx >= 0) {
      // Popping back — truncate stack to this point
      sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(0, idx + 1)));
      return 'back';
    }
    sessionStorage.setItem(STACK_KEY, JSON.stringify([...stack, next].slice(-60)));
    return 'forward';
  } catch { return 'forward'; }
}

/**
 * App-style page transitions: slide-in from right (forward) or left (back).
 * Uses CSS animation classes so React's key-based remount triggers the
 * entrance animation on every route change.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const directionRef = useRef<'forward' | 'back'>('forward');
  const prevPathname = useRef(pathname);

  useEffect(() => {
    directionRef.current = getDirection(prevPathname.current, pathname);
    prevPathname.current = pathname;
  }, [pathname]);

  // Full-screen fixed surfaces must remain rooted to the viewport. A
  // transformed transition wrapper becomes their containing block and breaks
  // bottom-sheet/header positioning.
  const skipTransition = !!pathname && (
    pathname === '/favourites'
    || pathname === '/profile'
    || (pathname.startsWith('/profile/') && !pathname.startsWith('/profile/settings'))
  );
  if (skipTransition) return <>{children}</>;

  const cls = directionRef.current === 'back' ? 'canact-page-enter-back' : 'canact-page-enter-forward';

  return (
    <div key={pathname} className={cls}>
      {children}
    </div>
  );
}
