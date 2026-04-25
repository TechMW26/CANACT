'use client';
import { usePathname } from 'next/navigation';

/**
 * Page entrance animation. Single fade + slight rise + scale on the whole
 * subtree per route change — feels more app-like than per-child stagger.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="canact-fade-in">
      {children}
    </div>
  );
}
