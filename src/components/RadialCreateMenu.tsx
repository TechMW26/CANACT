'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Camera, Eye, Film, HandHeart, Sparkles } from './icons';
import { haptic } from '@/lib/haptics';

type RadialItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  className: string;
};

const ITEMS: RadialItem[] = [
  { href: '/help/create',   label: 'Help',     Icon: HandHeart,      className: 'canact-radial-item-help' },
  { href: '/story/create',  label: 'Story',    Icon: Sparkles,       className: '' },
  { href: '/post/create',   label: 'Post',     Icon: Camera,         className: '' },
  { href: '/reel/create',   label: 'Reel',     Icon: Film,           className: '' },
  { href: '/poll/create',   label: 'Poll',     Icon: BarChart3,      className: '' },
  { href: '/rateme/start',  label: 'Rate me',  Icon: Eye,            className: '' },
];

const RADIUS = 210;
const ITEM_SIZE = 52;
// A true upper-left quarter fan. Keeping every angle inside 180°–270° avoids
// viewport clamping that previously collapsed the outer actions together.
const ANGLES = [185, 202, 219, 236, 253, 270];

export function RadialCreateMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const triggerCenter = useTriggerCenter(open);

  // Compute arc positions from trigger center, clamped to viewport
  const arcPositions = useMemo(() => {
    if (!triggerCenter) return [];
    const { cx, cy } = triggerCenter;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = ITEM_SIZE / 2 + 4;
    const minRight = margin;
    const maxRight = vw - ITEM_SIZE - margin;
    const minBottom = margin;
    const maxBottom = vh - ITEM_SIZE - margin;

    return ANGLES.map((angle) => {
      const rad = (angle * Math.PI) / 180;
      const triggerRight = Math.round(vw - cx - ITEM_SIZE / 2);
      const triggerBottom = Math.round(vh - cy - ITEM_SIZE / 2);
      const rawRight = Math.round(triggerRight - RADIUS * Math.cos(rad));
      const rawBottom = Math.round(triggerBottom - RADIUS * Math.sin(rad));
      const arcRight = Math.max(minRight, Math.min(maxRight, rawRight));
      const arcBottom = Math.max(minBottom, Math.min(maxBottom, rawBottom));
      return { triggerRight, triggerBottom, arcRight, arcBottom };
    });
  }, [triggerCenter]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <div
      id="canact-radial-create-menu"
      className={`canact-radial-menu lg:hidden ${open ? 'canact-radial-menu-open' : ''}`}
      aria-hidden={!open}
    >
      <button
        type="button"
        className="canact-radial-dismiss"
        onClick={onClose}
        aria-label="Close create menu"
        tabIndex={open ? 0 : -1}
      />
      {ITEMS.map((item, index) => {
        const { href, label, Icon, className } = item;
        const pos = arcPositions[index];
        return (
          <Link
            key={href}
            href={href}
            role="menuitem"
            aria-label={label}
            data-liquid-glass="surface"
            data-liquid-radius="999"
            data-liquid-blur="0"
            data-liquid-tint={label === 'Help' ? '204,59,53' : '250,248,242'}
            data-liquid-tint-opacity={label === 'Help' ? '0.22' : '0.08'}
            tabIndex={open ? 0 : -1}
            onClick={() => { haptic('subtle'); onClose(); }}
            className={`canact-radial-item ${className}`}
            style={
              pos
                ? {
                    '--trigger-right': `${pos.triggerRight}px`,
                    '--trigger-bottom': `${pos.triggerBottom}px`,
                    '--arc-right': `${pos.arcRight}px`,
                    '--arc-bottom': `${pos.arcBottom}px`,
                  } as React.CSSProperties
                : undefined
            }
          >
            <span aria-hidden="true">
              <Icon className="canact-adaptive-icon" size={22} strokeWidth={2.3} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Track the create button so the fan stays aligned after rotation/resizing. */
function useTriggerCenter(open: boolean) {
  const [center, setCenter] = useState<{ cx: number; cy: number } | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const button = document.querySelector<HTMLElement>('.canact-create-nav-button');
      const rect = button?.getBoundingClientRect();
      if (rect?.width && rect.height) setCenter({ cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [open]);

  return center;
}
