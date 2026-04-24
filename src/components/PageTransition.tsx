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
            {/* Subtle, single broad wave on top + bottom edges. Wider control
                spacing keeps the curves gentle on narrow mobile screens. */}
            <path
              className="canact-blob a"
              fill="url(#candyGrad)"
              d="M-10,6 C25,-2 75,14 110,4 L110,96 C75,104 25,88 -10,96 Z"
            />
            <path
              className="canact-blob b"
              fill="url(#candyGrad2)"
              opacity="0.92"
              d="M-10,11 C30,3 70,19 110,9 L110,101 C70,109 30,93 -10,101 Z"
            />
            <path
              className="canact-blob c"
              fill="url(#candyGrad3)"
              opacity="0.78"
              d="M-10,16 C35,8 65,22 110,14 L110,106 C65,114 35,98 -10,106 Z"
            />
          </g>
        </svg>
      </div>
    </>
  );
}
