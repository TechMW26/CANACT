'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Saves the window scroll position per-pathname into sessionStorage and
 * restores it whenever the user navigates back to that route. Pairs
 * with the in-memory feed cache so a back-nav lands the user EXACTLY
 * where they left off — same scroll, same content, no flicker.
 *
 * Must be mounted once inside the persistent AppShell so it survives
 * across route transitions.
 */
export function ScrollRestoration() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);
  const restoredFor = useRef<string | null>(null);

  // Persist scroll continuously so the saved value is always fresh,
  // not just on navigation away.
  useEffect(() => {
    const save = () => {
      if (!pathname) return;
      try { sessionStorage.setItem(`canact:scroll:${pathname}`, String(window.scrollY || 0)); } catch {}
      try { localStorage.setItem('canact:lastRoute', pathname); } catch {}
    };
    let t: number | undefined;
    const onScroll = () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(save, 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', save);
    window.addEventListener('beforeunload', save);
    return () => {
      save();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('beforeunload', save);
      if (t) window.clearTimeout(t);
    };
  }, [pathname]);

  // Restore on entering a new route. Wait one frame so the new page
  // tree has had a chance to mount; if data still hasn't loaded yet
  // the page itself can stash an explicit min-height to avoid layout
  // collapse.
  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;
    if (restoredFor.current === pathname) return;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(`canact:scroll:${pathname}`); } catch {}
    if (!raw) return;
    const y = Number(raw);
    if (!Number.isFinite(y) || y <= 0) return;
    restoredFor.current = pathname;
    // Two RAFs: first lets React commit the new tree, second lets the
    // browser lay it out before we scroll.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: y, behavior: 'auto' });
    }));
  }, [pathname]);

  return null;
}
