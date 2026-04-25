'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Camera, ChevronRight, Eye, Film, LifeBuoy, Sparkles, X } from './icons';
import type { LucideIcon } from 'lucide-react';

type Item = {
  href: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
  accent: string;
};

const ITEMS: Item[] = [
  { href: '/story/create', title: 'Story',           desc: 'Camera-first, edit with text. 24h.',     Icon: Sparkles,  accent: 'from-[#FFE3E7] to-[#FFD8DD]' },
  { href: '/post/create',  title: "What's Happening", desc: 'Photos / carousel. Auto-disappears 24h.', Icon: Camera,    accent: 'from-[#FFEDF0] to-[#FFD8DD]' },
  { href: '/reel/create',  title: 'Reel',             desc: 'Short vertical clip. Coming soon.',      Icon: Film,      accent: 'from-[#FFF1F3] to-[#FFE3E7]' },
  { href: '/rateme/start', title: 'Rate Me',          desc: 'Front-camera selfie. Live for hours.',   Icon: Eye,       accent: 'from-[#FFEDF0] to-[#FFD8DD]' },
  { href: '/poll/create',  title: 'Poll · Ask',       desc: 'Quick read from your area.',             Icon: BarChart3, accent: 'from-[#FFF1F3] to-[#FFE3E7]' },
  { href: '/help/create',  title: 'Help',             desc: 'Red / Orange / Yellow ping.',            Icon: LifeBuoy,  accent: 'from-[#FFF8F8] to-[#FFE3E7]' },
];

const ANIM_MS = 320;

export function PlusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted controls actual DOM presence; entered drives the animation state.
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);

  // Open: mount immediately + flip entered on next frame so transition runs.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(id);
    }
    // Close: play exit, then unmount.
    setEntered(false);
    const t = setTimeout(() => setMounted(false), ANIM_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Body lock + Esc + app-shell zoom-out
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const shell = document.getElementById('canact-app-shell');
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      shell?.classList.remove('canact-sheet-zoom-out');
    };
  }, [mounted, onClose]);

  // Toggle the zoom class in sync with the sheet's animation state.
  useEffect(() => {
    const shell = document.getElementById('canact-app-shell');
    if (!shell) return;
    if (entered) shell.classList.add('canact-sheet-zoom-out');
    else shell.classList.remove('canact-sheet-zoom-out');
  }, [entered]);

  if (!mounted) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ease-out ${entered ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        className={`relative w-full max-w-md rounded-t-[32px] bg-white px-4 pb-8 pt-3 shadow-[0_-20px_60px_-20px_rgba(10,10,10,0.45)] safe-bottom transform transition-[transform,opacity] duration-[320ms] ease-[cubic-bezier(.22,.85,.3,1)] ${entered ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-ink/10" />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black tracking-tight text-ink">Create</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-brand-light/60 text-brand">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2.5">
          {ITEMS.map(({ href, title, desc, Icon, accent }) => (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`group flex items-center gap-3 rounded-2xl bg-gradient-to-br ${accent} p-3 ring-1 ring-[#F1D7DC]`}
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand shadow-[0_8px_18px_-12px_rgba(200,16,46,0.45)]">
                <Icon size={22} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold text-ink">{title}</div>
                <div className="truncate text-xs text-ink/60">{desc}</div>
              </div>
              <ChevronRight size={18} className="text-ink/35 group-hover:text-brand" />
            </Link>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

