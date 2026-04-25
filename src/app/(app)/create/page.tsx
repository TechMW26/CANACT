'use client';
import Link from 'next/link';
import { BarChart3, Camera, ChevronRight, Eye, LifeBuoy, Sparkles } from '@/components/icons';
import type { LucideIcon } from 'lucide-react';

type Action = {
  href: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
  accent: string;
  ring: string;
  badge?: string;
};

const ACTIONS: Action[] = [
  {
    href: '/post/create',
    title: "What's Happening",
    desc: 'Snap a moment with your back camera. Auto-disappears in 24h.',
    Icon: Camera,
    accent: 'from-[#FFE3E7] to-[#FFD8DD]',
    ring: 'ring-[#F7BFC7]',
    badge: 'Camera first',
  },
  {
    href: '/rateme/start',
    title: 'Rate Me',
    desc: 'Front camera selfie, switch or upload. Live for hours, not forever.',
    Icon: Eye,
    accent: 'from-[#FFEDF0] to-[#FFD8DD]',
    ring: 'ring-[#F7BFC7]',
    badge: 'Selfie',
  },
  {
    href: '/poll/create',
    title: 'Poll · Ask · Suggest',
    desc: 'Get a quick read from your area or favourites.',
    Icon: BarChart3,
    accent: 'from-[#FFF1F3] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
  },
  {
    href: '/help/create',
    title: 'Help',
    desc: 'Red, Orange or Yellow — call your circle to action.',
    Icon: LifeBuoy,
    accent: 'from-[#FFF8F8] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
  },
];

export default function CreateHubPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-5">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-[#F1D7DC] shadow-[0_10px_24px_-18px_rgba(10,10,10,0.28)]">
          <Sparkles size={14} /> Create
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-ink">What do you want to share?</h1>
        <p className="mt-1 text-sm text-ink/60">Pick a flow — we'll open the right camera and walk you through it.</p>
      </header>

      <div className="grid gap-3">
        {ACTIONS.map(({ href, title, desc, Icon, accent, ring, badge }) => (
          <Link
            key={href}
            href={href}
            className={`group relative overflow-hidden rounded-[28px] bg-gradient-to-br ${accent} p-5 ring-1 ${ring} shadow-[0_18px_36px_-26px_rgba(10,10,10,0.22)] transition active:scale-[0.99]`}
          >
            <div className="flex items-start gap-4">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand shadow-[0_10px_24px_-14px_rgba(200,16,46,0.45)]">
                <Icon size={26} strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="text-lg font-extrabold tracking-tight text-ink">{title}</div>
                  {badge ? (
                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand ring-1 ring-white">
                      {badge}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm text-ink/65">{desc}</div>
              </div>
              <ChevronRight size={20} className="mt-1 shrink-0 text-ink/35 transition group-hover:translate-x-0.5 group-hover:text-brand" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
