'use client';
import Link from 'next/link';
import { Card } from '@/components/Card';
import { Camera, BarChart3, Eye, LifeBuoy } from '@/components/icons';

const ACTIONS = [
  { href: '/post/create',  title: "What's Happening", desc: 'Share a moment with photos. Auto-disappears in 24h.', Icon: Camera },
  { href: '/poll/create',  title: 'Poll / Ask / Suggest', desc: 'Get a quick read from your area or favourites.',     Icon: BarChart3 },
  { href: '/rateme/start', title: 'Rate Me',           desc: 'Let people rate your look right now.',                  Icon: Eye },
  { href: '/help/create',  title: 'Help',              desc: 'Red, Orange or Yellow — call your circle to action.',   Icon: LifeBuoy },
];

export default function CreateHubPage() {
  return (
    <div className="grid gap-3">
      {ACTIONS.map(({ href, title, desc, Icon }) => (
        <Link key={href} href={href}>
          <Card className="flex items-center gap-4 hover:bg-brand-light/30 transition">
            <div className="h-12 w-12 rounded-2xl bg-brand-light flex items-center justify-center text-brand">
              <Icon size={24} strokeWidth={2} />
            </div>
            <div>
              <div className="font-bold">{title}</div>
              <div className="text-sm text-muted">{desc}</div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
