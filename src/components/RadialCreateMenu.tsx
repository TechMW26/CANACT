'use client';

import Link from 'next/link';
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

const DEFAULT_PLUS_ITEMS = ['/help', '/story/create', '/post/create', '/reel/create', '/poll/create', '/rateme/start'];
const ITEM_SIZE = 56;

export function RadialCreateMenu({ open, onClose, plusItems }: { open: boolean; onClose: () => void; plusItems?: string[] }) {
  const [center, setCenter] = useState<{ x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ startAngle: number; startRotation: number; lastAngle: number; ts: number } | null>(null);
  const velocityRef = useRef(0);
  const animRef = useRef(0);

  const items = useMemo(() => {
    const hrefs = plusItems?.length ? plusItems : DEFAULT_PLUS_ITEMS;
    return hrefs.map((h) => ALL_RADIAL_ITEMS[h]).filter(Boolean);
  }, [plusItems]);

  // Radius large enough so adjacent items never overlap — with extra breathing room
  const radius = useMemo(() => {
    if (items.length < 2) return 180;
    const minR = ITEM_SIZE / (2 * Math.sin(Math.PI / items.length)) + 8;
    return Math.max(170, Math.ceil(minR * 1.4));
  }, [items.length]);

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

  // Capture center + start autoplay
  useLayoutEffect(() => {
    if (!open) { setVisible(false); cancelAnimationFrame(animRef.current); return; }
    const btn = document.querySelector<HTMLElement>('.canact-create-nav-button');
    if (btn) {
      const r = btn.getBoundingClientRect();
      setCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    const t = setTimeout(() => setVisible(true), 20);
    return () => clearTimeout(t);
  }, [open]);

  // Autoplay gentle rotation when not dragging
  const hasDragged = useRef(false);
  useEffect(() => {
    if (!visible || !center) return;
    let frame: number;
    const autoRotate = () => {
      if (!dragRef.current && !hasDragged.current) {
        setRotation((r) => r + 0.25);
      }
      frame = requestAnimationFrame(autoRotate);
    };
    frame = requestAnimationFrame(autoRotate);
    return () => cancelAnimationFrame(frame);
  }, [visible, center]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, onClose]);

  // Inertia animation
  const applyInertia = useCallback(() => {
    if (Math.abs(velocityRef.current) < 0.3) { velocityRef.current = 0; return; }
    setRotation((r) => r + velocityRef.current);
    velocityRef.current *= 0.94;
    animRef.current = requestAnimationFrame(applyInertia);
  }, []);

  // Pointer handlers for rotation
  const onPointerDown = (e: React.PointerEvent) => {
    if (!center) return;
    cancelAnimationFrame(animRef.current);
    hasDragged.current = false;
    velocityRef.current = 0;
    const dx = e.clientX - center.x;
    const dy = e.clientY - center.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    dragRef.current = { startAngle: angle, startRotation: rotation, lastAngle: angle, ts: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !center) return;
    hasDragged.current = true;
    const dx = e.clientX - center.x;
    const dy = e.clientY - center.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const delta = angle - dragRef.current.lastAngle;
    // Normalize delta for wraparound
    const normalized = delta > 180 ? delta - 360 : delta < -180 ? delta + 360 : delta;
    setRotation(dragRef.current.startRotation + (angle - dragRef.current.startAngle));
    // Track velocity
    const now = performance.now();
    const dt = Math.max(16, now - dragRef.current.ts);
    velocityRef.current = normalized / dt * 16;
    dragRef.current.lastAngle = angle;
    dragRef.current.ts = now;
  };

  const onPointerUp = () => {
    dragRef.current = null;
    if (Math.abs(velocityRef.current) > 0.3) {
      animRef.current = requestAnimationFrame(applyInertia);
    }
  };

  // Calculate positions
  const positions = useMemo(() => {
    if (!center) return [];
    const step = items.length > 0 ? 360 / items.length : 0;
    return items.map((_, i) => {
      const angleDeg = rotation + i * step;
      const rad = (angleDeg * Math.PI) / 180;
      return {
        x: center.x + radius * Math.cos(rad) - ITEM_SIZE / 2,
        y: center.y + radius * Math.sin(rad) - ITEM_SIZE / 2,
      };
    });
  }, [center, rotation, radius, items.length]);

  if (!open && !visible) return null;

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
    backdropFilter: 'blur(14px) saturate(1.2)',
    WebkitBackdropFilter: 'blur(14px) saturate(1.2)',
    boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 68%), 0 4px 16px rgb(0 0 0 / .14)',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    pointerEvents: visible ? 'auto' : 'none',
  };

  return (
    <>
      {/* Backdrop with radial spreading blur */}
      <div
        className="fixed inset-0 transition-opacity duration-300"
        style={{
          zIndex: 54,
          opacity: visible ? 1 : 0,
          touchAction: 'none',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          ...(center ? {
            WebkitMaskImage: `radial-gradient(circle at ${center.x}px ${center.y}px, #000 0%, #000 18%, rgb(0 0 0 / .65) 42%, transparent 78%)`,
            maskImage: `radial-gradient(circle at ${center.x}px ${center.y}px, #000 0%, #000 18%, rgb(0 0 0 / .65) 42%, transparent 78%)`,
          } : {}),
          background: 'rgb(18 40 33 / 0%)',
        }}
        onClick={onClose}
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
        const pos = positions[i];
        const isHelp = item.className === 'help';
        return (
          <Link
            key={item.href}
            href={item.href}
            role="menuitem"
            aria-label={item.label}
            onClick={(e) => {
              // Only navigate if not dragged
              if (dragRef.current && Math.abs(rotation - (dragRef.current?.startRotation ?? 0)) > 2) {
                e.preventDefault();
                return;
              }
              haptic('subtle'); onClose();
            }}
            style={{
              ...itemBase,
              left: pos ? pos.x : 0,
              top: pos ? pos.y : 0,
              opacity: visible ? 1 : 0,
              transform: visible ? 'scale(1)' : 'scale(0.5)',
              borderColor: isHelp ? 'rgb(255 200 195 / 88%)' : undefined,
              background: isHelp ? 'rgb(204 59 53 / 68%)' : undefined,
              transitionDelay: `${i * 25}ms`,
            }}
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
