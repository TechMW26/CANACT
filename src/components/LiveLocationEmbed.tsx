'use client';
import { Navigation, MapPin } from './icons';

/**
 * Live-location embed for in-person helps. Uses Google Maps' free embed
 * endpoint (no API key required). Includes a "Get directions" deep link that
 * opens the native maps app on mobile.
 */
export function LiveLocationEmbed({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label?: string;
}) {
  const src = `https://www.google.com/maps?q=${lat},${lng}&z=16&output=embed`;
  const dir = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return (
    <div className="rounded-3xl overflow-hidden border border-ink/10 bg-brand-light/40">
      <div className="relative">
        <iframe
          src={src}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="w-full aspect-square"
          title={label ?? 'Live location'}
        />
      </div>
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand text-white">
            <MapPin size={14} />
          </span>
          <div>
            <div className="font-bold text-ink leading-tight">{label ?? 'Live location'}</div>
            <div className="text-[11px] text-muted">{lat.toFixed(5)}, {lng.toFixed(5)}</div>
          </div>
        </div>
        <a
          href={dir}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-brand text-white text-xs font-bold px-3 py-2"
        >
          <Navigation size={12} /> Directions
        </a>
      </div>
    </div>
  );
}
