'use client';
import Link from 'next/link';
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Avatar } from './Avatar';

export type FriendMapPerson = {
  uid: string;
  name: string;
  photoURL?: string | null;
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  locationAt?: number;
  locationSource?: 'live' | 'city';
};

type Point = { lat: number; lng: number };
type ScreenPoint = { x: number; y: number };
type LocatedFriend = FriendMapPerson & Point;
type MarkerCluster = { key: string; friends: LocatedFriend[]; screen: ScreenPoint };

const MARKER_CLUSTER_DISTANCE = 56;
const DEFAULT_CENTER: Point = { lat: 20, lng: 0 };
const SATELLITE_FADE_START = 4.25;
const SATELLITE_FADE_END = 5.25;

// Leaflet is loaded dynamically (client-side only) to keep this component SSR-safe.
type LeafletModule = typeof import('leaflet');
let leafletPromise: Promise<LeafletModule> | null = null;
function loadLeaflet(): Promise<LeafletModule> {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'));
  if (!leafletPromise) {
    leafletPromise = import('leaflet').then((mod) => {
      const L = (mod as unknown as { default?: LeafletModule }).default ?? (mod as unknown as LeafletModule);
      if (!document.getElementById('canact-leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'canact-leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }
      return L;
    });
  }
  return leafletPromise;
}

export function FriendsWorldMap({
  friends,
  currentLocation,
  className,
  emptyTitle = 'No friend locations yet',
  emptyBody = 'Friends appear here after they have a recent app location.',
  onPersonSelect,
}: {
  friends: FriendMapPerson[];
  currentLocation?: Point | null;
  className?: string;
  emptyTitle?: string;
  emptyBody?: string;
  onPersonSelect?: (person: FriendMapPerson) => void;
}) {
  const locatedFriends = useMemo(() => friends.filter(hasLocation), [friends]);
  const initialView = useMemo(
    () => fitMapView(locatedFriends, currentLocation),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locatedFriends.length, currentLocation?.lat, currentLocation?.lng],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const lightLayerRef = useRef<import('leaflet').TileLayer | null>(null);
  const satelliteLayerRef = useRef<import('leaflet').TileLayer | null>(null);
  const labelsLayerRef = useRef<import('leaflet').TileLayer | null>(null);
  const userInteractedRef = useRef(false);
  const centeredOnUserRef = useRef(false);

  const [zoom, setZoom] = useState<number>(initialView.zoom);
  const [center, setCenter] = useState<Point>(initialView.center);
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [layersReady, setLayersReady] = useState(false);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;

    loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        center: [initialView.center.lat, initialView.center.lng],
        zoom: initialView.zoom,
        minZoom: 2,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: false,
        worldCopyJump: true,
      });

      const tileOpts: import('leaflet').TileLayerOptions = {
        maxZoom: 19,
        crossOrigin: true,
        detectRetina: true,
        keepBuffer: 4,
        updateWhenIdle: false,
      };

      const light = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        { ...tileOpts, subdomains: 'abcd', className: 'canact-tile-light' },
      ).addTo(map);

      const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        { ...tileOpts, opacity: 0, className: 'canact-tile-sat' },
      ).addTo(map);

      const labels = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
        { ...tileOpts, subdomains: 'abcd', opacity: 0, className: 'canact-tile-labels' },
      ).addTo(map);

      lightLayerRef.current = light;
      satelliteLayerRef.current = satellite;
      labelsLayerRef.current = labels;
      mapRef.current = map;
      setLayersReady(true);

      const sync = () => {
        const c = map.getCenter();
        setCenter({ lat: c.lat, lng: c.lng });
        setZoom(map.getZoom());
        const s = map.getSize();
        setSize({ width: s.x, height: s.y });
      };
      map.on('move zoom moveend zoomend resize', sync);
      map.on('zoomstart movestart', (event) => {
        if ((event as { originalEvent?: Event }).originalEvent) userInteractedRef.current = true;
      });
      map.whenReady(() => {
        sync();
        window.setTimeout(() => map.invalidateSize(), 80);
      });
    }).catch(() => {
      // No-op; fallback empty state covers the failure case.
    });

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      lightLayerRef.current = null;
      satelliteLayerRef.current = null;
      labelsLayerRef.current = null;
      setLayersReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // First time the user's location is available, snap to it at street level
  // regardless of any prior interaction — this guarantees the map opens 100%
  // zoomed on the user pin on both the home and friends pages.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentLocation) return;
    if (centeredOnUserRef.current) return;
    centeredOnUserRef.current = true;
    userInteractedRef.current = false;
    map.setView([currentLocation.lat, currentLocation.lng], 17, { animate: false });
    window.setTimeout(() => map.invalidateSize(), 60);
  }, [currentLocation?.lat, currentLocation?.lng, layersReady]);

  // Recenter when initial view changes (e.g., user location arrives) — but only if the user hasn't taken control.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (userInteractedRef.current) return;
    map.setView([initialView.center.lat, initialView.center.lng], initialView.zoom, { animate: true });
  }, [initialView.center.lat, initialView.center.lng, initialView.zoom]);

  // Crossfade satellite + labels based on zoom. Re-runs once layers exist so
  // the initial opacity is correctly applied even if zoom never changed.
  useEffect(() => {
    if (!layersReady) return;
    const satOpacity = smoothStep(SATELLITE_FADE_START, SATELLITE_FADE_END, zoom);
    satelliteLayerRef.current?.setOpacity(satOpacity);
    labelsLayerRef.current?.setOpacity(satOpacity * 0.95);
    lightLayerRef.current?.setOpacity(Math.max(0.18, 1 - satOpacity));
  }, [zoom, layersReady]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const project = useCallback((point: Point): ScreenPoint | null => {
    const map = mapRef.current;
    if (!map) return null;
    const p = map.latLngToContainerPoint([point.lat, point.lng]);
    return { x: p.x, y: p.y };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, zoom, size.width, size.height]);

  const markerClusters = useMemo<MarkerCluster[]>(() => {
    if (!size.width || !size.height) return [];
    return buildMarkerClusters(locatedFriends, project);
  }, [locatedFriends, project, size.width, size.height]);

  const youScreen = currentLocation ? project(currentLocation) : null;
  const showMarkerNames = zoom >= 5.15;
  const selectedCluster = selectedClusterKey
    ? markerClusters.find((cluster) => cluster.key === selectedClusterKey && cluster.friends.length > 1) ?? null
    : null;
  const missingLocations = Math.max(0, friends.length - locatedFriends.length);

  useEffect(() => {
    if (!selectedClusterKey) return;
    if (!markerClusters.some((cluster) => cluster.key === selectedClusterKey && cluster.friends.length > 1)) setSelectedClusterKey(null);
  }, [markerClusters, selectedClusterKey]);

  return (
    <div
      data-canact-map="true"
      className={`relative overflow-hidden bg-[#FFF8F8] ${className ?? 'h-[58svh] min-h-[390px] max-h-[620px]'}`}
    >
      <div ref={containerRef} className="absolute inset-0" />

      {youScreen ? (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand px-2 py-1 text-[10px] font-extrabold text-white shadow-sm"
          style={{ left: youScreen.x, top: youScreen.y }}
        >
          You
        </div>
      ) : null}

      {markerClusters.map((cluster) => (
        <MapMarkerCluster
          key={cluster.key}
          cluster={cluster}
          showMarkerNames={showMarkerNames}
          selected={selectedClusterKey === cluster.key}
          onOpen={() => setSelectedClusterKey(cluster.key)}
          onPersonSelect={onPersonSelect}
        />
      ))}

      {selectedCluster ? (
        <StackedPeoplePanel cluster={selectedCluster} onClose={() => setSelectedClusterKey(null)} onPersonSelect={onPersonSelect} />
      ) : null}

      {locatedFriends.length === 0 ? (
        <div className="pointer-events-none absolute left-4 right-4 top-1/2 z-30 -translate-y-1/2 rounded-3xl border border-white/80 bg-white/90 px-4 py-5 text-center backdrop-blur">
          <div className="text-sm font-extrabold text-ink">{emptyTitle}</div>
          <div className="mt-1 text-xs font-semibold text-ink/55">{emptyBody}</div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-[var(--canact-floating-bottom-clearance)] left-3 z-40 rounded-full border border-white/70 bg-white/90 px-3 py-1 text-[10px] font-bold text-ink/65 backdrop-blur lg:bottom-3">
        {locatedFriends.length} on map{missingLocations ? ` · ${missingLocations} without location` : ''}
      </div>
      <div className="pointer-events-none absolute bottom-[var(--canact-floating-bottom-clearance)] right-3 z-40 rounded-full bg-white/80 px-2 py-1 text-[9px] font-semibold text-ink/55 backdrop-blur lg:bottom-3">
        © OpenStreetMap © CARTO · Esri
      </div>
    </div>
  );
}

function MapMarkerCluster({
  cluster,
  showMarkerNames,
  selected,
  onOpen,
  onPersonSelect,
}: {
  cluster: MarkerCluster;
  showMarkerNames: boolean;
  selected: boolean;
  onOpen: () => void;
  onPersonSelect?: (person: FriendMapPerson) => void;
}) {
  const primary = cluster.friends[0];
  const stacked = cluster.friends.length > 1;
  const label = stacked ? `${cluster.friends.length} people` : primary.name;
  const className = 'absolute z-30 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 transition duration-200 active:scale-95';
  const style = { left: cluster.screen.x, top: cluster.screen.y };
  const marker = (
    <>
      {showMarkerNames ? (
        <span className="max-w-[150px] truncate rounded-full border border-white/90 bg-white/95 px-2.5 py-1 text-[11px] font-extrabold text-ink shadow-sm backdrop-blur">
          {label}
        </span>
      ) : null}
      <span className={`relative inline-flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.22)] ${primary.locationSource === 'city' ? 'border-white/85 ring-2 ring-amber-300/80' : 'border-white ring-2 ring-brand/20'} ${selected ? 'ring-4 ring-brand/35' : ''}`}>
        <Avatar src={primary.photoURL ?? null} name={primary.name} size={40} />
        {stacked ? (
          <span className="absolute -right-1 -top-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-brand px-1 text-[10px] font-extrabold leading-none text-white">
            {cluster.friends.length > 9 ? '9+' : cluster.friends.length}
          </span>
        ) : null}
        <span className="absolute -bottom-1 h-3 w-3 rotate-45 rounded-[3px] border-b border-r border-white bg-white" />
      </span>
    </>
  );

  if (!stacked && onPersonSelect) {
    return (
      <button
        type="button"
        title={primary.name}
        className={`${className} cursor-pointer`}
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onPersonSelect(primary); }}
      >
        {marker}
      </button>
    );
  }

  if (!stacked) {
    return (
      <Link
        href={`/profile/${primary.uid}`}
        prefetch
        title={primary.name}
        className={className}
        style={style}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {marker}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={`Show ${cluster.friends.length} people at this location`}
      className={`${className} cursor-pointer`}
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); onOpen(); }}
    >
      {marker}
    </button>
  );
}

function StackedPeoplePanel({ cluster, onClose, onPersonSelect }: { cluster: MarkerCluster; onClose: () => void; onPersonSelect?: (person: FriendMapPerson) => void }) {
  return (
    <div
      className="absolute bottom-[var(--canact-floating-bottom-clearance)] left-3 right-3 z-[70] mx-auto max-w-sm overflow-hidden rounded-[28px] border border-[#F1D7DC] bg-white/96 p-2 shadow-[0_18px_50px_rgba(15,23,42,0.18)] backdrop-blur-xl lg:bottom-5"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-ink">{cluster.friends.length} people here</div>
          <div className="truncate text-xs font-semibold text-ink/50">Select who you want to open</div>
        </div>
        <button type="button" onClick={onClose} className="h-8 rounded-full px-3 text-xs font-extrabold text-ink/55 active:bg-brand-light">
          Close
        </button>
      </div>
      <ul className="max-h-[42svh] overflow-y-auto divide-y divide-line">
        {cluster.friends.map((friend) => (
          <li key={friend.uid}>
            {onPersonSelect ? (
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-2xl px-2 py-3 text-left active:bg-brand-light"
                onClick={() => { onPersonSelect(friend); onClose(); }}
              >
                <Avatar src={friend.photoURL ?? null} name={friend.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-ink">{friend.name}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-ink/45">{mapLocationLabel(friend)}</div>
                </div>
              </button>
            ) : (
              <Link href={`/profile/${friend.uid}`} prefetch className="flex items-center gap-3 rounded-2xl px-2 py-3 active:bg-brand-light" onClick={onClose}>
                <Avatar src={friend.photoURL ?? null} name={friend.name} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-extrabold text-ink">{friend.name}</div>
                  <div className="mt-0.5 truncate text-xs font-semibold text-ink/45">{mapLocationLabel(friend)}</div>
                </div>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function buildMarkerClusters(friends: LocatedFriend[], project: (point: Point) => ScreenPoint | null): MarkerCluster[] {
  const clusters: MarkerCluster[] = [];
  friends.forEach((friend) => {
    const screen = project(friend);
    if (!screen) return;
    const matchingCluster = clusters.find((cluster) => distanceBetween(cluster.screen, screen) <= MARKER_CLUSTER_DISTANCE);
    if (!matchingCluster) {
      clusters.push({ key: friend.uid, friends: [friend], screen });
      return;
    }
    matchingCluster.friends.push(friend);
    const count = matchingCluster.friends.length;
    matchingCluster.screen = {
      x: matchingCluster.screen.x + (screen.x - matchingCluster.screen.x) / count,
      y: matchingCluster.screen.y + (screen.y - matchingCluster.screen.y) / count,
    };
  });
  return clusters.map((cluster) => ({ ...cluster, key: cluster.friends.map((friend) => friend.uid).sort().join('|') }));
}

function fitMapView(friends: LocatedFriend[], currentLocation?: Point | null): { center: Point; zoom: number } {
  if (currentLocation) return { center: currentLocation, zoom: 17 };
  if (friends.length === 0) return { center: DEFAULT_CENTER, zoom: 2 };
  const lats = friends.map((friend) => friend.lat);
  const lngs = friends.map((friend) => friend.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spread = Math.max(maxLat - minLat, maxLng - minLng);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const zoom = spread > 120 ? 2 : spread > 70 ? 3 : spread > 35 ? 4 : spread > 18 ? 5 : spread > 8 ? 6 : 8;
  return { center, zoom };
}

function hasLocation(friend: FriendMapPerson): friend is LocatedFriend {
  return typeof friend.lat === 'number' && Number.isFinite(friend.lat) && typeof friend.lng === 'number' && Number.isFinite(friend.lng);
}

function mapLocationLabel(friend: FriendMapPerson) {
  const place = [friend.city, friend.country].filter(Boolean).join(', ');
  if (friend.locationSource === 'city') return place ? `Selected city · ${place}` : 'Selected city';
  return place || 'Live location';
}

function distanceBetween(a: ScreenPoint, b: ScreenPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function smoothStep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
