'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HeartHandshake, Plus, Eye, X } from './icons';
import { useAuth } from '@/lib/auth';
import { useGeo } from '@/lib/useGeo';
import { useDistance } from '@/lib/distance';
import { listenHelpFeed } from '@/lib/services/help';
import { haversineMeters } from '@/lib/utils';

/**
 * Sticky floating help pull-tab pinned to the right edge of the viewport.
 * Expands into a full pill panel with View / Request buttons. Shows a live
 * count of nearby open help requests with a nudge animation and tooltip.
 */
export function StickyHelpPullTab() {
  const { user } = useAuth();
  const { coords } = useGeo();
  const { radius } = useDistance();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const tooltipTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [expanded, setExpanded] = useState(false);
  const [nearbyHelpCount, setNearbyHelpCount] = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [nudge, setNudge] = useState(false);
  const prevCountRef = useRef(0);
  const tooltipDismissedRef = useRef(false);

  // ── Live nearby help count ──
  useEffect(() => {
    if (!user) return;
    return listenHelpFeed((items) => {
      const nearby = items.filter((h) => {
        if (h.uid === user.uid) return false;
        if (h.status !== 'open') return false;
        if (h.lat == null || h.lng == null || !coords) return true; // show all if no location
        return haversineMeters(coords, { lat: h.lat, lng: h.lng }) <= (h.vicinityMeters ?? radius);
      });
      const count = nearby.length;
      setNearbyHelpCount(count);

      // Nudge when count increases
      if (count > prevCountRef.current) {
        setNudge(true);
        setTimeout(() => setNudge(false), 600);
        // Show tooltip on increase (if not recently dismissed)
        if (!tooltipDismissedRef.current) {
          setShowTooltip(true);
        }
      }
      prevCountRef.current = count;
    });
  }, [user, coords, radius]);

  // ── Periodic tooltip ──
  useEffect(() => {
    if (nearbyHelpCount === 0 || tooltipDismissedRef.current) {
      setShowTooltip(false);
      return;
    }
    tooltipTimer.current = setInterval(() => {
      if (!tooltipDismissedRef.current && nearbyHelpCount > 0) {
        setShowTooltip(true);
        setTimeout(() => setShowTooltip(false), 4000);
      }
    }, 30000); // every 30s
    return () => {
      if (tooltipTimer.current) clearInterval(tooltipTimer.current);
    };
  }, [nearbyHelpCount]);

  // ── Outside click to close ──
  useEffect(() => {
    if (!expanded) return;
    const onPointer = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    const id = setTimeout(() => document.addEventListener('pointerdown', onPointer), 100);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [expanded]);

  // Close on route change
  useEffect(() => { setExpanded(false); }, [pathname]);

  const toggle = useCallback(() => {
    setExpanded((v) => !v);
    // Dismiss tooltip when user interacts
    tooltipDismissedRef.current = true;
    setShowTooltip(false);
  }, []);

  // Hide on help pages themselves
  if (pathname?.startsWith('/help')) return null;

  const hasNewHelp = nearbyHelpCount > 0;

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-[47%] z-[70] h-[46px] lg:hidden"
      style={{ transform: 'translateY(-50%)' }}
    >
      {/* ── Tooltip (only when collapsed) ── */}
      {showTooltip && hasNewHelp && !expanded && (
        <div className="absolute bottom-full right-0 mb-2.5 w-52 rounded-2xl bg-white px-3.5 py-2.5 shadow-[0_8px_28px_rgba(180,70,30,.22)] border border-[#f5d5c0]">
          <div className="flex items-center gap-3">
            <strong className="text-[28px] font-extrabold leading-none text-[#b04820]">{nearbyHelpCount > 99 ? '99+' : nearbyHelpCount}</strong>
            <span className="text-[12px] font-bold text-[#b04820] leading-snug">{nearbyHelpCount === 1 ? 'person needs' : 'people need'} help near you!</span>
          </div>
          {/* Tooltip arrow */}
          <div className="absolute -bottom-1.5 right-5 h-3 w-3 rotate-45 border-b border-r border-[#f5d5c0] bg-white" />
        </div>
      )}

      {/* ── Expanded pill panel — slides in from right, covers tab ── */}
      <div
        className="absolute bottom-0 right-0 z-10 overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxWidth: expanded ? 'calc(100vw - 12px)' : '0px',
          opacity: expanded ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-2.5 rounded-l-full border border-r-0 border-[#e8c8b5] bg-white px-4 py-2 shadow-[0_2px_14px_rgba(180,80,40,.12),0_8px_24px_rgba(180,80,40,.06)] whitespace-nowrap">
          <Link
            href="/help"
            className="relative inline-flex items-center gap-1.5 rounded-full bg-[#fdf3ed] px-3.5 py-1.5 text-[12px] font-bold text-[#b85a2c] transition-colors hover:bg-[#fce8db] shrink-0"
          >
            <Eye size={15} strokeWidth={2.2} />
            View
            {nearbyHelpCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#e85d2c] border-2 border-[#fdf3ed] px-1 text-[9px] font-extrabold text-white shadow-[0_2px_6px_rgba(232,93,44,.4)]">
                {nearbyHelpCount > 99 ? '99+' : nearbyHelpCount}
              </span>
            )}
          </Link>
          <Link
            href="/help/create"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#e85d2c] px-3.5 py-1.5 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-[#d14a1a] shrink-0"
          >
            <Plus size={15} strokeWidth={2.2} />
            Request
          </Link>
          <button
            type="button"
            onClick={toggle}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#fdf3ed] hover:bg-[#fce8db] transition-colors shrink-0"
            aria-label="Close help menu"
          >
            <X size={15} strokeWidth={2.5} className="text-[#b85a2c]" />
          </button>
        </div>
      </div>

      {/* ── Collapsed pull tab — hidden when expanded ── */}
      {!expanded && (
        <button
          type="button"
          onClick={toggle}
          className={`relative flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-l-full border border-r-0 border-[#e8c8b5] bg-[#dc2626] shadow-[0_2px_14px_rgba(180,80,40,.12),0_8px_24px_rgba(180,80,40,.06)] ${nudge ? 'animate-[helpNudgeX_0.5s_ease-out]' : ''}`}
          aria-label={`Help — ${nearbyHelpCount} nearby`}
        >
          {hasNewHelp && (
            <span className="absolute -left-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-[#e85d2c] border-2 border-white px-1 text-[10px] font-extrabold text-white shadow-[0_2px_6px_rgba(232,93,44,.4)]">
              {nearbyHelpCount > 9 ? '9+' : nearbyHelpCount}
            </span>
          )}
          <HeartHandshake size={20} strokeWidth={2.3} className="text-white" />
        </button>
      )}
    </div>
  );
}
