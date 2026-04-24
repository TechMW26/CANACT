'use client';
import React, { forwardRef } from 'react';
import clsx from 'clsx';

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, error, hint, className, id, ...rest }, ref,
) {
  const inputId = id ?? rest.name;
  return (
    <label className="block w-full">
      {label && <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>}
      <input
        ref={ref} id={inputId}
        className={clsx(
          'block w-full h-11 rounded-2xl border bg-white px-4 text-ink placeholder:text-subtle focus-ring',
          error ? 'border-brand' : 'border-line',
          className,
        )}
        {...rest}
      />
      {error ? <span className="mt-1 block text-xs font-semibold text-brand">{error}</span>
        : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
});

type TAProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string; error?: string };
export const Textarea = forwardRef<HTMLTextAreaElement, TAProps>(function Textarea(
  { label, error, className, ...rest }, ref,
) {
  return (
    <label className="block w-full">
      {label && <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>}
      <textarea
        ref={ref}
        className={clsx(
          'block w-full min-h-[96px] rounded-2xl border bg-white px-4 py-3 text-ink placeholder:text-subtle focus-ring',
          error ? 'border-brand' : 'border-line', className,
        )}
        {...rest}
      />
      {error && <span className="mt-1 block text-xs font-semibold text-brand">{error}</span>}
    </label>
  );
});

type SelProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string };
export const Select = forwardRef<HTMLSelectElement, SelProps>(function Select(
  { label, className, children, ...rest }, ref,
) {
  return (
    <label className="block w-full">
      {label && <span className="mb-1 block text-sm font-semibold text-ink">{label}</span>}
      <select ref={ref} className={clsx('block w-full h-11 rounded-2xl border border-line bg-white px-3 text-ink focus-ring', className)} {...rest}>
        {children}
      </select>
    </label>
  );
});
