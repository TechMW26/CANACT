'use client';
import React, { useEffect, useRef, useState } from 'react';

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 p-0 lg:items-center lg:p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-[100vw] max-w-[100vw] overflow-auto rounded-t-2xl border border-line bg-surface lg:w-full lg:max-w-md lg:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        {title && <div className="px-5 py-4 border-b border-line text-lg font-bold">{title}</div>}
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>
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
