import clsx from 'clsx';
import React from 'react';
import { Star } from './icons';

export function Avatar({ src, name, size = 40, className }: { src?: string | null; name?: string; size?: number; className?: string }) {
  const initials = (name ?? '?')
    .split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('') || '?';
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img key={src} src={src} alt={name ?? ''} width={size} height={size} loading="lazy" decoding="async" className={clsx('rounded-full object-cover bg-brand-light', className)} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={clsx('rounded-full bg-brand-light text-brand font-bold flex items-center justify-center', className)}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >{initials}</div>
  );
}

export function RatingPill({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-light px-2 py-0.5 text-xs font-bold text-brand">
      <Star size={12} fill="currentColor" strokeWidth={0} /> {(value ?? 0).toFixed(1)}
    </span>
  );
}
