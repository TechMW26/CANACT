'use client';

import { usePathname } from 'next/navigation';

export default function InboxLoading() {
  const pathname = usePathname();
  const threadScreen = /^\/inbox\/[^/]+/.test(pathname ?? '');

  if (threadScreen) {
    return (
      <div className="flex h-[100dvh] flex-col bg-candy" aria-label="Loading conversation" aria-busy="true">
        <div className="safe-top mx-3 mt-3 flex h-[58px] items-center gap-3 rounded-full bg-white px-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-brand-light/70" />
          <div className="h-10 w-10 animate-pulse rounded-full bg-brand-light/70" />
          <div className="space-y-2">
            <div className="h-3 w-28 animate-pulse rounded-full bg-brand-light/80" />
            <div className="h-2 w-16 animate-pulse rounded-full bg-candy" />
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-end gap-3 px-3 pb-3">
          <div className="h-10 w-[58%] animate-pulse rounded-[18px] bg-white/75" />
          <div className="h-16 w-[72%] animate-pulse self-end rounded-[18px] bg-brand-light/70" />
          <div className="h-11 w-[46%] animate-pulse rounded-[18px] bg-white/75" />
          <div className="h-12 w-[64%] animate-pulse self-end rounded-[18px] bg-brand-light/70" />
        </div>
        <div className="safe-bottom mx-3 mb-3 h-12 animate-pulse rounded-full bg-white" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl pb-8 pt-4" aria-label="Loading inbox" aria-busy="true">
      <div className="mb-3 flex h-10 items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-full bg-white" />
        <div className="space-y-2">
          <div className="h-4 w-24 animate-pulse rounded-full bg-brand-light/80" />
          <div className="h-2.5 w-40 animate-pulse rounded-full bg-candy" />
        </div>
      </div>
      <div className="mb-3 h-9 w-44 animate-pulse rounded-full bg-white" />
      <div className="space-y-1 rounded-[28px] bg-white/92 p-2 ring-1 ring-line">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex h-[68px] items-center gap-3 rounded-2xl px-3">
            <div className="h-11 w-11 animate-pulse rounded-full bg-brand-light/70" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-32 animate-pulse rounded-full bg-brand-light/80" />
              <div className="h-2.5 w-44 animate-pulse rounded-full bg-candy" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
