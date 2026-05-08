'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from './icons';
import { haptic } from '@/lib/haptics';
import { isCanactPopupInteractionActive } from '@/lib/popupGuards';

/** Window event dispatched when a pull-to-refresh gesture completes. Pages
 *  that maintain their own RTDB subscriptions (e.g. /feed) listen for this
 *  to force a re-subscribe — `router.refresh()` alone only re-runs Server
 *  Components, which doesn't re-fetch client-streamed data. */
export const CANACT_REFRESH_EVENT = 'canact:pull-refresh';

/**
 * Global swipe-down-to-refresh. Mounted once at the top of AppShell; works
 * on every page that uses the document scroll. The previous version was
 * scoped per-page (only /feed) and used `window.scrollY` which on Android
 * WebView can lag a frame behind the touch — both of which made the
 * gesture feel broken. This version:
 *   - reads scroll from document.scrollingElement (most reliable cross-platform)
 *   - tracks the gesture from the very first touch even if scrollTop becomes
 *     non-zero mid-drag (so iOS rubber-band doesn't cancel it)
 *   - calls router.refresh() AND dispatches a custom event so client-only
 *     pages can re-subscribe
 *   - shows a centred indicator above the floating header pill
 */
export function PullToRefresh({
  onRefresh,
  children,
  threshold = 72,
  disabled = false,
}: {
  /** Optional extra hook. Even without this, router.refresh() + the
   *  `canact:pull-refresh` event are always fired. */
  onRefresh?: () => Promise<void> | void;
  children?: React.ReactNode;
  threshold?: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const pullRef = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => { pullRef.current = pull; }, [pull]);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  useEffect(() => {
    if (disabled) return;

    const getScrollTop = () => {
      const el = document.scrollingElement || document.documentElement;
      return Math.max(0, el?.scrollTop ?? window.scrollY ?? 0);
    };

    const resetGesture = () => {
      armed.current = false;
      startY.current = null;
      setPull(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (busyRef.current) return;
      if (isCanactGestureSurface(e.target)) { resetGesture(); return; }
      if (isCanactPopupInteractionActive(e.target)) { resetGesture(); return; }
      // Only arm if we're at the very top — otherwise this is a normal
      // scroll-up gesture and we must stay out of its way.
      if (getScrollTop() > 1) { resetGesture(); return; }
      startY.current = e.touches[0]?.clientY ?? null;
      armed.current = startY.current != null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (isCanactGestureSurface(e.target)) { resetGesture(); return; }
      if (isCanactPopupInteractionActive(e.target)) { resetGesture(); return; }
      if (!armed.current || startY.current == null) return;
      // If the document scrolled mid-gesture (user swiping up), abandon.
      if (getScrollTop() > 1) { resetGesture(); return; }
      const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
      if (dy <= 0) { setPull(0); return; }
      // Soft resistance past the threshold so it never feels like a free fall.
      const eased = dy < threshold ? dy : threshold + (dy - threshold) * 0.35;
      setPull(Math.min(eased, threshold * 1.8));
    };
    const onTouchEnd = async () => {
      if (isCanactPopupInteractionActive()) { resetGesture(); return; }
      if (!armed.current) { setPull(0); return; }
      armed.current = false;
      const reached = pullRef.current >= threshold;
      setPull(0);
      if (!reached) return;
      haptic('selection');
      setBusy(true);
      try {
        // Always fan out the global signal first — page-level listeners
        // (RTDB subscriptions etc.) re-arm immediately. Then run the
        // RSC refresh, then any optional caller-supplied hook.
        try { window.dispatchEvent(new CustomEvent(CANACT_REFRESH_EVENT)); } catch { /* noop */ }
        try { router.refresh(); } catch { /* noop */ }
        if (onRefresh) { try { await onRefresh(); } catch { /* noop */ } }
      } finally {
        // Hold the spinner visible briefly so the user gets clear
        // feedback even when listeners answer instantly from cache.
        setTimeout(() => setBusy(false), 500);
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
  }, [threshold, disabled, onRefresh, router]);

  const visible = busy || pull > 4;
  const progress = busy ? 1 : Math.min(pull / threshold, 1);

  return (
    <>
      <div
        aria-hidden={!visible}
        style={{
          opacity: visible ? 1 : 0,
          transform: `translate(-50%, ${busy ? 12 : Math.min(pull * 0.5, 40)}px) scale(${busy ? 1 : 0.85 + progress * 0.15})`,
        }}
        className="pointer-events-none fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+72px)] z-[60] flex h-10 w-10 items-center justify-center rounded-full bg-white text-brand transition-opacity"
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

function isCanactGestureSurface(target?: EventTarget | null) {
  return target instanceof Element && !!target.closest('[data-canact-map="true"], [data-canact-no-refresh="true"]');
}
