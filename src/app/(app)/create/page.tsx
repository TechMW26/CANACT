'use client';
import Link from 'next/link';
import {
  BarChart3,
  Camera,
  ChevronRight,
  Eye,
  Film,
  LifeBuoy,
  Sparkles,
  EyeOff,
  CircleHelp,
  Megaphone,
} from '@/components/icons';
import type { LucideIcon } from 'lucide-react';

type Action = {
  href: string;
  title: string;
  desc: string;
  Icon: LucideIcon;
  accent: string;
  ring: string;
  badge?: string;
  iconColor?: string;
};

/** Top creation flows (rich cards). */
const PRIMARY: Action[] = [
  {
    href: '/story/create',
    title: 'Story',
    desc: 'Camera-first moment with text & filters. Disappears in 24h.',
    Icon: Sparkles,
    accent: 'from-[#FFE3E7] to-[#FFD8DD]',
    ring: 'ring-[#F7BFC7]',
    badge: '24h',
  },
  {
    href: '/post/create',
    title: "What's Happening",
    desc: 'Photos / carousel with caption. Auto-disappears in 24h.',
    Icon: Camera,
    accent: 'from-[#FFEDF0] to-[#FFD8DD]',
    ring: 'ring-[#F7BFC7]',
    badge: 'Vicinity',
  },
  {
    href: '/reel/create',
    title: 'Reel',
    desc: 'Short vertical clip with music & filters.',
    Icon: Film,
    accent: 'from-[#FFF1F3] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
    badge: 'Vertical',
  },
  {
    href: '/rateme/start',
    title: 'Rate Me',
    desc: 'Front-camera selfie. Goes live for hours.',
    Icon: Eye,
    accent: 'from-[#FFEDF0] to-[#FFD8DD]',
    ring: 'ring-[#F7BFC7]',
    badge: 'Selfie',
  },
];

/** Quick actions (compact tiles). */
const SECONDARY: Action[] = [
  {
    href: '/poll/create',
    title: 'Poll',
    desc: 'Read your area in seconds.',
    Icon: BarChart3,
    accent: 'from-[#FFF1F3] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
  },
  {
    href: '/poll/create?mode=ask',
    title: 'Ask',
    desc: 'Open-ended question to your circle.',
    Icon: CircleHelp,
    accent: 'from-[#FFF1F3] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
  },
  {
    href: '/poll/create?mode=suggest',
    title: 'Suggest',
    desc: 'Pitch an idea, gather reactions.',
    Icon: Megaphone,
    accent: 'from-[#FFF8F8] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
  },
  {
    href: '/help/create',
    title: 'Help',
    desc: 'Red / Orange / Yellow ping.',
    Icon: LifeBuoy,
    accent: 'from-[#FFF8F8] to-[#FFE3E7]',
    ring: 'ring-[#F1D7DC]',
  },
  {
    href: '/underground',
    title: 'Underground',
    desc: 'Go invisible for a while.',
    Icon: EyeOff,
    accent: 'from-[#1A1A1A] to-[#2A2A2A]',
    ring: 'ring-black/40',
    iconColor: 'text-white',
  },
];

export default function CreateHubPage() {
  return (
    <div className="mx-auto max-w-2xl pt-4">
      <header className="mb-5">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1.5 text-xs font-semibold text-brand ring-1 ring-[#F1D7DC]">
          <Sparkles size={14} /> Create
        </div>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-ink">What do you want to share?</h1>
        <p className="mt-1 text-sm text-ink/60">Pick a flow — we'll open the right camera and walk you through it.</p>
      </header>

      <div className="grid gap-3">
        {PRIMARY.map(({ href, title, desc, Icon, accent, ring, badge }) => (
          <Link
            key={href}
            href={href}
            className={`group relative overflow-hidden rounded-[28px] bg-gradient-to-br ${accent} p-5 ring-1 ${ring} transition active:scale-[0.99]`}
          >
            <div className="flex items-start gap-4">
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-brand">
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

      <div className="mt-6 mb-2 flex items-center gap-2">
        <div className="h-px flex-1 bg-line" />
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink/45">Quick actions</div>
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SECONDARY.map(({ href, title, desc, Icon, accent, ring, iconColor }) => {
          const dark = accent.includes('1A1A1A');
          return (
            <Link
              key={href + title}
              href={href}
              className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${accent} p-4 ring-1 ${ring} transition active:scale-[0.99]`}
            >
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${dark ? 'bg-white/10' : 'bg-white'} ${iconColor ?? 'text-brand'}`}>
                <Icon size={18} strokeWidth={2} />
              </span>
              <div className={`mt-3 text-sm font-extrabold tracking-tight ${dark ? 'text-white' : 'text-ink'}`}>{title}</div>
              <div className={`mt-0.5 text-[11px] leading-snug ${dark ? 'text-white/70' : 'text-ink/60'}`}>{desc}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
