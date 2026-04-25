'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { formatDistance } from './utils';

export const RADII = [1000, 5000, 10000, 25000, 100000, Infinity];
export const RADIUS_OPTIONS = RADII.map((radius, index) => ({
  index,
  label: radius === Infinity ? 'Anywhere' : formatDistance(radius),
}));

type Ctx = {
  radiusIdx: number;
  setRadiusIdx: (n: number) => void;
  radius: number;
};

const DistanceCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = 'canact:radiusIdx';

export function DistanceProvider({ children }: { children: React.ReactNode }) {
  const [radiusIdx, setRadiusIdxState] = useState(2);
  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
      if (v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n < RADII.length) setRadiusIdxState(n);
      }
    } catch {}
  }, []);
  const setRadiusIdx = (n: number) => {
    setRadiusIdxState(n);
    try { window.localStorage.setItem(STORAGE_KEY, String(n)); } catch {}
  };
  return (
    <DistanceCtx.Provider value={{ radiusIdx, setRadiusIdx, radius: RADII[radiusIdx] }}>
      {children}
    </DistanceCtx.Provider>
  );
}

export function useDistance() {
  const v = useContext(DistanceCtx);
  if (!v) throw new Error('useDistance must be used inside <DistanceProvider>');
  return v;
}
