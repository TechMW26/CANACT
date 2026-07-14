'use client';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'success' };
let pushFn: ((t: Omit<Toast, 'id'>) => void) | null = null;

export function toast(text: string, kind: Toast['kind'] = 'info') {
  pushFn?.({ text, kind });
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    pushFn = ({ text, kind }) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev, { id, text, kind }]);
      setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 3500);
    };
    return () => { pushFn = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[var(--canact-floating-bottom-clearance)] z-[2147483647] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <div key={t.id}
          className={`pointer-events-auto rounded-full px-4 py-2 text-sm font-medium border ${
            t.kind === 'error' ? 'bg-brand text-white border-brand-dark'
            : t.kind === 'success' ? 'bg-emerald-600 text-white border-emerald-700'
            : 'bg-white text-ink border-line'}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
