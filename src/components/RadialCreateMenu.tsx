'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Camera, Eye, Film, HandHeart, Sparkles } from './icons';

type RadialItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  className: string;
};

const RADIUS = 170;
const ARC_SLOTS = [85, 104, 123, 142, 161, 180];
const ITEMS: RadialItem[] = [
  { href: '/help/create',   label: 'Help',     Icon: HandHeart,      className: 'canact-radial-item-help' },
  { href: '/story/create',  label: 'Story',    Icon: Sparkles,       className: 'canact-radial-item-story' },
  { href: '/post/create',   label: 'Post',     Icon: Camera,         className: 'canact-radial-item-post' },
  { href: '/reel/create',   label: 'Reel',     Icon: Film,           className: 'canact-radial-item-reel' },
  { href: '/poll/create',   label: 'Poll',     Icon: BarChart3,      className: 'canact-radial-item-poll' },
  { href: '/rateme/start',  label: 'Rate me',  Icon: Eye,            className: 'canact-radial-item-rate' },
];

function posFromAngle(cx: number, cy: number, angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return {
    left: Math.round(cx + radius * Math.cos(rad)),
    top: Math.round(cy - radius * Math.sin(rad)),
  };
}

function useViewportSize() {
  const [size, setSize] = useState({ w: 390, h: 844 });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return size;
}

export function RadialCreateMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [orderedItems, setOrderedItems] = useState(ITEMS);
  const [anchorCenter, setAnchorCenter] = useState<{ cx: number; cy: number } | null>(null);
  const { w: vw, h: vh } = useViewportSize();

  useEffect(() => {
    const button = document.querySelector<HTMLElement>('.canact-create-nav-button');
    const rect = button?.getBoundingClientRect();
    if (rect?.width && rect.height) setAnchorCenter({ cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
  }, [vw, vh, open]);

  const center = useMemo(() => {
    if (anchorCenter) return anchorCenter;
    const gutter = Math.max(20, (vw - 480) / 2 + 20);
    const cx = vw - gutter - 36;
    const cy = vh - 48;
    return { cx, cy };
  }, [anchorCenter, vw, vh]);

  const itemPositions = useMemo(() => orderedItems.map((item, index) => ({
    ...item,
    final: posFromAngle(center.cx, center.cy, ARC_SLOTS[index], RADIUS),
  })), [orderedItems, center]);

  useLayoutEffect(() => {
    if (open) setOrderedItems((current) => shuffleItems(ITEMS, current));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <div id="canact-radial-create-menu" className={`canact-radial-menu lg:hidden ${open ? 'canact-radial-menu-open' : ''}`} aria-hidden={!open}>
      <button type="button" className="canact-radial-dismiss" onClick={onClose} aria-label="Close create menu" tabIndex={open ? 0 : -1} />
      {itemPositions.map((item, index) => {
        const { href, label, Icon, className, final } = item;
        return (
          <Link
            key={href}
            href={href}
            role="menuitem"
            aria-label={label}
            tabIndex={open ? 0 : -1}
            onClick={onClose}
            className={`canact-radial-item ${className}`}
            style={{
              left: open ? `${final.left}px` : `${center.cx}px`,
              top: open ? `${final.top}px` : `${center.cy}px`,
              transitionDelay: open ? `${index * 42}ms` : `${(itemPositions.length - 1 - index) * 28}ms`,
            }}
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

function shuffleItems(items: RadialItem[], previous: RadialItem[]) {
  const previousOrder = previous.map((item) => item.href).join('|');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
    }
    if (next.map((item) => item.href).join('|') !== previousOrder) return next;
  }
  return [...previous.slice(1), previous[0]];
}
