'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Content-only route transition. AppShell keeps the unified header and
 * footer outside this wrapper, so neither piece of navigation moves.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const directionRef = useRef<'forward' | 'back'>('forward');
  const prevPathname = useRef(pathname);
  const browserBack = useRef(false);

  useEffect(() => {
    const handlePopState = () => { browserBack.current = true; };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  if (prevPathname.current !== pathname) {
    directionRef.current = browserBack.current ? 'back' : 'forward';
    browserBack.current = false;
    prevPathname.current = pathname;
  }

  const cls = directionRef.current === 'back'
    ? 'canact-page-enter-back'
    : 'canact-page-enter-forward';

  return (
    <div key={pathname} className={`canact-page-transition ${cls}`}>
      {children}
    </div>
  );
}
