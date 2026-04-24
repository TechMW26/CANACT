'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Liquid candy page transition — mobile-first, GPU-only.
 *
 * - No SVG filters (those are the #1 cause of jank on iOS Safari).
 * - Two layered SVG paths with subtle curves on top + bottom edges.
 * - Animation drives ONLY `transform: translate3d(...)` on a fixed-size
 *   overlay, so Safari can promote it to its own compositor layer and
 *   never re-rasterise.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<'idle' | 'in' | 'out'>('idle');
  const [contentKey, setContentKey] = useState(pathname);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setPhase('in');
    const t1 = setTimeout(() => {
      setContentKey(pathname);
      setPhase('out');
    }, 300);
    const t2 = setTimeout(() => setPhase('idle'), 660);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [pathname]);

  return (
    <>
      <div key={contentKey} className="canact-page-enter">
        {children}
      </div>

      <div
        aria-hidden
        className={`canact-overlay ${phase === 'idle' ? 'hidden' : ''}`}
      >
        <div
          className={
            phase === 'in'
              ? 'canact-blob-in'
              : phase === 'out'
              ? 'canact-blob-out'
              : ''
          }
        >
          <svg
            className="canact-blob a"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="cgA" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#C8102E" />
                <stop offset="55%" stopColor="#E13A56" />
                <stop offset="100%" stopColor="#FFD8DD" />
              </linearGradient>
            </defs>
            <path
              fill="url(#cgA)"
              d="M-10,8 C25,0 75,16 110,6 L110,98 C75,106 25,90 -10,98 Z"
            />
          </svg>
          <svg
            className="canact-blob b"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              <linearGradient id="cgB" x1="0" x2="1" y1="1" y2="0">
                <stop offset="0%" stopColor="#A00B23" />
                <stop offset="100%" stopColor="#E13A56" />
              </linearGradient>
            </defs>
            <path
              fill="url(#cgB)"
              opacity="0.92"
              d="M-10,14 C30,6 70,22 110,12 L110,104 C70,112 30,96 -10,104 Z"
            />
          </svg>
        </div>
      </div>
    </>
  );
}
