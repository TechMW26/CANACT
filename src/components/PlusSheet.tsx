'use client';
import Link from 'next/link';
import { BarChart3, Camera, ChevronRight, Eye, Film, HeartHandshake, Sparkles } from './icons';
import { Sheet } from './Sheet';
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
  { href: '/help/create',  title: 'Help',             desc: 'Red / Orange / Yellow ping.',            Icon: HeartHandshake,  accent: 'from-[#FFF8F8] to-[#FFE3E7]' },
];

export function PlusSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Create">
      <div className="grid grid-cols-1 gap-2.5">
        {ITEMS.map(({ href, title, desc, Icon, accent }) => (
          <Link
            key={href}
            href={href}
            onClick={onClose}
            className={`group flex items-center gap-3 rounded-2xl bg-gradient-to-br ${accent} p-3 ring-1 ring-[#F1D7DC]`}
          >
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-brand">
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
    </Sheet>
  );
}

