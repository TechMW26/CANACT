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
let stableFix: GeoFix | null = null;
let lastRawFix: GeoFix | null = null;
let fixWindow: GeoFix[] = [];

const GEO_FILTER = {
  WINDOW_MS: 20_000,
  MAX_SAMPLES: 10,
  MAX_RAW_ACCURACY: 250,
  MAX_TRACKED_ACCURACY: 120,
  MAX_PLAUSIBLE_SPEED_MPS: 60,
  MIN_STATIONARY_RADIUS: 2,
  MAX_STATIONARY_RADIUS: 8,
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isValidFix(fix: GeoFix) {
  return Number.isFinite(fix.lat)
    && Number.isFinite(fix.lng)
    && Number.isFinite(fix.accuracy)
    && fix.lat >= -90
    && fix.lat <= 90
    && fix.lng >= -180
    && fix.lng <= 180
    && fix.accuracy > 0
    && fix.accuracy <= GEO_FILTER.MAX_RAW_ACCURACY;
}

function interpolateFix(from: GeoFix, to: GeoFix, amount: number): GeoFix {
  const longitudeDelta = ((((to.lng - from.lng) + 540) % 360) - 180);
  const lng = ((((from.lng + longitudeDelta * amount) + 540) % 360) - 180);
  return {
    lat: from.lat + (to.lat - from.lat) * amount,
    lng,
    accuracy: from.accuracy + (to.accuracy - from.accuracy) * amount,
    ts: to.ts,
  };
}

/** Accuracy- and recency-weighted centroid in a local tangent plane. */
function weightedCentroid(samples: GeoFix[]): GeoFix {
  const anchor = samples[samples.length - 1];
  const latitudeScale = 111_320;
  const longitudeScale = Math.max(1, latitudeScale * Math.cos((anchor.lat * Math.PI) / 180));
  let weightedNorth = 0;
  let weightedEast = 0;
  let weightTotal = 0;

  for (const sample of samples) {
    const ageSeconds = Math.max(0, (anchor.ts - sample.ts) / 1000);
    const recencyWeight = Math.exp(-ageSeconds / 8);
    const accuracy = clamp(sample.accuracy, 3, GEO_FILTER.MAX_TRACKED_ACCURACY);
    const weight = recencyWeight / (accuracy * accuracy);
    const longitudeDelta = ((((sample.lng - anchor.lng) + 540) % 360) - 180);
    weightedNorth += (sample.lat - anchor.lat) * latitudeScale * weight;
    weightedEast += longitudeDelta * longitudeScale * weight;
    weightTotal += weight;
  }

  const lat = anchor.lat + (weightedNorth / Math.max(weightTotal, Number.EPSILON)) / latitudeScale;
  const lng = ((((anchor.lng + (weightedEast / Math.max(weightTotal, Number.EPSILON)) / longitudeScale) + 540) % 360) - 180);
  const center = { lat, lng };
  const spread = Math.sqrt(samples.reduce((sum, sample) => {
    const distance = haversineMeters(center, sample);
    return sum + distance * distance;
  }, 0) / samples.length);
  const bestAccuracy = Math.min(...samples.map((sample) => sample.accuracy));

  return {
    lat,
    lng,
    accuracy: clamp(Math.max(bestAccuracy, spread), 3, GEO_FILTER.MAX_TRACKED_ACCURACY),
    ts: anchor.ts,
  };
}

function stabilizedGeoFix(raw: GeoFix): GeoFix | null {
  if (!isValidFix(raw)) return null;

  if (stableFix) {
    const distanceFromStable = haversineMeters(stableFix, raw);
    const elapsedFromRaw = lastRawFix ? Math.max(.25, (raw.ts - lastRawFix.ts) / 1000) : Number.POSITIVE_INFINITY;
    const rawSpeed = lastRawFix ? haversineMeters(lastRawFix, raw) / elapsedFromRaw : 0;
    const poorJump = raw.accuracy > Math.max(35, stableFix.accuracy * 1.8)
      && distanceFromStable > Math.max(30, raw.accuracy * 1.5);
    const implausibleJump = rawSpeed > GEO_FILTER.MAX_PLAUSIBLE_SPEED_MPS
      && !!lastRawFix
      && raw.accuracy >= lastRawFix.accuracy * .8;
    const poorTrackedFix = raw.accuracy > GEO_FILTER.MAX_TRACKED_ACCURACY
      && raw.ts - stableFix.ts < 120_000;
    if (poorJump || implausibleJump || poorTrackedFix) {
      lastRawFix = raw;
      return null;
    }
  }

  lastRawFix = raw;
  fixWindow = fixWindow
    .filter((sample) => raw.ts - sample.ts <= GEO_FILTER.WINDOW_MS)
    .concat(raw)
    .slice(-GEO_FILTER.MAX_SAMPLES);

  // When a strong fix shows clear real movement, discard stationary history
  // so the pin catches up instead of dragging the old centroid behind it.
  if (stableFix) {
    const distance = haversineMeters(stableFix, raw);
    const clearMovement = distance > Math.max(24, raw.accuracy * 1.5)
      && raw.accuracy <= Math.max(35, stableFix.accuracy * 1.5);
    if (clearMovement) fixWindow = [raw];
  }

  const preliminary = weightedCentroid(fixWindow);
  const distances = fixWindow.map((sample) => haversineMeters(preliminary, sample)).sort((a, b) => a - b);
  const medianDistance = distances[Math.floor(distances.length / 2)] ?? 0;
  const inliers = fixWindow.filter((sample) => (
    haversineMeters(preliminary, sample) <= Math.max(8, sample.accuracy * 1.5, medianDistance * 2.5)
  ));
  const candidate = weightedCentroid(inliers.length ? inliers : [raw]);

  if (!stableFix) {
    stableFix = candidate;
    return stableFix;
  }

  const candidateMovement = haversineMeters(stableFix, candidate);
  const stationaryRadius = clamp(
    candidate.accuracy * .35,
    GEO_FILTER.MIN_STATIONARY_RADIUS,
    GEO_FILTER.MAX_STATIONARY_RADIUS,
  );

  if (candidateMovement <= stationaryRadius) {
    stableFix = {
      ...stableFix,
      accuracy: Math.min(stableFix.accuracy, candidate.accuracy),
      ts: candidate.ts,
    };
    return stableFix;
  }

  const movementRatio = candidateMovement / Math.max(candidate.accuracy, stationaryRadius);
  const accuracyImprovement = stableFix.accuracy / Math.max(candidate.accuracy, 1);
  let response = clamp(.2 + movementRatio * .22 + (accuracyImprovement > 1.25 ? .16 : 0), .2, .82);
  if (candidateMovement > 20 && candidate.accuracy <= 35) response = Math.max(response, .68);
  stableFix = interpolateFix(stableFix, candidate, response);
  return stableFix;
}

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
      const rawFix: GeoFix = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
        ts: now,
      };
      const fix = stabilizedGeoFix(rawFix);
      if (!fix) return;
      const previous = state.fix;
      const movedMeters = previous ? haversineMeters(previous, fix) : Number.POSITIVE_INFINITY;

      // Keep rendering quiet inside the sub-metre band, but refresh the fix
      // timestamp often enough for presence and proximity consumers.
      if (previous && movedMeters < .75 && now - lastPublishedAt < 10_000) {
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
      // A transient timeout should not make the map pin disappear. Permission
      // denial still clears it because the previous fix is no longer usable.
      const permissionDenied = error.code === error.PERMISSION_DENIED;
      publish(permissionDenied || !state.fix
        ? { coords: null, error: error.message, loading: false, fix: null }
        : { ...state, error: error.message, loading: false });
    },
    { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
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
  stableFix = null;
  lastRawFix = null;
  fixWindow = [];
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
