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
    ? 'bg-white text-ink ring-1 ring-line'
    : 'bg-white text-ink/70 ring-1 ring-line';

  const runDelete = async () => {
    if (busy || !onDelete || !confirm('Delete this? This cannot be undone.')) return;
    setBusy(true);
    try {
      await onDelete();
      toast('Deleted', 'success');
      setOpen(false);
    } catch (error: any) {
      toast(error?.message ?? 'Could not delete', 'error');
    } finally {
      setBusy(false);
    }
  };

  const runReport = async () => {
    if (busy || !onReport) return;
    setBusy(true);
    try {
      await onReport();
      toast('Reported', 'success');
      setOpen(false);
    } catch (error: any) {
      toast(error?.message ?? 'Could not report', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div
        role="button"
        tabIndex={0}
        aria-label="More"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); } }}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${trigger} active:scale-95 transition cursor-pointer`}
      >
        <MoreVertical size={18} />
      </div>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-2xl border border-line bg-white"
          onClick={(e) => e.stopPropagation()}
        >
          {isOwner && onDelete && (
            <div
              role="button"
              tabIndex={0}
              aria-disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void runDelete();
              }}}
              onClick={() => void runDelete()}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
            >
              <Trash2 size={16} /> Delete
            </div>
          )}
          {!isOwner && onReport && (
            <div
              role="button"
              tabIndex={0}
              aria-disabled={busy}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void runReport();
              }}}
              onClick={() => void runReport()}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-ink hover:bg-brand-light/40 cursor-pointer"
            >
              <Flag size={16} /> Report
            </div>
          )}
          {!isOwner && !onReport && (
            <div className="px-4 py-3 text-xs text-muted">No actions</div>
          )}
        </div>
      )}
    </div>
  );
}
