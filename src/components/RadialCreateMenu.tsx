'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Bell, Camera, Eye, Film, Globe2, Grid3X3, Activity, HandHeart, MessageSquare, Search, ShieldAlert, Sparkles, Users } from './icons';
import { haptic } from '@/lib/haptics';

type RadialItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  className: string;
};

const ALL_RADIAL_ITEMS: Record<string, RadialItem> = {
  '/help':          { href: '/help',          label: 'Help',     Icon: HandHeart,      className: 'help' },
  '/mood':          { href: '/mood',          label: 'Mood',     Icon: Activity,       className: '' },
  '/story/create':  { href: '/story/create',  label: 'Story',    Icon: Sparkles,       className: '' },
  '/post/create':   { href: '/post/create',   label: 'Post',     Icon: Camera,         className: '' },
  '/reel/create':   { href: '/reel/create',   label: 'Reel',     Icon: Film,           className: '' },
  '/poll/create':   { href: '/poll/create',   label: 'Poll',     Icon: BarChart3,      className: '' },
  '/rateme/start':  { href: '/rateme/start',  label: 'Rate me',  Icon: Eye,            className: '' },
  '/feed':          { href: '/feed',          label: 'Feed',     Icon: Grid3X3,        className: '' },
  '/leaderboard':   { href: '/leaderboard',   label: 'Leaderboard', Icon: Activity,    className: '' },
  '/search':        { href: '/search',        label: 'Search',   Icon: Search,         className: '' },
  '/inbox':         { href: '/inbox',         label: 'Inbox',    Icon: MessageSquare,  className: '' },
  '/notifications': { href: '/notifications', label: 'Notifications', Icon: Bell,     className: '' },
  '/profile':       { href: '/profile',       label: 'Profile',  Icon: Users,          className: '' },
  '/settings':      { href: '/settings',      label: 'Settings', Icon: ShieldAlert,    className: '' },
  '/underground':   { href: '/underground',   label: 'Underground', Icon: Globe2,      className: '' },
};

const DEFAULT_PLUS_ITEMS = ['/help', '/mood', '/story/create', '/post/create', '/reel/create', '/poll/create', '/rateme/start'];
const ITEM_SIZE = 56;

export function RadialCreateMenu({ open, onClose, plusItems }: { open: boolean; onClose: () => void; plusItems?: string[] }) {
  const router = useRouter();
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(0);
  const rotationRef = useRef(0);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const dragRef = useRef<{ pointerId: number; lastAngle: number; ts: number; distance: number } | null>(null);
  const velocityRef = useRef(0);
  const inertiaActiveRef = useRef(false);
  const inertiaTimeRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const animRef = useRef(0);
  const hasDragged = useRef(false);

  const items = useMemo(() => {
    const configured = plusItems?.length ? plusItems : DEFAULT_PLUS_ITEMS;
    const hrefs = ['/help', '/mood', ...configured.filter((href) => href !== '/help' && href !== '/mood')];
    return hrefs.map((h) => ALL_RADIAL_ITEMS[h]).filter(Boolean);
  }, [plusItems]);

  // Radius large enough so adjacent items never overlap — with extra breathing room
  const radius = useMemo(() => {
    if (items.length < 2) return 180;
    const minR = ITEM_SIZE / (2 * Math.sin(Math.PI / items.length)) + 8;
    return Math.max(170, Math.ceil(minR * 1.8));
  }, [items.length]);

  const applyRotation = useCallback((rotation: number) => {
    rotationRef.current = rotation;
    const step = items.length ? 360 / items.length : 0;
    itemRefs.current.forEach((item, index) => {
      if (!item) return;
      const radians = ((rotation + index * step) * Math.PI) / 180;
      item.style.setProperty('--orbit-x', `${radius * Math.cos(radians)}px`);
      item.style.setProperty('--orbit-y', `${radius * Math.sin(radians)}px`);
    });
  }, [items.length, radius]);

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    return () => {
      document.body.style.overflow = prev;
      document.body.style.touchAction = '';
    };
  }, [open]);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setVisible(false);
    cancelAnimationFrame(animRef.current);
    inertiaActiveRef.current = false;
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, 450);
  }, [closing, onClose]);

  // Capture center + open sequence
  useLayoutEffect(() => {
    if (!open) {
      if (!closing) setVisible(false);
      cancelAnimationFrame(animRef.current);
      return;
    }
    setClosing(false);
    const btn = document.querySelector<HTMLElement>('.canact-create-nav-button');
    if (btn) {
      const r = btn.getBoundingClientRect();
      setCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [open, closing]);

  // Autoplay gentle rotation when not dragging
  useEffect(() => {
    if (!visible || !center) return;
    let frame: number;
    let previousTime = performance.now();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const autoRotate = (now: number) => {
      if (!dragRef.current && !inertiaActiveRef.current) {
        const elapsed = Math.min(50, now - previousTime);
        applyRotation(rotationRef.current + elapsed * 0.015);
      }
      previousTime = now;
      frame = requestAnimationFrame(autoRotate);
    };
    applyRotation(rotationRef.current);
    if (!reduceMotion) frame = requestAnimationFrame(autoRotate);
    return () => cancelAnimationFrame(frame);
  }, [applyRotation, visible, center]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);

  // Inertia animation
  const applyInertia = useCallback((now: number) => {
    const previous = inertiaTimeRef.current || now;
    const elapsed = Math.min(34, Math.max(1, now - previous));
    inertiaTimeRef.current = now;
    if (Math.abs(velocityRef.current) < 0.002) {
      velocityRef.current = 0;
      inertiaActiveRef.current = false;
      return;
    }
    applyRotation(rotationRef.current + velocityRef.current * elapsed);
    velocityRef.current *= Math.exp(-elapsed / 210);
    animRef.current = requestAnimationFrame(applyInertia);
  }, [applyRotation]);

  // Pointer handlers for rotation
  const onPointerDown = (e: React.PointerEvent) => {
    if (!center) return;
    cancelAnimationFrame(animRef.current);
    inertiaActiveRef.current = false;
    hasDragged.current = false;
    velocityRef.current = 0;
    const dx = e.clientX - center.x;
    const dy = e.clientY - center.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    dragRef.current = { pointerId: e.pointerId, lastAngle: angle, ts: performance.now(), distance: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !center) return;
    const dx = e.clientX - center.x;
    const dy = e.clientY - center.y;
    if (Math.hypot(dx, dy) < 28) return;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const delta = angle - dragRef.current.lastAngle;
    // Normalize delta for wraparound
    const normalized = delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
    if (Math.abs(normalized) > 42) return;
    dragRef.current.distance += Math.abs(normalized);
    if (dragRef.current.distance > 2.5) hasDragged.current = true;
    applyRotation(rotationRef.current + normalized);
    // Track velocity
    const now = performance.now();
    const dt = Math.max(4, now - dragRef.current.ts);
    const instantVelocity = Math.max(-0.75, Math.min(0.75, normalized / dt));
    velocityRef.current = velocityRef.current * .68 + instantVelocity * .32;
    dragRef.current.lastAngle = angle;
    dragRef.current.ts = now;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (drag && e.currentTarget.hasPointerCapture(drag.pointerId)) e.currentTarget.releasePointerCapture(drag.pointerId);
    dragRef.current = null;
    if (hasDragged.current) suppressClickUntilRef.current = performance.now() + 240;
    if (Math.abs(velocityRef.current) > 0.015) {
      inertiaActiveRef.current = true;
      inertiaTimeRef.current = 0;
      animRef.current = requestAnimationFrame(applyInertia);
    }
  };

  if (!open && !closing) return null;

  const itemBase: React.CSSProperties = {
    position: 'fixed',
    zIndex: 56,
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '50%',
    border: '1px solid rgb(255 255 255 / 82%)',
    background: '#fff',
    boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 68%), 0 4px 16px rgb(0 0 0 / .14)',
    transition: 'opacity 0.22s ease',
    willChange: 'transform, opacity',
    pointerEvents: 'none',
    touchAction: 'none',
  };

  return (
    <>
      {/* Opaque lower surface fading cleanly into the page. */}
      <div
        className="fixed inset-0 transition-opacity duration-300"
        style={{
          zIndex: 54,
          opacity: visible ? 1 : 0,
          touchAction: 'none',
          background: 'linear-gradient(180deg, rgb(255 255 255 / 0) 0%, rgb(255 255 255 / .58) 42%, #fff 76%, #fff 100%)',
        }}
        onClick={(e) => {
          if (performance.now() < suppressClickUntilRef.current || hasDragged.current) {
            hasDragged.current = false;
            return;
          }
          if (!center) { handleClose(); return; }
          const cx = e.clientX - center.x;
          const cy = e.clientY - center.y;
          const dist = Math.sqrt(cx * cx + cy * cy);
          if (dist < radius - ITEM_SIZE || dist > radius + ITEM_SIZE) { handleClose(); return; }
          const clickAngle = ((Math.atan2(cy, cx) * 180 / Math.PI) + 360) % 360;
          const step = items.length > 0 ? 360 / items.length : 0;
          let bestIdx = 0; let bestDiff = Infinity;
          items.forEach((_, i) => {
            const itemAngle = ((rotationRef.current + i * step) % 360 + 360) % 360;
            let diff = Math.abs(clickAngle - itemAngle);
            if (diff > 180) diff = 360 - diff;
            if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
          });
          if (bestDiff < step / 2) {
            haptic('subtle');
            const item = items[bestIdx];
            if (item) router.push(item.href);
          }
          handleClose();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-hidden="true"
      />
      {/* Diameter guide ring (subtle) */}
      {center && visible && (
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', zIndex: 54, pointerEvents: 'none',
            left: center.x - radius, top: center.y - radius,
            width: radius * 2, height: radius * 2,
            borderRadius: '50%',
            border: '1px solid rgb(255 255 255 / .14)',
            opacity: visible ? 1 : 0, transition: 'opacity 0.4s ease',
          }}
        />
      )}
      {/* Items */}
      {items.map((item, i) => {
        const step = items.length ? 360 / items.length : 0;
        const radians = ((rotationRef.current + i * step) * Math.PI) / 180;
        const isHelp = item.className === 'help';
        return (
          <Link
            ref={(element) => { itemRefs.current[i] = element; }}
            key={item.href}
            href={item.href}
            role="menuitem"
            aria-label={item.label}
            onClick={(e) => {
              // Only navigate if not dragged
              if (hasDragged.current) {
                e.preventDefault();
                return;
              }
              haptic('subtle'); handleClose();
            }}
            style={{
              ...itemBase,
              left: center ? center.x - ITEM_SIZE / 2 : 0,
              top: center ? center.y - ITEM_SIZE / 2 : 0,
              '--orbit-x': `${radius * Math.cos(radians)}px`,
              '--orbit-y': `${radius * Math.sin(radians)}px`,
              opacity: visible ? 1 : 0,
              transform: `translate3d(var(--orbit-x), var(--orbit-y), 0) scale(${visible ? 1 : .5})`,
              borderColor: isHelp ? 'rgb(255 200 195 / 88%)' : undefined,
              background: isHelp ? 'rgb(204 59 53 / 68%)' : undefined,
              transitionDelay: visible ? `${i * 25}ms` : `${(items.length - 1 - i) * 25}ms`,
            } as React.CSSProperties}
          >
            <span style={{ position: 'relative', zIndex: 3, display: 'grid', width: '100%', height: '100%', placeItems: 'center', color: isHelp ? '#fff' : '#1f6b55' }}>
              <item.Icon size={22} strokeWidth={2.2} />
            </span>
            <span style={{ position: 'absolute', left: '50%', bottom: -20, transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 800, color: '#111', pointerEvents: 'none' }}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </>
  );
}
