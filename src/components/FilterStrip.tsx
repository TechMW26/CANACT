'use client';
import { MEDIA_FILTERS, type MediaFilterId } from '@/lib/mediaFilters';

/** Horizontal swatch picker — each chip shows the filter applied to the same
 * thumbnail (image or video frame) so the user previews the look. */
export function FilterStrip({
  thumbUrl,
  isVideo,
  selected,
  onChange,
  className,
}: {
  thumbUrl: string;
  isVideo?: boolean;
  selected: MediaFilterId;
  onChange: (id: MediaFilterId) => void;
  className?: string;
}) {
  return (
    <div className={`-mx-2 overflow-x-auto overflow-y-visible no-scrollbar ${className ?? ''}`}>
      <div className="flex w-max gap-2 px-2 py-3">
        {MEDIA_FILTERS.map((f) => {
          const active = selected === f.id;
          return (
            <button
              key={f.id}
              type="button"
              data-liquid-glass={active ? 'switcher' : 'surface'}
              data-liquid-radius="16"
              data-liquid-blur="0"
              data-liquid-tint={active ? '31,107,85' : '12,26,22'}
              data-liquid-tint-opacity={active ? '0.22' : '0.12'}
              onClick={() => onChange(f.id)}
              className={`flex shrink-0 flex-col items-center gap-1.5 rounded-2xl bg-transparent p-1.5 transition ${active ? 'ring-2 ring-white' : 'ring-1 ring-white/15 hover:bg-white/10'}`}
              aria-pressed={active}
            >
              <span className="block h-14 w-14 overflow-hidden rounded-xl bg-black">
                {isVideo ? (
                  <video
                    src={thumbUrl}
                    muted
                    playsInline
                    className="h-full w-full object-cover"
                    style={{ filter: f.css }}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl}
                    alt={f.label}
                    className="h-full w-full object-cover"
                    style={{ filter: f.css }}
                  />
                )}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${active ? 'text-white' : 'text-white/70'}`}>
                {f.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
