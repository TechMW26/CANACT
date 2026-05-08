'use client';
/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { createPortal } from 'react-dom';
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
type Size = { width: number; height: number };
type ScreenPoint = { x: number; y: number };
type Tile = { key: string; z: number; x: number; y: number; left: number; top: number };
type MapView = { center: Point; zoom: number; key: string };
type Gesture = { center: Point; zoom: number; midpoint: ScreenPoint; distance: number };
type LocatedFriend = FriendMapPerson & Point;
type MarkerCluster = { key: string; friends: LocatedFriend[]; screen: ScreenPoint };
type MapTileKind = 'light' | 'satellite';

const TILE_SIZE = 256;
const TILE_OVERLAP = 2;
const DEFAULT_USER_ZOOM = 18;
const MARKER_CLUSTER_DISTANCE = 56;
const DEFAULT_CENTER: Point = { lat: 20, lng: 0 };
const MAP_TILE_CACHE = 'canact-map-tiles-v1';
const MAX_PREFETCH_TILE_URLS = 120;
const MAP_PREFETCH_IDLE_TIMEOUT_MS = 1400;
const prefetchedTileUrls = new Set<string>();

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
  const baseView = useMemo(() => fitMapView(locatedFriends, currentLocation), [locatedFriends, currentLocation?.lat, currentLocation?.lng]);
  const [view, setView] = useState<MapView>(baseView);
  const viewRef = useRef(view);
  const activePointersRef = useRef<Map<number, ScreenPoint>>(new Map());
  const gestureRef = useRef<Gesture | null>(null);
  const [selectedClusterKey, setSelectedClusterKey] = useState<string | null>(null);
  const { ref, size } = useElementSize();

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => {
    if (viewRef.current.key === 'manual') return;
    activePointersRef.current.clear();
    gestureRef.current = null;
    setView(baseView);
  }, [baseView]);

  const mapSize = size.width && size.height ? size : { width: 640, height: 420 };
  const zoom = clamp(view.zoom, 1, 19);
  const tileZoom = Math.max(1, Math.min(19, Math.floor(zoom)));
  const tileScale = 2 ** (zoom - tileZoom);
  const tileViewportSize = useMemo<Size>(() => ({
    width: Math.max(1, mapSize.width / tileScale),
    height: Math.max(1, mapSize.height / tileScale),
  }), [mapSize.width, mapSize.height, tileScale]);
  const satelliteOpacity = smoothStep(4.25, 5.25, zoom);
  const lightLayerOpacity = Math.max(0.14, 1 - satelliteOpacity);
  const renderSatelliteLayer = satelliteOpacity > 0.02;
  const renderLightLayer = satelliteOpacity < 0.98 || lightLayerOpacity > 0.18;
  const activeTileKinds = useMemo<MapTileKind[]>(() => {
    const kinds: MapTileKind[] = [];
    if (renderLightLayer) kinds.push('light');
    if (renderSatelliteLayer) kinds.push('satellite');
    return kinds.length ? kinds : ['light'];
  }, [renderLightLayer, renderSatelliteLayer]);
  const showMarkerNames = zoom >= 5.15;
  const viewport = useMemo(
    () => buildTileViewport(view.center, tileZoom, tileViewportSize),
    [view.center.lat, view.center.lng, tileZoom, tileViewportSize.width, tileViewportSize.height],
  );
  const markerClusters = useMemo(
    () => buildMarkerClusters(locatedFriends, view.center, zoom, mapSize),
    [locatedFriends, view.center.lat, view.center.lng, zoom, mapSize.width, mapSize.height],
  );
  const visibleTileUrls = useMemo(
    () => buildTileUrls(viewport.tiles, activeTileKinds),
    [viewport.tiles, activeTileKinds],
  );
  const prefetchTileUrls = useMemo(
    () => uniqueStrings([
      ...visibleTileUrls,
      ...buildMapTilePrefetchUrls(locatedFriends, currentLocation, tileZoom, activeTileKinds),
    ]).slice(0, MAX_PREFETCH_TILE_URLS),
    [visibleTileUrls, locatedFriends, currentLocation?.lat, currentLocation?.lng, tileZoom, activeTileKinds],
  );
  const selectedCluster = selectedClusterKey
    ? markerClusters.find((cluster) => cluster.key === selectedClusterKey && cluster.friends.length > 1) ?? null
    : null;
  useEffect(() => {
    if (!selectedClusterKey) return;
    if (!markerClusters.some((cluster) => cluster.key === selectedClusterKey && cluster.friends.length > 1)) setSelectedClusterKey(null);
  }, [markerClusters, selectedClusterKey]);

  useEffect(() => {
    if (!prefetchTileUrls.length) return;
    let cancelled = false;
    const cancelIdle = scheduleIdleWork(() => {
      if (!cancelled) scheduleMapTilePrefetch(prefetchTileUrls);
    }, MAP_PREFETCH_IDLE_TIMEOUT_MS);
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [prefetchTileUrls]);

  const adjustZoom = useCallback((delta: number) => {
    setView((current) => ({ ...current, zoom: clamp(current.zoom + delta, 1, 19), key: 'manual' }));
  }, []);

  const startGesture = useCallback(() => {
    const points = [...activePointersRef.current.values()];
    if (!points.length) { gestureRef.current = null; return; }
    const midpoint = points.length > 1 ? midpointOf(points[0], points[1]) : points[0];
    gestureRef.current = {
      center: viewRef.current.center,
      zoom: viewRef.current.zoom,
      midpoint,
      distance: points.length > 1 ? distanceBetween(points[0], points[1]) : 0,
    };
  }, []);

  const applyGesture = useCallback(() => {
    const gesture = gestureRef.current;
    const points = [...activePointersRef.current.values()];
    if (!gesture || !points.length) return;
    const midpoint = points.length > 1 ? midpointOf(points[0], points[1]) : points[0];
    const nextZoom = points.length > 1 && gesture.distance > 8
      ? clamp(gesture.zoom + Math.log2(distanceBetween(points[0], points[1]) / gesture.distance), 1, 19)
      : gesture.zoom;
    const dx = midpoint.x - gesture.midpoint.x;
    const dy = midpoint.y - gesture.midpoint.y;
    const centerPx = project(gesture.center, nextZoom);
    setView({
      center: unproject({ x: centerPx.x - dx, y: centerPx.y - dy }, nextZoom),
      zoom: nextZoom,
      key: 'manual',
    });
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    startGesture();
  }, [startGesture]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    event.preventDefault();
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    applyGesture();
  }, [applyGesture]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    startGesture();
  }, [startGesture]);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    adjustZoom(clamp(-event.deltaY / 420, -0.65, 0.65));
  }, [adjustZoom]);

  const userPinStyle = currentLocation
    ? (view.key === 'manual' ? markerStyle(currentLocation, view.center, zoom, mapSize) : { left: mapSize.width / 2, top: mapSize.height / 2 })
    : null;

  return (
    <div
      ref={ref}
      data-canact-map="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onWheel={handleWheel}
      className={`relative touch-none overflow-hidden overscroll-contain bg-[#FFF8F8] cursor-grab active:cursor-grabbing ${className ?? 'h-[58svh] min-h-[390px] max-h-[620px]'}`}
    >
      {renderLightLayer ? <TileLayer tiles={viewport.tiles} kind="light" opacity={lightLayerOpacity} scale={tileScale} viewportSize={tileViewportSize} /> : null}
      {renderSatelliteLayer ? <TileLayer tiles={viewport.tiles} kind="satellite" opacity={satelliteOpacity} scale={tileScale} viewportSize={tileViewportSize} /> : null}
      <div className="pointer-events-none absolute inset-0 bg-[#FFF8F8]/10" />

      {userPinStyle ? (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand px-2 py-1 text-[10px] font-extrabold text-white shadow-sm"
          style={userPinStyle}
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
        <div className="absolute left-4 right-4 top-1/2 z-30 -translate-y-1/2 rounded-3xl border border-white/80 bg-white/90 px-4 py-5 text-center backdrop-blur">
          <div className="text-sm font-extrabold text-ink">{emptyTitle}</div>
          <div className="mt-1 text-xs font-semibold text-ink/55">{emptyBody}</div>
        </div>
      ) : null}

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
  const className = 'absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-1 transition duration-200 active:scale-95';
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
  const panel = (
    <div
      className="fixed bottom-[var(--canact-floating-bottom-clearance)] left-3 right-3 z-[110] mx-auto max-w-sm overflow-hidden rounded-[28px] border border-[#F1D7DC] bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.18)] lg:bottom-5"
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

  if (typeof document === 'undefined') return panel;
  return createPortal(panel, document.body);
}

function TileLayer({ tiles, kind, opacity, scale, viewportSize }: { tiles: Tile[]; kind: MapTileKind; opacity: number; scale: number; viewportSize: Size }) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 transition-opacity duration-500 ease-out"
      style={{
        opacity: kind === 'light' ? opacity * 0.72 : opacity,
        width: viewportSize.width,
        height: viewportSize.height,
        filter: kind === 'light' ? 'grayscale(1) sepia(1) saturate(2.8) hue-rotate(315deg) contrast(1.12) brightness(1.06)' : undefined,
        transform: `scale(${scale}) translateZ(0)`,
        transformOrigin: 'top left',
        backgroundColor: kind === 'light' ? '#FFF8F8' : undefined,
        mixBlendMode: kind === 'light' ? 'multiply' : 'normal',
      }}
    >
      {tiles.map((tile) => (
        <img
          key={`${kind}:${tile.key}`}
          src={tileUrl(kind, tile.z, tile.x, tile.y)}
          alt=""
          draggable={false}
          decoding="async"
          loading="eager"
          referrerPolicy="no-referrer-when-downgrade"
          className="absolute block select-none bg-[#EEE7DC]"
          style={{
            left: Math.round(tile.left - TILE_OVERLAP / 2),
            top: Math.round(tile.top - TILE_OVERLAP / 2),
            width: TILE_SIZE + TILE_OVERLAP,
            height: TILE_SIZE + TILE_OVERLAP,
          }}
          onError={(event) => {
            if (event.currentTarget.dataset.fallback) return;
            event.currentTarget.dataset.fallback = '1';
            event.currentTarget.src = osmTileUrl(tile.z, tile.x, tile.y);
          }}
        />
      ))}
    </div>
  );
}

function useElementSize() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) });
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);
  return { ref, size };
}

function buildTileViewport(center: Point, zoom: number, size: Size) {
  const centerPx = project(center, zoom);
  const originX = centerPx.x - size.width / 2;
  const originY = centerPx.y - size.height / 2;
  const minTileX = Math.floor(originX / TILE_SIZE) - 1;
  const maxTileX = Math.floor((originX + size.width) / TILE_SIZE) + 1;
  const minTileY = Math.max(0, Math.floor(originY / TILE_SIZE) - 1);
  const maxTileY = Math.min(2 ** zoom - 1, Math.floor((originY + size.height) / TILE_SIZE) + 1);
  const tiles: Tile[] = [];
  for (let x = minTileX; x <= maxTileX; x += 1) {
    for (let y = minTileY; y <= maxTileY; y += 1) {
      const wrappedX = wrap(x, 2 ** zoom);
      tiles.push({ key: `${zoom}:${wrappedX}:${y}:${x}`, z: zoom, x: wrappedX, y, left: x * TILE_SIZE - originX, top: y * TILE_SIZE - originY });
    }
  }
  return { tiles };
}

function buildTileUrls(tiles: Tile[], kinds: MapTileKind[]) {
  const urls: string[] = [];
  for (const tile of tiles) {
    for (const kind of kinds) urls.push(tileUrl(kind, tile.z, tile.x, tile.y));
  }
  return urls;
}

function buildMapTilePrefetchUrls(friends: LocatedFriend[], currentLocation: Point | null | undefined, tileZoom: number, kinds: MapTileKind[]) {
  const points: Point[] = [...friends];
  if (currentLocation) points.unshift(currentLocation);
  if (!points.length) return [];
  const prefetchZooms = uniqueNumbers([
    clamp(Math.floor(tileZoom), 3, 18),
    clamp(Math.floor(tileZoom) + 1, 3, 18),
    clamp(Math.max(5, Math.floor(tileZoom)), 5, 18),
  ]);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const point of points) {
    for (const zoom of prefetchZooms) {
      const centerTile = pointToTile(point, zoom);
      for (let tileXOffset = -1; tileXOffset <= 1; tileXOffset += 1) {
        for (let tileYOffset = -1; tileYOffset <= 1; tileYOffset += 1) {
          const tileX = wrap(centerTile.x + tileXOffset, 2 ** zoom);
          const tileY = centerTile.y + tileYOffset;
          if (tileY < 0 || tileY >= 2 ** zoom) continue;
          for (const kind of kinds) {
            const url = tileUrl(kind, zoom, tileX, tileY);
            if (seen.has(url)) continue;
            seen.add(url);
            urls.push(url);
            if (urls.length >= MAX_PREFETCH_TILE_URLS) return urls;
          }
        }
      }
    }
  }
  return urls;
}

function pointToTile(point: Point, zoom: number) {
  const pixel = project(point, zoom);
  return {
    x: Math.floor(pixel.x / TILE_SIZE),
    y: clamp(Math.floor(pixel.y / TILE_SIZE), 0, 2 ** zoom - 1),
  };
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value)))];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function buildMarkerClusters(friends: LocatedFriend[], center: Point, zoom: number, size: Size): MarkerCluster[] {
  const clusters: MarkerCluster[] = [];
  friends.forEach((friend) => {
    const screen = markerScreenPoint(friend, center, zoom, size);
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

function markerStyle(point: Point, center: Point, zoom: number, size: Size) {
  const screen = markerScreenPoint(point, center, zoom, size);
  return { left: screen.x, top: screen.y };
}

function markerScreenPoint(point: Point, center: Point, zoom: number, size: Size): ScreenPoint {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const centerPx = project(center, zoom);
  const markerPx = project(point, zoom);
  let dx = markerPx.x - centerPx.x;
  if (dx > worldSize / 2) dx -= worldSize;
  if (dx < -worldSize / 2) dx += worldSize;
  return { x: size.width / 2 + dx, y: size.height / 2 + (markerPx.y - centerPx.y) };
}

function project(point: Point, zoom: number) {
  const lat = clamp(point.lat, -85, 85);
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function unproject(pixel: { x: number; y: number }, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const y = clamp(pixel.y / scale, 0.000001, 0.999999);
  const n = Math.PI - 2 * Math.PI * y;
  return {
    lat: clamp((180 / Math.PI) * Math.atan(Math.sinh(n)), -85, 85),
    lng: (wrap(pixel.x, scale) / scale) * 360 - 180,
  };
}

function fitMapView(friends: FriendMapPerson[], currentLocation?: Point | null): MapView {
  if (currentLocation) {
    return { center: currentLocation, zoom: DEFAULT_USER_ZOOM, key: `me:${currentLocation.lat.toFixed(4)},${currentLocation.lng.toFixed(4)}` };
  }
  const points = friends.map((friend) => ({ lat: friend.lat!, lng: friend.lng! }));
  if (points.length === 0) return { center: DEFAULT_CENTER, zoom: 1.4, key: 'world' };

  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spread = Math.max(maxLat - minLat, maxLng - minLng);
  const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
  const zoom = spread > 120 ? 1.25 : spread > 70 ? 1.75 : spread > 35 ? 2.35 : spread > 18 ? 3 : spread > 8 ? 3.55 : 4.05;
  return { center, zoom, key: points.map((point) => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`).join('|') };
}

function hasLocation(friend: FriendMapPerson): friend is LocatedFriend {
  return typeof friend.lat === 'number' && Number.isFinite(friend.lat) && typeof friend.lng === 'number' && Number.isFinite(friend.lng);
}

function mapLocationLabel(friend: FriendMapPerson) {
  const place = [friend.city, friend.country].filter(Boolean).join(', ');
  if (friend.locationSource === 'city') return place ? `Selected city · ${place}` : 'Selected city';
  return place || 'Live location';
}

function tileUrl(kind: MapTileKind, z: number, x: number, y: number) {
  if (kind === 'satellite') return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  return `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
}

function osmTileUrl(z: number, x: number, y: number) {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function scheduleMapTilePrefetch(urls: string[]) {
  if (typeof window === 'undefined') return;
  const nextUrls = takeFreshPrefetchUrls(urls);
  if (!nextUrls.length) return;
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    controller.postMessage({ type: 'PREFETCH_MAP_TILES', urls: nextUrls });
    return;
  }
  void prefetchMapTileUrls(nextUrls);
}

function takeFreshPrefetchUrls(urls: string[]) {
  const nextUrls: string[] = [];
  for (const url of urls) {
    if (prefetchedTileUrls.has(url)) continue;
    prefetchedTileUrls.add(url);
    nextUrls.push(url);
  }
  return nextUrls;
}

function scheduleIdleWork(callback: () => void, timeout: number) {
  if (typeof window === 'undefined') return () => {};
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const id = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(callback, 450);
  return () => window.clearTimeout(id);
}

async function prefetchMapTileUrls(urls: string[]) {
  if (typeof window === 'undefined') return;
  const cache = 'caches' in window ? await caches.open(MAP_TILE_CACHE).catch(() => null) : null;
  let index = 0;
  const concurrency = Math.min(getMapPrefetchConcurrency(), urls.length);
  const worker = async () => {
    while (index < urls.length) {
      const url = urls[index];
      index += 1;
      if (!url) continue;
      await prefetchOneMapTile(url, cache);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function prefetchOneMapTile(url: string, cache: Cache | null) {
  const request = new Request(url, { mode: 'no-cors', credentials: 'omit', cache: 'force-cache' });
  try {
    if (cache) {
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return;
    }
    const response = await fetch(request);
    if (cache && response && (response.ok || response.type === 'opaque')) await cache.put(request, response.clone());
  } catch {
    // Best-effort prefetch only.
  }
}

function getMapPrefetchConcurrency() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData) return 1;
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return 1;
  if (connection?.effectiveType === '3g') return 2;
  return 4;
}

function midpointOf(a: ScreenPoint, b: ScreenPoint): ScreenPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distanceBetween(a: ScreenPoint, b: ScreenPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function wrap(value: number, max: number) {
  return ((value % max) + max) % max;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(edge0: number, edge1: number, value: number) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}