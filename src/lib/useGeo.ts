'use client';
import { useCallback, useEffect, useState } from 'react';
import { getFirebaseAuth } from './firebase';
import { recordOnboardingSignal } from './services/onboarding';

export function useGeo() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setCoords(null);
    setRequestVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setError('Geolocation not supported'); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setCoords({ lat: p.coords.latitude, lng: p.coords.longitude });
        const uid = getFirebaseAuth().currentUser?.uid;
        if (uid) void recordOnboardingSignal(uid, 'enable-location');
      },
      (e) => {
        setCoords(null);
        setError(e.message);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [requestVersion]);
  return { coords, error, retry, loading: !coords && !error };
}
