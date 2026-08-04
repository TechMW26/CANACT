'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockPageScroll } from '@/lib/scrollLock';
import { pushCanactPopupOpen, pushCanactSheetZoom } from '@/lib/popupGuards';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';
import { X } from './icons';

const ANIM_MS = 320;
type SheetZoomController = ReturnType<typeof pushCanactSheetZoom>;

/**
 * Bottom-sheet popup with the standardized Canact treatment:
 *  - Backdrop fade + blur
 *  - Slide-up panel
 *  - Background app shell scales down via `.canact-sheet-zoom-out`
 *  - Body scroll lock + Esc to close
 *  - Highest stacking context (z-[120]) so it always renders on top
 */
export function Sheet({
  open,
  onClose,
  onExited,
  title,
  hideTitle = false,
  hideClose = false,
  children,
  topmost,
}: {
  open: boolean;
  onClose: () => void;
  onExited?: () => void;
  title?: string;
  /** Keeps the dialog title available to assistive technology without
   * rendering it behind content that already carries its own heading. */
  hideTitle?: boolean;
  /** Omits the visible close control while retaining backdrop, swipe and
   * Escape dismissal. */
  hideClose?: boolean;
  children: React.ReactNode;
  /** When true, renders ABOVE every other overlay including the
   *  fullscreen incoming-call ringer (z-[200]) and the splash screen.
   *  Used by the in-app call sheet so an outgoing call started from a
   *  page that already has open modals (e.g. the chat composer) is
   *  guaranteed to be visible. */
  topmost?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const onCloseRef = useRef(onClose);
  const onExitedRef = useRef(onExited);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  const zoomRef = useRef<SheetZoomController | null>(null);
  const swipeDismissHandlers = useTopScrollSwipeDismiss({
    onClose,
    onProgress: (progress, immediate) => zoomRef.current?.setProgress(progress, immediate),
    getScrollElement: () => scrollRef.current,
    enabled: mounted,
  });
  const swipeRef = swipeDismissHandlers.ref as React.RefObject<HTMLDivElement | null>;
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { onExitedRef.current = onExited; }, [onExited]);

  useEffect(() => {
    const clearAnimationTimers = () => {
      rafRef.current.forEach((rafId) => cancelAnimationFrame(rafId));
      rafRef.current = [];
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    };
    clearAnimationTimers();

    if (open) {
      // Mount the portal first, leave entered=false so it paints off-screen.
      setMounted(true);
      // Cleanup if open flips before the enter animation completes.
      return clearAnimationTimers;
    }

    if (!mounted) return clearAnimationTimers;

    // Close: flip entered → false to trigger the exit transition, then
    // unmount after the transition duration so the slide-out is visible.
    setEntered(false);
    zoomRef.current?.setProgress(0);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMounted(false);
      onExitedRef.current?.();
    }, ANIM_MS);
    return clearAnimationTimers;
  }, [open]);

  // Separate effect: once mounted, trigger the enter animation. Keeping
  // this decoupled from the open/mount effect prevents React from batching
  // setMounted(true) + setEntered(true) into a single paint, which would
  // skip the off-screen frame and make the enter transition invisible.
  useEffect(() => {
    if (!mounted) return;
    // Always start off-screen — handles reopen after a quick close where
    // entered might still be true from a previous cycle.
    setEntered(false);
    const frame = requestAnimationFrame(() => {
      // Force the browser to commit the off-screen layout before we flip
      // to on-screen. Without this reflow, some mobile WebViews optimise
      // away the intermediate frame and the transition never fires.
      void document.body.offsetHeight;
      setEntered(true);
      zoomRef.current?.setProgress(1);
    });
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const releasePopupOpen = pushCanactPopupOpen();
    const unlockScroll = lockPageScroll();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      releasePopupOpen();
      unlockScroll();
      window.removeEventListener('keydown', onKey);
    };
  }, [mounted]);

  useEffect(() => {
    zoomRef.current?.release();
    zoomRef.current = null;
    const shell = document.getElementById('canact-app-content');
    if (!shell || !mounted) return;
    zoomRef.current = pushCanactSheetZoom(shell);
    return () => {
      zoomRef.current?.release();
      zoomRef.current = null;
    };
  }, [mounted]);

  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-canact-popup="true" className={`canact-popup-layer ${topmost ? 'canact-popup-layer-nested' : ''} fixed inset-0 flex items-end justify-center overflow-hidden overscroll-none`} role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`canact-popup-backdrop absolute inset-0 transition-opacity duration-[320ms] ease-out ${entered ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        ref={swipeRef}
        data-canact-sheet-panel="true"
        data-entered={entered}
        data-liquid-glass="surface"
        data-liquid-radius="32"
        data-liquid-blur="0"
        data-liquid-tint="250,248,242"
        data-liquid-tint-opacity="0.1"
        data-liquid-thickness="58"
        data-liquid-bezel="28"
        data-liquid-specular-opacity="0.48"
        style={{
          transition: 'transform 320ms cubic-bezier(.22,.85,.3,1), opacity 320ms cubic-bezier(.22,.85,.3,1)',
          maxHeight: 'var(--canact-popup-max-height)',
          paddingBottom: 'var(--canact-popup-bottom-inset)',
        }}
        className={`canact-liquid-sheet-panel relative flex w-[100vw] max-w-[100vw] transform-gpu flex-col overflow-hidden rounded-t-[32px] bg-transparent pt-3 will-change-transform overscroll-contain lg:w-full lg:max-w-md ${entered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-ink/10" />
        {title !== undefined && hideTitle && hideClose ? (
          <h2 className="sr-only">{title}</h2>
        ) : title !== undefined ? (
          <div className={`mb-3 flex shrink-0 items-center px-4 ${hideTitle ? 'justify-end' : 'justify-between'}`}>
            <h2 className={hideTitle ? 'sr-only' : 'text-xl font-black tracking-tight text-ink'}>{title}</h2>
            {!hideClose ? (
              <button type="button" onClick={onClose} aria-label="Close" data-liquid-glass="switcher" data-liquid-radius="999" data-liquid-blur="0" data-liquid-tint="31,107,85" data-liquid-tint-opacity="0.1" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-brand">
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-2 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
