'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Camera, Eye, Film, HeartHandshake, Sparkles } from './icons';

type RadialItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  className: string;
  angle: number; // degrees, 0 = right, 90 = up
};

const RADIUS = 150; // px — tight enough to stay fully on-screen on all devices
const TRAIN_ORIGIN = 135; // middle of the arc
// 6 items evenly spaced across 120° arc: 75° to 195° — verified on 390×844
const ITEMS: RadialItem[] = [
  { href: '/help/create',   label: 'Help',     Icon: HeartHandshake, className: 'canact-radial-item-help',  angle:  75 },
  { href: '/story/create',  label: 'Story',    Icon: Sparkles,       className: 'canact-radial-item-story', angle:  99 },
  { href: '/post/create',   label: 'Post',     Icon: Camera,         className: 'canact-radial-item-post',  angle: 123 },
  { href: '/reel/create',   label: 'Reel',     Icon: Film,           className: 'canact-radial-item-reel',  angle: 147 },
  { href: '/poll/create',   label: 'Poll',     Icon: BarChart3,      className: 'canact-radial-item-poll',  angle: 171 },
  { href: '/rateme/start',  label: 'Rate me',  Icon: Eye,            className: 'canact-radial-item-rate',  angle: 195 },
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
  const { w: vw, h: vh } = useViewportSize();

  // Compute halo center relative to viewport. Halo is now 300×300 (radius=150),
  // anchored at: right=max(-72, (vw-480)/2-72), bottom=-64+env(safe-area).
  const center = useMemo(() => {
    const rightOffset = Math.max(-72, (vw - 480) / 2 - 72);
    const cx = vw - (rightOffset + 150); // half of 300
    const cy = vh - 86; // -64 + 150 = 86px from viewport bottom
    return { cx, cy };
  }, [vw, vh]);

  // Precompute positions: closed = all at train origin, open = at target angles
  const trainPos = posFromAngle(center.cx, center.cy, TRAIN_ORIGIN, RADIUS);
  const itemPositions = useMemo(() => orderedItems.map((item) => ({
    ...item,
    final: posFromAngle(center.cx, center.cy, item.angle, RADIUS),
  })), [orderedItems, center]);

  useEffect(() => {
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
      <div className="canact-radial-halo" aria-hidden="true" />
      {itemPositions.map((item, index) => {
        const { href, label, Icon, className, final } = item;
        return (
          <Link
            key={href}
            href={href}
            role="menuitem"
            tabIndex={open ? 0 : -1}
            onClick={onClose}
            className={`canact-radial-item ${className}`}
            style={{
              left: open ? `${final.left}px` : `${trainPos.left}px`,
              top: open ? `${final.top}px` : `${trainPos.top}px`,
              transitionDelay: open ? `${index * 55}ms` : `${(itemPositions.length - 1 - index) * 40}ms`,
            }}
          >
            <span>
              <Icon size={22} strokeWidth={2.3} />
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
