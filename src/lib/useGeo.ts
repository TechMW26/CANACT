'use client';
import { useEffect, useState } from 'react';
import { getFirebaseAuth } from './firebase';
import { recordOnboardingSignal } from './services/onboarding';

export function useGeo() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setError('Geolocation not supported'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
        const uid = getFirebaseAuth().currentUser?.uid;
        if (uid) void recordOnboardingSignal(uid, 'enable-location');
      },
      (e) => setError(e.message),
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return { coords, error };
}
