'use client';
import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Trash2, Flag } from './icons';
import { toast } from './Toaster';

/** Floating overflow menu for a feed item.
 *  - Owner sees "Delete" (destructive, with confirm)
 *  - Non-owners see "Report"
 *  - Trigger is a 32px circular ⋮ button positioned absolutely by the parent
 *  Tap outside or scroll to dismiss.
 */
export function PostMenu({
  isOwner,
  onDelete,
  onReport,
  variant = 'light',
  className = '',
}: {
  isOwner: boolean;
  onDelete?: () => Promise<void> | void;
  onReport?: () => Promise<void> | void;
  variant?: 'light' | 'dark';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onScroll = () => setOpen(false);
    setTimeout(() => document.addEventListener('click', close), 0);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  const trigger = variant === 'dark'
    ? 'bg-black/45 text-white ring-1 ring-white/15 backdrop-blur'
    : 'bg-white/85 text-ink/70 ring-1 ring-line backdrop-blur';

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label="More"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${trigger} active:scale-95 transition`}
      >
        <MoreVertical size={18} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-2xl border border-line bg-white shadow-[0_18px_44px_-18px_rgba(10,10,10,0.35)]"
          onClick={(e) => e.stopPropagation()}
        >
          {isOwner && onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirm('Delete this? This cannot be undone.')) return;
                try {
                  setBusy(true);
                  await onDelete();
                  toast('Deleted', 'success');
                  setOpen(false);
                } catch (e: any) {
                  toast(e?.message ?? 'Could not delete', 'error');
                } finally { setBusy(false); }
              }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 size={16} /> Delete
            </button>
          )}
          {!isOwner && onReport && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                try {
                  setBusy(true);
                  await onReport();
                  toast('Reported', 'success');
                  setOpen(false);
                } catch (e: any) {
                  toast(e?.message ?? 'Could not report', 'error');
                } finally { setBusy(false); }
              }}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-brand-light/40 disabled:opacity-60"
            >
              <Flag size={16} /> Report
            </button>
          )}
          {!isOwner && !onReport && (
            <div className="px-4 py-3 text-xs text-muted">No actions</div>
          )}
        </div>
      )}
    </div>
  );
}
