'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from './icons';
import { haptic } from '@/lib/haptics';

/**
 * Swipe-down-to-refresh wrapper. Wraps a scroll region; when the user
 * starts at the very top and drags down past `threshold` pixels, calling
 * `onRefresh()` triggers a brief loader. Designed to feel native on
 * Android — short distance, soft haptic, brand-coloured indicator.
 */
export function PullToRefresh({
  onRefresh,
  children,
  threshold = 70,
  disabled = false,
}: {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  threshold?: number;
  disabled?: boolean;
}) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (disabled) return;
    const onTouchStart = (e: TouchEvent) => {
      if (busy) return;
      const sy = window.scrollY || document.documentElement.scrollTop;
      if (sy > 0) { startY.current = null; armed.current = false; return; }
      startY.current = e.touches[0]?.clientY ?? null;
      armed.current = true;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!armed.current || startY.current == null) return;
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy <= 0) { setPull(0); return; }
      // resist after the threshold so it never feels like a free fall
      const eased = dy < threshold ? dy : threshold + (dy - threshold) * 0.35;
      setPull(Math.min(eased, threshold * 1.6));
    };
    const onTouchEnd = async () => {
      if (!armed.current) { setPull(0); return; }
      armed.current = false;
      const reached = pull >= threshold;
      setPull(0);
      if (reached) {
        haptic('selection');
        setBusy(true);
        try { await onRefresh(); } catch {}
        // Keep the spinner visible briefly so the user gets clear feedback
        // even when the listeners answer instantly from cache.
        setTimeout(() => setBusy(false), 450);
      }
    };
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [pull, threshold, busy, onRefresh, disabled]);

  const visible = busy || pull > 4;
  const progress = busy ? 1 : Math.min(pull / threshold, 1);

  return (
    <>
      <div
        aria-hidden={!visible}
        style={{
          opacity: visible ? 1 : 0,
          transform: `translate(-50%, ${busy ? 12 : Math.min(pull * 0.5, 36)}px)`,
        }}
        className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+72px)] z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand shadow-[0_8px_22px_-8px_rgba(10,10,10,0.35)] transition-opacity"
      >
        <Loader2
          size={20}
          className={busy ? 'animate-spin' : ''}
          style={{ transform: `rotate(${progress * 360}deg)`, transition: busy ? 'none' : 'transform 80ms linear' }}
        />
      </div>
      {children}
    </>
  );
}
