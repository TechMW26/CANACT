'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getFirebaseAuth } from './firebase';
import { recordOnboardingSignal } from './services/onboarding';
import { haversineMeters } from './utils';

export type GeoFix = {
  lat: number;
  lng: number;
  accuracy: number;
  ts: number;
};

type GeoState = {
  coords: { lat: number; lng: number } | null;
  error: string | null;
  loading: boolean;
  fix: GeoFix | null;
};

const SERVER_STATE: GeoState = { coords: null, error: null, loading: true, fix: null };
const listeners = new Set<() => void>();
const onboardingRecordedFor = new Set<string>();

let state: GeoState = SERVER_STATE;
let watchId: number | null = null;
let lastPublishedAt = 0;

function publish(next: GeoState) {
  state = next;
  for (const listener of listeners) listener();
}

function recordLocationEnabled() {
  const uid = getFirebaseAuth().currentUser?.uid;
  if (!uid || onboardingRecordedFor.has(uid)) return;
  onboardingRecordedFor.add(uid);
  void recordOnboardingSignal(uid, 'enable-location').catch(() => {
    onboardingRecordedFor.delete(uid);
  });
}

function startWatcher() {
  if (watchId !== null || typeof navigator === 'undefined') return;
  if (!navigator.geolocation) {
    publish({ coords: null, error: 'Geolocation not supported', loading: false, fix: null });
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      const fix: GeoFix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        ts: now,
      };
      const previous = state.fix;
      const movedMeters = previous ? haversineMeters(previous, fix) : Number.POSITIVE_INFINITY;

      // GPS callbacks can arrive several times per second while stationary.
      // Publish meaningful movement immediately and otherwise refresh at a
      // low cadence so every consumer shares one stable render stream.
      if (previous && movedMeters < 1 && now - lastPublishedAt < 10_000) {
        recordLocationEnabled();
        return;
      }

      lastPublishedAt = now;
      publish({
        coords: { lat: fix.lat, lng: fix.lng },
        error: null,
        loading: false,
        fix,
      });
      recordLocationEnabled();
    },
    (error) => {
      publish({ coords: null, error: error.message, loading: false, fix: null });
    },
    { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
  );
}

function stopWatcher() {
  if (watchId === null || typeof navigator === 'undefined' || !navigator.geolocation) return;
  navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startWatcher();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopWatcher();
  };
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return SERVER_STATE;
}

function retryWatcher() {
  stopWatcher();
  lastPublishedAt = 0;
  publish(SERVER_STATE);
  if (listeners.size > 0) startWatcher();
}

/** Subscribe to the shared high-accuracy fix without creating another watcher. */
export function subscribeGeoFix(listener: (fix: GeoFix | null) => void) {
  let previous = state.fix;
  listener(previous);
  return subscribe(() => {
    if (state.fix === previous) return;
    previous = state.fix;
    listener(previous);
  });
}

export function useGeo() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const retry = useCallback(retryWatcher, []);
  return {
    coords: snapshot.coords,
    error: snapshot.error,
    retry,
    loading: snapshot.loading,
  };
}
