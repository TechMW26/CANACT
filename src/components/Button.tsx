'use client';
import React from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';
interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: React.ReactNode; full?: boolean;
}
export function Button({ variant = 'primary', size = 'md', loading, icon, full, className, children, disabled, ...rest }: Props) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[.98] focus-ring disabled:pointer-events-none disabled:opacity-50';
  const sizes: Record<Size, string> = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-[15px]', lg: 'h-12 px-6 text-base' };
  const variants: Record<Variant, string> = {
    primary: 'border border-brand bg-brand text-white shadow-[0_8px_22px_rgba(31,107,85,.24)]',
    outline: 'border border-brand/35 bg-transparent text-brand',
    ghost: 'border border-white/30 bg-transparent text-brand',
    danger: 'border border-red-300/40 bg-transparent text-red-700',
    subtle: 'border border-brand/15 bg-transparent text-brand',
  };
  return (
    <button data-canact-button={variant} className={clsx(base, sizes[size], variants[variant], full && 'w-full', className)} disabled={disabled || loading} {...rest}>
      {loading ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      <span className="relative z-[2] inline-flex items-center justify-center gap-2">{children}</span>
    </button>
  );
}
