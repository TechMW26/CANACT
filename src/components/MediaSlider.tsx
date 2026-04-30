'use client';
import { useRef, useState } from 'react';
import { isVideoUrl } from './CameraCapture';
import { VideoPreview } from './VideoPreview';

/**
 * Full-card-width image/video carousel with snap-scroll, page indicator pill
 * (e.g. "2/4"), and an animated dot bar. Used by feed cards and post detail.
 */
export function MediaSlider({ urls, posters, aspect = '4/5' }: { urls: string[]; posters?: string[]; aspect?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [idx, setIdx] = useState(0);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth || 1;
    setIdx(Math.round(el.scrollLeft / w));
  }

  if (urls.length === 1) {
    const u = urls[0];
    const p = posters?.[0] || undefined;
    return (
      <div className="overflow-hidden rounded-[24px]" style={{ aspectRatio: aspect }}>
        {isVideoUrl(u) ? (
          <VideoPreview src={u} poster={p} className="h-full w-full" fit="cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={u} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover bg-brand-light" />
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex w-full snap-x snap-mandatory overflow-x-auto rounded-[24px] no-scrollbar"
      >
        {urls.map((u, i) => (
          <div
            key={i}
            className="relative w-full shrink-0 snap-center"
            style={{ aspectRatio: aspect }}
          >
            {isVideoUrl(u) ? (
              <VideoPreview src={u} poster={posters?.[i] || undefined} className="h-full w-full" fit="cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover bg-brand-light" />
            )}
          </div>
        ))}
      </div>
      <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-bold text-white">
        {idx + 1}/{urls.length}
      </span>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1">
        {urls.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-4 bg-white' : 'w-1.5 bg-white/55'}`}
          />
        ))}
      </div>
    </div>
  );
}
