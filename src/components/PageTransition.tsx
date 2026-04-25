'use client';
import { usePathname } from 'next/navigation';
import { Children, isValidElement, cloneElement } from 'react';

/**
 * Page entrance animation.
 *
 * No overlay sweep — instead, on every route change the new page's top-level
 * children fade and rise in with a tiny stagger. Pure transform + opacity, so
 * it stays buttery on every device (iOS Safari included).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Tag each direct child with a stagger index so they cascade in.
  const items = Children.toArray(children).map((child, i) => {
    const style: React.CSSProperties = {
      animationDelay: `${Math.min(i * 45, 240)}ms`,
    };
    if (isValidElement(child)) {
      const existing = (child.props as { className?: string; style?: React.CSSProperties }) ?? {};
      return cloneElement(child as React.ReactElement<{ className?: string; style?: React.CSSProperties }>, {
        className: `canact-fade-in ${existing.className ?? ''}`.trim(),
        style: { ...(existing.style ?? {}), ...style },
      });
    }
    return (
      <span key={i} className="canact-fade-in" style={style}>
        {child}
      </span>
    );
  });

  // `key` on the wrapper restarts the animation on every pathname change.
  return <div key={pathname}>{items}</div>;
}
