'use client';
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { lockPageScroll } from '@/lib/scrollLock';
import { useTopScrollSwipeDismiss } from '@/lib/useTopScrollSwipeDismiss';

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const swipe = useTopScrollSwipeDismiss({ onClose, enabled: open, getScrollElement: () => scrollRef.current });
  useEffect(() => {
    if (!open) return;
    return lockPageScroll();
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div data-canact-popup="true" className="canact-popup-backdrop canact-popup-layer fixed inset-0 flex items-end justify-center overflow-hidden overscroll-none p-0 lg:items-center lg:p-4" onClick={onClose}>
      <div ref={swipe.ref as React.RefObject<HTMLDivElement | null>} className="max-h-[90svh] w-[100vw] max-w-[100vw] overflow-hidden overscroll-contain rounded-t-2xl border border-line bg-white will-change-transform lg:w-full lg:max-w-md lg:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {title && <div className="px-5 py-4 border-b border-line text-lg font-bold">{title}</div>}
        <div ref={scrollRef} className="max-h-[calc(90svh-8rem)] overflow-y-auto overscroll-contain p-5 [-webkit-overflow-scrolling:touch]">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmLabel?: string; danger?: boolean; }) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={(
        <>
          <button className="rounded-full px-4 h-10 border border-line bg-white text-ink" onClick={onClose}>Cancel</button>
          <button className={`rounded-full px-4 h-10 text-white ${danger ? 'bg-brand-dark' : 'bg-brand'}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </>
      )}
    >
      <p className="text-muted">{message}</p>
    </Modal>
  );
}
