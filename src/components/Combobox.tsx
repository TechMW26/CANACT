'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

export interface ComboOption {
  value: string;
  label: string;
  /** Optional 2-letter country code for flag rendering. */
  flag?: string;
  /** Optional secondary text shown right-aligned. */
  hint?: string;
}

interface Props {
  label?: string;
  value: string;
  onChange: (value: string, opt: ComboOption | null) => void;
  options: ComboOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  emptyText?: string;
  /** Max number of items rendered for performance. Defaults to 300. */
  maxResults?: number;
}

function FlagIcon({ code, alt }: { code?: string; alt?: string }) {
  if (!code) return null;
  const cc = code.toLowerCase();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/${cc}.svg`}
      alt={alt ?? cc}
      width={20}
      height={14}
      className="inline-block h-[14px] w-[20px] flex-none rounded-[2px] object-cover ring-1 ring-black/5"
      loading="lazy"
    />
  );
}

export function Combobox({
  label, value, onChange, options, placeholder = 'Select…', disabled, required, error, emptyText = 'No matches', maxResults = 300,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      : options;
    return list.slice(0, maxResults);
  }, [query, options, maxResults]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  useEffect(() => { setHighlight(0); }, [query, open]);

  function commit(opt: ComboOption) {
    onChange(opt.value, opt);
    setOpen(false);
    setQuery('');
  }

  return (
    <label className="block w-full" ref={wrapRef as any}>
      {label && (
        <span className="mb-1 block text-sm font-semibold text-ink">
          {label}{required && <span className="text-brand"> *</span>}
        </span>
      )}
      <div className={clsx('relative')}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => { if (!disabled) { setOpen((v) => !v); setTimeout(() => inputRef.current?.focus(), 0); } }}
          className={clsx(
            'flex h-11 w-full items-center gap-2 rounded-2xl border bg-white px-3 text-left focus-ring',
            error ? 'border-brand' : 'border-line',
            disabled && 'opacity-60 cursor-not-allowed',
          )}
        >
          {selected?.flag && <FlagIcon code={selected.flag} alt={selected.label} />}
          <span className={clsx('flex-1 truncate text-sm', selected ? 'text-ink' : 'text-subtle')}>
            {selected ? selected.label : placeholder}
          </span>
          <svg className="h-3 w-3 text-ink/50" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {open && !disabled && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-2xl border border-line bg-white shadow-lg">
            <div className="border-b border-line p-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
                  else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) commit(filtered[highlight]); }
                  else if (e.key === 'Escape') { setOpen(false); }
                }}
                placeholder="Search…"
                className="block h-9 w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-subtle focus-ring"
                autoFocus
              />
            </div>
            <ul className="max-h-64 overflow-auto py-1" role="listbox">
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-center text-sm text-muted">{emptyText}</li>
              ) : filtered.map((o, i) => (
                <li key={o.value}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => commit(o)}
                    className={clsx(
                      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                      i === highlight ? 'bg-brand-light text-ink' : 'text-ink hover:bg-brand-light',
                      o.value === value && 'font-semibold',
                    )}
                  >
                    {o.flag && <FlagIcon code={o.flag} alt={o.label} />}
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {error && <span className="mt-1 block text-xs font-semibold text-brand">{error}</span>}
    </label>
  );
}

export { FlagIcon };
