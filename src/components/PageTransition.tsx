'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Liquid candy page transition.
 *
 * - On every pathname change a curved candy sheet sweeps UP across the
 *   viewport (cover), the content swaps while it's fully covered, then the
 *   sheet sweeps OUT (reveal). The leading edge has organic curves on top
 *   so it never reads as a flat rectangle.
 * - Pure GPU compositing (transform + opacity), no layout thrash, so it
 *   stays smooth on phones.
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
    }, 320);
    const t2 = setTimeout(() => setPhase('idle'), 720);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [pathname]);

  return (
    <>
      <div key={contentKey} className="canact-page-enter">
        {children}
      </div>

      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-[60] overflow-hidden ${phase === 'idle' ? 'hidden' : ''}`}
      >
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="candyGrad" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#C8102E" />
              <stop offset="55%" stopColor="#E13A56" />
              <stop offset="100%" stopColor="#FFD8DD" />
            </linearGradient>
            <linearGradient id="candyGrad2" x1="0" x2="1" y1="1" y2="0">
              <stop offset="0%" stopColor="#A00B23" />
              <stop offset="100%" stopColor="#C8102E" />
            </linearGradient>
            <linearGradient id="candyGrad3" x1="1" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#FFD8DD" />
              <stop offset="100%" stopColor="#E13A56" />
            </linearGradient>
            <filter id="goo">
              <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="b" />
              <feColorMatrix
                in="b"
                mode="matrix"
                values="1 0 0 0 0
                        0 1 0 0 0
                        0 0 1 0 0
                        0 0 0 24 -10"
                result="g"
              />
              <feBlend in="SourceGraphic" in2="g" />
            </filter>
          </defs>

          <g
            filter="url(#goo)"
            className={
              phase === 'in'
                ? 'canact-blob-in'
                : phase === 'out'
                ? 'canact-blob-out'
                : ''
            }
          >
            {/* Each path keeps the bottom rectangle fully filled and uses
                cubic Béziers along the TOP edge for organic candy curves. */}
            <path
              className="canact-blob a"
              fill="url(#candyGrad)"
              d="M-5,30 C12,8 28,42 50,18 C72,-4 86,38 105,14 L105,140 L-5,140 Z"
            />
            <path
              className="canact-blob b"
              fill="url(#candyGrad2)"
              opacity="0.92"
              d="M-5,38 C18,18 36,48 56,26 C78,4 92,46 105,22 L105,140 L-5,140 Z"
            />
            <path
              className="canact-blob c"
              fill="url(#candyGrad3)"
              opacity="0.78"
              d="M-5,46 C22,28 40,54 60,32 C82,12 96,52 105,32 L105,140 L-5,140 Z"
            />
          </g>
        </svg>
      </div>
    </>
  );
}
