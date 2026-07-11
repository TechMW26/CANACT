'use client';
import React from 'react';
import clsx from 'clsx';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';
interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: React.ReactNode; full?: boolean;
}
export function Button({ variant = 'primary', size = 'md', loading, icon, full, className, children, disabled, ...rest }: Props) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[.98] focus-ring disabled:opacity-50 disabled:pointer-events-none';
  const sizes: Record<Size, string> = { sm: 'h-9 px-3 text-sm', md: 'h-11 px-5 text-[15px]', lg: 'h-12 px-6 text-base' };
  const variants: Record<Variant, string> = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    outline: 'border border-brand text-brand bg-white hover:bg-brand-light',
    ghost: 'text-brand hover:bg-brand-light',
    danger: 'bg-brand-dark text-white hover:bg-brand',
    subtle: 'bg-brand-light text-brand hover:bg-[#C9E0D5]',
  };
  return (
    <button className={clsx(base, sizes[size], variants[variant], full && 'w-full', className)} disabled={disabled || loading} {...rest}>
      {loading ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon}
      {children}
    </button>
  );
}
