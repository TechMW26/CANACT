'use client';
import { useEffect } from 'react';
import { BrandMark } from './Brand';
import { haptic } from '@/lib/haptics';

/** Minimal full-screen loader: brand icon + a small spinner underneath.
 * Fires a success haptic when it unmounts (i.e. loading completes). */
export function Splash(_props: { message?: string } = {}) {
  useEffect(() => {
    return () => { haptic('success'); };
  }, []);
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-candy">
      <BrandMark size={88} />
      <span
        aria-label="Loading"
        role="status"
        className="mt-6 inline-block h-6 w-6 rounded-full border-2 border-brand/25 border-t-brand animate-spin"
      />
    </div>
  );
}
