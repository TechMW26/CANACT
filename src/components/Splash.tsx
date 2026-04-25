'use client';
import { BrandMark } from './Brand';

/** Branded full-screen splash shown while auth and profile are resolving.
 * Replaces the bare half-second spinner so the user is never staring at a
 * blank screen during the Google sign-in handoff. */
export function Splash({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-candy">
      <div className="relative">
        <span className="absolute inset-0 -m-3 rounded-full border-2 border-brand/30 animate-ping" />
        <span className="absolute inset-0 -m-3 rounded-full border-2 border-brand/15" />
        <div className="canact-splash-pulse">
          <BrandMark size={88} />
        </div>
      </div>
      <div className="mt-7 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-xs font-bold text-ink/70 ring-1 ring-line shadow-[0_10px_24px_-18px_rgba(10,10,10,0.28)]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
        {message ?? 'Getting things ready…'}
      </div>
    </div>
  );
}
