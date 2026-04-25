'use client';
import { usePathname } from 'next/navigation';
import { Children } from 'react';

/**
 * Page entrance animation.
 *
 * No overlay sweep — instead, on every route change the new page's top-level
 * children fade and rise in with a tiny stagger. Pure transform + opacity, so
 * it stays buttery on every device (iOS Safari included).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Wrap each direct child so the animation always re-runs, even for fragments
  // or route payloads that do not forward className/style props.
  const items = Children.toArray(children).map((child, i) => (
    <div
      key={`${pathname}-${i}`}
      className="canact-fade-in"
      style={{ animationDelay: `${Math.min(i * 45, 240)}ms` }}
    >
      {child}
    </div>
  ));

  // `key` on the outer wrapper forces a fresh subtree on route change.
  return <div key={pathname}>{items}</div>;
}
