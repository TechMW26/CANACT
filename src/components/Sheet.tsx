'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockPageScroll } from '@/lib/scrollLock';
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
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Double rAF so the initial off-screen styles paint before we flip
      // `entered` — guarantees the transition fires on first open.
      let raf2 = 0;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setEntered(true));
      });
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), ANIM_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    const unlockScroll = lockPageScroll();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      unlockScroll();
      window.removeEventListener('keydown', onKey);
      const shell = document.getElementById('canact-app-content');
      shell?.classList.remove('canact-sheet-zoom-out');
    };
  }, [mounted]);

  useEffect(() => {
    const shell = document.getElementById('canact-app-content');
    if (!shell) return;
    if (entered) shell.classList.add('canact-sheet-zoom-out');
    else shell.classList.remove('canact-sheet-zoom-out');
  }, [entered]);

  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={`fixed inset-0 ${topmost ? 'z-[2147483000]' : 'z-[120]'} flex items-end justify-center overflow-hidden overscroll-none`} role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ease-out ${entered ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        style={{ transition: 'transform 320ms cubic-bezier(.22,.85,.3,1), opacity 320ms cubic-bezier(.22,.85,.3,1)' }}
        className={`relative flex max-h-[calc(100svh-12px)] w-[100vw] max-w-[100vw] flex-col overflow-hidden rounded-t-[32px] bg-white px-4 pt-3 safe-bottom transform overscroll-contain lg:w-full lg:max-w-md ${entered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 shrink-0 rounded-full bg-ink/10" />
        {title !== undefined && (
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <h2 className="text-xl font-black tracking-tight text-ink">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light/60 text-brand">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8 pr-1 [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
