'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { ref, update } from 'firebase/database';
import { db } from './firebase';
import { useAuth } from './auth';
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
  const { user } = useAuth();
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
  // Mirror the active radius onto the user's profile so the server can
  // honour each recipient's preference when fanning out nearby-friend
  // notifications (Infinity is stored as 0 = "anywhere").
  useEffect(() => {
    if (!user?.uid) return;
    const meters = RADII[radiusIdx];
    const stored = Number.isFinite(meters) ? Math.round(meters as number) : 0;
    update(ref(db, `users/${user.uid}/notifPrefs`), { nearbyRadius: stored }).catch(() => {});
  }, [user?.uid, radiusIdx]);
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
