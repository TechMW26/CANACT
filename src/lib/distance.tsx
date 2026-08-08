'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { ref, update } from 'firebase/database';
import { db } from './firebase';
import { useAuth } from './auth';
import { formatDistance } from './utils';

export const RADII = [1000, 5000, 10000, 25000, 100000, Infinity];
export const DEFAULT_RADIUS_INDEX = RADII.length - 1;
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
const DEFAULT_MIGRATION_KEY = 'canact:radiusDefaultVersion';
const DEFAULT_MIGRATION_VERSION = 'anywhere-v1';

export function DistanceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [radiusIdx, setRadiusIdxState] = useState(DEFAULT_RADIUS_INDEX);
  const [isHydrated, setIsHydrated] = useState(false);
  // Hydrate from localStorage on mount.
  useEffect(() => {
    try {
      const storage = window.localStorage;
      if (storage.getItem(DEFAULT_MIGRATION_KEY) !== DEFAULT_MIGRATION_VERSION) {
        storage.setItem(STORAGE_KEY, String(DEFAULT_RADIUS_INDEX));
        storage.setItem(DEFAULT_MIGRATION_KEY, DEFAULT_MIGRATION_VERSION);
        return;
      }
      const v = storage.getItem(STORAGE_KEY);
      if (v != null) {
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n < RADII.length) setRadiusIdxState(n);
      }
    } catch {
      // Keep the default when storage is unavailable.
    } finally {
      setIsHydrated(true);
    }
  }, []);
  // Mirror the active radius onto the user's profile so the server can
  // honour each recipient's preference when fanning out nearby-friend
  // notifications (Infinity is stored as 0 = "anywhere").
  useEffect(() => {
    if (!isHydrated || !user?.uid) return;
    const meters = RADII[radiusIdx];
    const stored = Number.isFinite(meters) ? Math.round(meters as number) : 0;
    update(ref(db, `users/${user.uid}/notifPrefs`), { nearbyRadius: stored }).catch(() => {});
  }, [isHydrated, user?.uid, radiusIdx]);
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
