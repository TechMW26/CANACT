'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
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
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
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
    <div className="fixed inset-0 z-[120] flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/55 backdrop-blur-sm transition-opacity duration-300 ease-out ${entered ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        style={{ transition: 'transform 320ms cubic-bezier(.22,.85,.3,1), opacity 320ms cubic-bezier(.22,.85,.3,1)' }}
        className={`relative w-full max-w-md rounded-t-[32px] bg-white px-4 pb-8 pt-3 shadow-[0_-20px_60px_-20px_rgba(10,10,10,0.45)] safe-bottom transform ${entered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-ink/10" />
        {title !== undefined && (
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-black tracking-tight text-ink">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light/60 text-brand">
              <X size={16} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
