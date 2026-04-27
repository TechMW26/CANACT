/**
 * Tiny live-location sharing service for in-person help requests. Writes a
 * presence node under `help/{helpId}/live/{uid}` updated on each geolocation
 * tick (cap ~10s) and clears it via `onDisconnect` when the tab/socket dies.
 */
import { ref, set, update, remove, onDisconnect, onValue } from 'firebase/database';
import { db } from '../firebase';

export interface LivePoint { lat: number; lng: number; at: number }

export function startLiveLocationShare(helpId: string, uid: string) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return () => {};
  const path = `help/${helpId}/live/${uid}`;
  const r = ref(db, path);
  onDisconnect(r).remove().catch(() => {});

  let last = 0;
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const now = Date.now();
      if (now - last < 8000) return; // throttle to ~8s
      last = now;
      update(r, {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        at: now,
      }).catch(() => {});
    },
    () => { /* permission denied — silent */ },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
  );

  return () => {
    try { navigator.geolocation.clearWatch(watchId); } catch {}
    remove(r).catch(() => {});
  };
}

export function listenLiveLocation(
  helpId: string,
  uid: string,
  cb: (p: LivePoint | null) => void,
) {
  return onValue(ref(db, `help/${helpId}/live/${uid}`), (s) => cb(s.val()));
}
