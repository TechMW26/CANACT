'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockPageScroll } from '@/lib/scrollLock';
import { pushCanactPopupOpen, pushCanactSheetZoom } from '@/lib/popupGuards';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';
import { X } from './icons';

const ANIM_MS = 320;

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
  title,
  children,
  topmost,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number[]>([]);
  const closeTimerRef = useRef<number | null>(null);
  const releaseZoomRef = useRef<(() => void) | null>(null);
  const swipeDismissHandlers = useTopScrollSwipeDismiss({
    onClose,
    getScrollElement: () => scrollRef.current,
  });
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const clearAnimationTimers = () => {
      rafRef.current.forEach((rafId) => cancelAnimationFrame(rafId));
      rafRef.current = [];
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    };
    clearAnimationTimers();
    if (open) {
      setMounted(true);
      setEntered(false);
      // Double rAF so the initial off-screen styles paint before we flip
      // `entered` — guarantees the transition fires on first open.
      const raf1 = requestAnimationFrame(() => {
        const raf2 = requestAnimationFrame(() => {
          rafRef.current = [];
          setEntered(true);
        });
        rafRef.current.push(raf2);
      });
      rafRef.current.push(raf1);
      return clearAnimationTimers;
    }
    setEntered(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMounted(false);
    }, ANIM_MS);
    return clearAnimationTimers;
  }, [open]);

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
      releaseZoomRef.current?.();
      releaseZoomRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    releaseZoomRef.current?.();
    releaseZoomRef.current = null;
    const shell = document.getElementById('canact-app-content');
    if (!shell || !entered) return;
    releaseZoomRef.current = pushCanactSheetZoom(shell);
    return () => {
      releaseZoomRef.current?.();
      releaseZoomRef.current = null;
    };
  }, [entered]);

  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div data-canact-popup="true" className={`fixed inset-0 ${topmost ? 'z-[2147483000]' : 'z-[120]'} flex items-end justify-center overflow-hidden overscroll-none`} role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-transparent transition-opacity duration-300 ease-out ${entered ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        {...swipeDismissHandlers}
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
        {title !== undefined && (
          <div className="mb-3 flex shrink-0 items-center justify-between px-4">
            <h2 className="text-xl font-black tracking-tight text-ink">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" data-liquid-glass="switcher" data-liquid-radius="999" data-liquid-blur="0" data-liquid-tint="31,107,85" data-liquid-tint-opacity="0.1" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-transparent text-brand">
              <X size={16} />
            </button>
          </div>
        )}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-2 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
