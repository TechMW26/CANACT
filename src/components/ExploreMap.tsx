'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LayerSpecification, MapGeoJSONFeature } from 'maplibre-gl';
import type { ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection, Point as GeoJSONPoint } from 'geojson';
import type { FriendMapPerson } from './FriendsWorldMap';
import { MapPin } from '@/components/icons';
import { haversineMeters } from '@/lib/utils';
import styles from './ExploreMap.module.css';

type Point = { lat: number; lng: number };

export type ExploreActivity = Point & {
  id: string;
  kind: 'person' | 'post' | 'story' | 'poll' | 'reel';
  weight?: number;
  href?: string;
  authorUid?: string;
  authorName?: string;
  label?: string;
  createdAt?: number;
  expiresAt?: number;
  commentCount?: number;
  /** Thumbnail URL for the pin image. Shown as a round avatar on the map. */
  thumbUrl?: string;
  /** Border color for the pin. Defaults based on kind if not set. */
  color?: string;
};

type ActivityProperties = {
  id: string;
  kind: ExploreActivity['kind'];
  weight: number;
  href: string;
  thumbUrl: string;
  color: string;
};

type LocatedPerson = FriendMapPerson & Point;
type PersonCluster = { id: string; people: LocatedPerson[]; center: Point };
type MapPopup =
  | { mode: 'people'; people: LocatedPerson[] }
  | { mode: 'content'; person: LocatedPerson; activities: ExploreActivity[] };

const MAP_CONTENT_TTL = 24 * 3600 * 1000;
const SAME_LOCATION_METERS = 1;
const MARKER_CLUSTER_PIXELS = 52;
const MAP_PITCH = 55;
const MAP_MAX_PITCH = 65;
const MAP_BEARING = -16;
const BUILDING_LAYER_ID = 'canact-3d-buildings';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let contentPinSequence = 0;

function addThreeDimensionalBuildings(map: maplibregl.Map) {
  if (map.getLayer(BUILDING_LAYER_ID)) return;
  const layers = map.getStyle().layers ?? [];
  const sourceLayer = layers.find((layer) => (
    'source-layer' in layer
    && layer['source-layer'] === 'building'
    && 'source' in layer
    && typeof layer.source === 'string'
  ));
  if (!sourceLayer || !('source' in sourceLayer) || typeof sourceLayer.source !== 'string' || !('source-layer' in sourceLayer)) return;
  const firstLabel = layers.find((layer) => layer.type === 'symbol' && !!layer.layout?.['text-field']);
  const height: ExpressionSpecification = [
    'coalesce',
    ['to-number', ['get', 'render_height']],
    ['to-number', ['get', 'height']],
    ['*', ['to-number', ['get', 'levels']], 3],
    6,
  ];
  const base: ExpressionSpecification = [
    'coalesce',
    ['to-number', ['get', 'render_min_height']],
    ['to-number', ['get', 'min_height']],
    0,
  ];

  const buildingLayer: LayerSpecification = {
    id: BUILDING_LAYER_ID,
    type: 'fill-extrusion',
    source: sourceLayer.source,
    'source-layer': sourceLayer['source-layer'],
    minzoom: 14,
    paint: {
      'fill-extrusion-color': [
        'interpolate', ['linear'], height,
        0, '#dce8e0',
        20, '#b8cdbf',
        80, '#789b87',
      ],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, height],
      'fill-extrusion-base': base,
      'fill-extrusion-opacity': 0.82,
      'fill-extrusion-vertical-gradient': true,
    },
  };
  map.addLayer(buildingLayer, firstLabel?.id);
}

function isLocatedPerson(person: FriendMapPerson): person is LocatedPerson {
  return typeof person.lat === 'number' && typeof person.lng === 'number';
}

function visualOverlapMeters(a: Point, b: Point, zoom: number) {
  const latitude = (a.lat + b.lat) / 2;
  const metersPerPixel = (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / (2 ** zoom);
  return Math.max(2, metersPerPixel * MARKER_CLUSTER_PIXELS);
}

function projectedPixel(point: Point, zoom: number) {
  const worldSize = 256 * (2 ** zoom);
  const latitude = Math.max(-85.051129, Math.min(85.051129, point.lat));
  const sinLatitude = Math.sin(latitude * Math.PI / 180);
  return {
    x: ((point.lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI)) * worldSize,
  };
}

function clusterPeople(people: FriendMapPerson[], zoom: number): PersonCluster[] {
  const located = people.filter(isLocatedPerson);
  if (!located.length) return [];

  const parent = located.map((_, index) => index);
  const rank = located.map(() => 0);
  const buckets = new Map<string, number[]>();
  const worldSize = 256 * (2 ** zoom);
  const maxLatitude = Math.min(85.051129, Math.max(...located.map((person) => Math.abs(person.lat))));
  const minimumMetersPerPixel = (156543.03392 * Math.cos((maxLatitude * Math.PI) / 180)) / (2 ** zoom);
  const bucketSize = Math.max(MARKER_CLUSTER_PIXELS, 2 / Math.max(minimumMetersPerPixel, 0.001));
  const bucketColumns = Math.max(1, Math.ceil(worldSize / bucketSize));
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number) => {
    let leftRoot = find(left);
    let rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    if (rank[leftRoot] < rank[rightRoot]) [leftRoot, rightRoot] = [rightRoot, leftRoot];
    parent[rightRoot] = leftRoot;
    if (rank[leftRoot] === rank[rightRoot]) rank[leftRoot] += 1;
  };

  located.forEach((person, index) => {
    const projected = projectedPixel(person, zoom);
    const cellX = ((Math.floor(projected.x / bucketSize) % bucketColumns) + bucketColumns) % bucketColumns;
    const cellY = Math.floor(projected.y / bucketSize);
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      const wrappedX = ((cellX + xOffset) % bucketColumns + bucketColumns) % bucketColumns;
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const candidates = buckets.get(`${wrappedX}:${cellY + yOffset}`);
        if (!candidates) continue;
        for (const candidateIndex of candidates) {
          const candidate = located[candidateIndex];
          if (haversineMeters(candidate, person) <= visualOverlapMeters(candidate, person, zoom)) {
            union(candidateIndex, index);
          }
        }
      }
    }
    const key = `${cellX}:${cellY}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  const groups = new Map<number, LocatedPerson[]>();
  located.forEach((person, index) => {
    const root = find(index);
    const group = groups.get(root);
    if (group) group.push(person);
    else groups.set(root, [person]);
  });

  return Array.from(groups.values()).map((members) => ({
      id: members.map((person) => person.uid).sort().join(':'),
      people: members,
      center: {
        lat: members.reduce((sum, person) => sum + person.lat, 0) / members.length,
        lng: members.reduce((sum, person) => sum + person.lng, 0) / members.length,
      },
    }));
}

function createContentPinGraphic(color: string, thumbnail?: string) {
  const clipId = `canact-map-pin-${contentPinSequence += 1}`;
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '56');
  svg.setAttribute('viewBox', '-2 -2 44 56');
  svg.setAttribute('overflow', 'visible');

  const path = document.createElementNS(SVG_NAMESPACE, 'path');
  path.setAttribute('d', 'M20 0C8.95 0 0 8.95 0 20c0 11.05 20 32 20 32s20-20.95 20-32C40 8.95 31.05 0 20 0z');
  path.setAttribute('fill', '#fff');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '3');
  svg.appendChild(path);

  if (thumbnail) {
    const defs = document.createElementNS(SVG_NAMESPACE, 'defs');
    const clip = document.createElementNS(SVG_NAMESPACE, 'clipPath');
    clip.setAttribute('id', clipId);
    const clipCircle = document.createElementNS(SVG_NAMESPACE, 'circle');
    clipCircle.setAttribute('cx', '20');
    clipCircle.setAttribute('cy', '18');
    clipCircle.setAttribute('r', '16');
    clip.appendChild(clipCircle);
    defs.appendChild(clip);
    svg.prepend(defs);

    const image = document.createElementNS(SVG_NAMESPACE, 'image');
    image.setAttribute('href', thumbnail);
    image.setAttribute('x', '4');
    image.setAttribute('y', '2');
    image.setAttribute('width', '32');
    image.setAttribute('height', '32');
    image.setAttribute('clip-path', `url(#${clipId})`);
    image.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.appendChild(image);
  } else {
    const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
    circle.setAttribute('cx', '20');
    circle.setAttribute('cy', '18');
    circle.setAttribute('r', '10');
    circle.setAttribute('fill', color);
    svg.appendChild(circle);
  }

  return svg;
}

export function ExploreMap({
  people,
  currentLocation,
  activities = [],
  onInteraction,
  preview = false,
  myPhotoURL,
  onActivityClick,
  friendUids,
  favouriteUids,
}: {
  people: FriendMapPerson[];
  currentLocation: Point | null;
  activities?: ExploreActivity[];
  onInteraction?: () => void;
  preview?: boolean;
  /** Current user's profile photo — shown as their map pin with a distinct gold border. */
  myPhotoURL?: string | null;
  /** Called when a content activity (post/story/reel/poll) is tapped. Return true to prevent default navigation. */
  onActivityClick?: (activity: ExploreActivity) => boolean | void;
  /** UIDs of friends — shown with green ring, never blurred. */
  friendUids?: Set<string>;
  /** UIDs of favourites — shown with gold ring, never blurred. */
  favouriteUids?: Set<string>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libraryRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const interactionRef = useRef(onInteraction);
  const onActivityClickRef = useRef(onActivityClick);
  const locationRef = useRef(currentLocation);
  const router = useRouter();
  const routerRef = useRef(router);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [popup, setPopup] = useState<MapPopup | null>(null);
  const [mapZoom, setMapZoom] = useState(() => currentLocation ? 20 : 13);
  const hasCurrentLocation = currentLocation !== null;
  interactionRef.current = onInteraction;
  onActivityClickRef.current = onActivityClick;
  locationRef.current = currentLocation;
  routerRef.current = router;

  const openActivityHref = useCallback((href: string) => {
    if (!href) return;
    let path = href;
    try { path = new URL(href, window.location.href).pathname; } catch { /* use the supplied path */ }
    const event = new CustomEvent('canact:open-detail', {
      cancelable: true,
      detail: { path },
    });
    if (!window.dispatchEvent(event)) return;
    routerRef.current.push(href);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!popup) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setPopup(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [popup]);

  const recentContent = useMemo(() => activities.filter((activity) =>
    activity.kind !== 'person'
    && typeof activity.createdAt === 'number'
    && clock - activity.createdAt <= MAP_CONTENT_TTL,
  ).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)), [activities, clock]);
  const locatedPeople = useMemo(() => people.filter(isLocatedPerson), [people]);
  const personClusters = useMemo(() => clusterPeople(locatedPeople, mapZoom), [locatedPeople, mapZoom]);
  const indexedContent = useMemo(() => {
    const peopleByUid = new Map(locatedPeople.map((person) => [person.uid, person]));
    const byPerson = new Map<string, ExploreActivity[]>();
    const detached: ExploreActivity[] = [];
    for (const activity of recentContent) {
      const author = activity.authorUid ? peopleByUid.get(activity.authorUid) : undefined;
      if (!author || haversineMeters(author, activity) > SAME_LOCATION_METERS) {
        detached.push(activity);
        continue;
      }
      const local = byPerson.get(author.uid);
      if (local) local.push(activity);
      else byPerson.set(author.uid, [activity]);
    }
    return { byPerson, detached };
  }, [locatedPeople, recentContent]);
  const contentForPerson = indexedContent.byPerson;
  const detachedContent = indexedContent.detached;
  const mapActivities = useMemo(() => [
    ...activities.filter((activity) => activity.kind === 'person'),
    ...detachedContent,
  ], [activities, detachedContent]);

  const activityGeoJSON = useMemo<FeatureCollection<GeoJSONPoint, ActivityProperties>>(() => ({
    type: 'FeatureCollection',
    features: mapActivities.map((activity) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [activity.lng, activity.lat] },
      properties: {
        id: activity.id,
        kind: activity.kind,
        weight: Math.max(.15, activity.weight ?? 1),
        href: activity.href ?? '',
        thumbUrl: activity.thumbUrl ?? '',
        color: activity.color ?? (activity.kind === 'story' ? '#f2b72e' : activity.kind === 'post' ? '#1f6b55' : '#8ce2b0'),
      },
    })),
  }), [mapActivities]);
  const peopleDensityGeoJSON = useMemo<FeatureCollection<GeoJSONPoint, ActivityProperties>>(() => ({
    type: 'FeatureCollection',
    features: locatedPeople.map((person) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [person.lng, person.lat] },
      properties: { id: person.uid, kind: 'person', weight: 1, href: '', thumbUrl: '', color: '#1f6b55' },
    })),
  }), [locatedPeople]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current || !currentLocation) return;
    let disposed = false;
    let recenterTimer: ReturnType<typeof setTimeout> | null = null;
    import('maplibre-gl').then((library) => {
      if (disposed || !containerRef.current) return;
      libraryRef.current = library;
      const center: [number, number] = [currentLocation.lng, currentLocation.lat];
      const map = new library.Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/bright',
        center,
        zoom: 20,
        pitch: MAP_PITCH,
        bearing: MAP_BEARING,
        maxPitch: MAP_MAX_PITCH,
        attributionControl: false,
        cooperativeGestures: false,
        interactive: !preview,
      });
      map.on('zoomend', () => { if (!disposed) setMapZoom(map.getZoom()); });
      if (!preview) {
        map.addControl(new library.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-right');
        // Keep the familiar locate control, but do not let MapLibre render or
        // continuously track a second raw GPS marker. The Canact marker below
        // is driven by the shared accuracy-weighted location filter.
        map.addControl(new library.GeolocateControl({
          positionOptions: { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
          trackUserLocation: false,
          showAccuracyCircle: false,
          showUserLocation: false,
        }), 'top-right');
        map.on('dragstart', () => interactionRef.current?.());
        map.on('zoomstart', () => interactionRef.current?.());
        map.on('rotatestart', () => interactionRef.current?.());

        // Re-center on user pin after 3 seconds of inactivity
        const scheduleRecenter = () => {
          if (recenterTimer) clearTimeout(recenterTimer);
          recenterTimer = setTimeout(() => {
            const loc = locationRef.current;
            if (loc) {
              map.easeTo({ center: [loc.lng, loc.lat], zoom: 20, duration: 600, padding: { top: 140, bottom: 220, left: 32, right: 32 } });
            }
          }, 3000);
        };
        map.on('dragend', scheduleRecenter);
        map.on('zoomend', scheduleRecenter);
        map.on('rotateend', scheduleRecenter);
      }
      mapRef.current = map;
      let resizeFrame = 0;
      const resizeObserver = new ResizeObserver(() => {
        if (resizeFrame) return;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = 0;
          map.resize();
        });
      });
      resizeObserver.observe(containerRef.current);
      map.once('load', () => {
        try {
          addThreeDimensionalBuildings(map);
        } catch (error) {
          console.warn('[ExploreMap] 3D buildings are unavailable for this map style.', error);
        }
        map.resize();
        setReady(true);
      });
      map.once('error', () => { if (!map.loaded()) setLoadError(true); });

      // Suppress missing sprite warnings from the free tile style (reservoir, gate, lift_gate, etc.)
      map.on('styleimagemissing', (e) => {
        const id = e.id;
        const size = id.includes('gate') ? 22 : 16;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#aaa';
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
          ctx.fill();
        }
        const img = new Image(size, size);
        img.src = canvas.toDataURL();
        img.onload = () => { if (!map.hasImage(id)) map.addImage(id, img); };
      });
      map.once('remove', () => {
        resizeObserver.disconnect();
        if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      });
    }).catch(() => setLoadError(true));
    return () => {
      disposed = true;
      if (recenterTimer) clearTimeout(recenterTimer);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [preview, hasCurrentLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentLocation) return;
    // Padding offsets the center so the pin lands in the visual middle
    // of the screen, not the geometric center of the map div (which sits
    // behind the header greeting and the bottom people sheet).
    map.stop();
    map.easeTo({
      center: [currentLocation.lng, currentLocation.lat],
      zoom: 20,
      duration: preview ? 0 : 450,
      padding: { top: 140, bottom: 220, left: 32, right: 32 },
      essential: false,
    });
  }, [currentLocation?.lat, currentLocation?.lng, preview, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getSource('canact-people-density')) {
      map.addSource('canact-people-density', { type: 'geojson', data: peopleDensityGeoJSON });
      map.addLayer({
        id: 'canact-people-density-heat',
        type: 'heatmap',
        source: 'canact-people-density',
        maxzoom: 22,
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, .7, 15, 1.35, 20, 1.8],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 24, 15, 52, 20, 72],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, .42, 15, .68, 20, .62, 22, .45],
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(62,130,246,0)',
            .08, 'rgba(62,130,246,.38)',
            .28, 'rgba(53,168,83,.48)',
            .5, 'rgba(244,211,71,.58)',
            .72, 'rgba(242,145,34,.70)',
            1, 'rgba(218,58,49,.82)',
          ],
        },
      });
    } else {
      (map.getSource('canact-people-density') as GeoJSONSource).setData(peopleDensityGeoJSON);
    }
    if (!map.getSource('canact-activity')) {
      map.addSource('canact-activity', { type: 'geojson', data: activityGeoJSON });
      map.addLayer({
        id: 'canact-content-pins-halo',
        type: 'circle',
        source: 'canact-activity',
        filter: ['!=', ['get', 'kind'], 'person'],
        minzoom: 11,
        paint: { 'circle-radius': 12, 'circle-color': 'rgba(250,248,242,.9)', 'circle-blur': .08 },
      });
      map.addLayer({
        id: 'canact-content-pins',
        type: 'circle',
        source: 'canact-activity',
        filter: ['!=', ['get', 'kind'], 'person'],
        minzoom: 11,
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'kind'], 'story', '#f2b72e', '#1f6b55'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fffdf7',
        },
      });
      const openContent = (event: maplibregl.MapMouseEvent & { features?: MapGeoJSONFeature[] }) => {
        const props = event.features?.[0]?.properties;
        const id = props?.id as string | undefined;
        const href = props?.href as string | undefined;
        const kind = props?.kind as string | undefined;
        if (onActivityClickRef.current?.({ id, kind, href } as ExploreActivity)) return;
        if (typeof href === 'string' && href) openActivityHref(href);
      };
      map.on('click', 'canact-content-pins', openContent);
      map.on('mouseenter', 'canact-content-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'canact-content-pins', () => { map.getCanvas().style.cursor = ''; });
    } else {
      (map.getSource('canact-activity') as GeoJSONSource).setData(activityGeoJSON);
    }
  }, [activityGeoJSON, openActivityHref, peopleDensityGeoJSON, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (currentLocation) {
      const me = document.createElement('div');
      if (myPhotoURL) {
        // Show profile photo with gold border — same style as friends but distinct color
        me.style.cssText = `
          width: 44px; height: 44px;
          border-radius: 50%;
          border: 4px solid #E8B830;
          background-size: cover;
          background-position: center;
          box-shadow: 0 0 0 8px rgba(232,184,48,0.2), 0 8px 20px rgba(17,40,34,0.25);
        `;
        me.style.backgroundImage = `url(${JSON.stringify(myPhotoURL)})`;
      } else {
        me.className = styles.meMarker;
      }
      me.setAttribute('aria-label', 'Your current location');
      if (!preview && myPhotoURL) {
        me.style.cursor = 'pointer';
        me.onclick = () => { routerRef.current.push('/profile'); };
      }
      markersRef.current.push(new library.Marker({ element: me, anchor: 'bottom' }).setLngLat([currentLocation.lng, currentLocation.lat]).addTo(map));
    }
    const openPerson = (person: LocatedPerson) => {
      const localContent = contentForPerson.get(person.uid) ?? [];
      if (localContent.length) setPopup({ mode: 'content', person, activities: localContent });
      else routerRef.current.push(`/profile/${encodeURIComponent(person.uid)}`);
    };
    for (const cluster of personClusters) {
      const person = cluster.people[0];
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = styles.personMarker;
      const isFriend = friendUids?.has(person.uid) ?? false;
      const isFavourite = favouriteUids?.has(person.uid) ?? false;
      const outsideImmediateRadius = (isFriend || isFavourite) ? false : (currentLocation
        ? cluster.people.every((entry) => haversineMeters(currentLocation, entry) > 15)
        : false);
      marker.dataset.outsideRadius = String(outsideImmediateRadius);
      marker.dataset.friend = String(isFriend);
      marker.dataset.favourite = String(isFavourite);
      marker.dataset.hasLocalContent = String(cluster.people.some((entry) => (contentForPerson.get(entry.uid)?.length ?? 0) > 0));
      marker.dataset.cluster = String(cluster.people.length > 1);
      marker.setAttribute('aria-label', cluster.people.length > 1 ? `Choose from ${cluster.people.length} people here` : `Open ${person.name}`);
      const portrait = document.createElement('span');
      portrait.className = styles.personMarkerPhoto;
      if (person.photoURL) portrait.style.backgroundImage = `url(${JSON.stringify(person.photoURL)})`;
      else portrait.textContent = person.name.slice(0, 1).toUpperCase();
      marker.appendChild(portrait);
      const localContent = cluster.people.length === 1 ? contentForPerson.get(person.uid)?.[0] : undefined;
      if (localContent && !preview) {
        const activityLabel = document.createElement('span');
        activityLabel.className = styles.personMarkerActivity;
        activityLabel.textContent = localContent.kind === 'post' ? 'New post nearby' : `New ${localContent.kind} nearby`;
        marker.appendChild(activityLabel);
      }
      if (cluster.people.length > 1) {
        const count = document.createElement('span');
        count.className = styles.personMarkerCount;
        count.textContent = String(cluster.people.length);
        marker.appendChild(count);
      }
      if (!preview) marker.onclick = () => {
        if (cluster.people.length > 1) setPopup({ mode: 'people', people: cluster.people });
        else openPerson(person);
      };
      else marker.tabIndex = -1;
      markersRef.current.push(new library.Marker({ element: marker, anchor: 'bottom' }).setLngLat([cluster.center.lng, cluster.center.lat]).addTo(map));
    }
  }, [currentLocation?.lat, currentLocation?.lng, personClusters, contentForPerson, ready, preview]);

  // ── Content pin markers (posts/stories with thumbnails) ──
  const contentMarkersRef = useRef<maplibregl.Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library) return;
    // Clear previous content markers
    contentMarkersRef.current.forEach((m) => m.remove());
    contentMarkersRef.current = [];

    const contentActivities = detachedContent;
    for (const activity of contentActivities) {
      const color = activity.color ?? (activity.kind === 'story' ? '#f2b72e' : '#1f6b55');
      const thumb = activity.thumbUrl;

      const el = document.createElement('button');
      el.type = 'button';
      el.setAttribute('aria-label', `Open ${activity.kind}`);
      // Location-pin shape: round top + pointed bottom via CSS clip-path or SVG
      el.style.cssText = `
        width: 44px; height: 56px;
        overflow: visible;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
        transition: transform 0.15s ease;
        filter: drop-shadow(0 2px 8px rgba(0,0,0,0.22));
      `;

      el.appendChild(createContentPinGraphic(color, thumb));
      if (!preview) {
        el.onpointerdown = (event) => event.stopPropagation();
        el.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          el.blur();
          if (onActivityClick?.(activity)) return;
          if (activity.href) openActivityHref(activity.href);
        };
        el.onmouseenter = () => { el.style.transform = 'scale(1.12)'; };
        el.onmouseleave = () => { el.style.transform = 'scale(1)'; };
      }
      contentMarkersRef.current.push(
        new library.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([activity.lng, activity.lat])
          .addTo(map),
      );
    }
    return () => {
      contentMarkersRef.current.forEach((m) => m.remove());
    };
  }, [detachedContent, openActivityHref, ready, preview]);

  const openSelectedPerson = (person: LocatedPerson) => {
    const localContent = contentForPerson.get(person.uid) ?? [];
    if (localContent.length) setPopup({ mode: 'content', person, activities: localContent });
    else {
      setPopup(null);
      router.push(`/profile/${encodeURIComponent(person.uid)}`);
    }
  };

  if (!currentLocation) {
    return (
      <div className={styles.frame} data-canact-map="locked">
        <div className={styles.locationGate} role="status" aria-live="polite">
          <MapPin size={25} aria-hidden="true" />
          <strong>Current location required</strong>
          <span>The map stays hidden until your location is available.</span>
        </div>
      </div>
    );
  }

  return <>
    <div className={styles.frame} data-canact-map="true" data-ready={ready}><div ref={containerRef} className={styles.map} /><div className={styles.tint} aria-hidden="true" />{!ready && !loadError ? <div className={styles.mapStatus}>Loading nearby map…</div> : null}{loadError ? <div className={styles.mapStatus}>Map preview unavailable</div> : null}</div>
    {popup && typeof document !== 'undefined' ? createPortal(
      <div className={styles.mapPopupBackdrop} role="presentation" onClick={() => setPopup(null)}>
        <section className={styles.mapPopup} role="dialog" aria-modal="true" aria-label={popup.mode === 'people' ? 'People at this location' : `Posts by ${popup.person.name}`} onClick={(event) => event.stopPropagation()}>
          <span className={styles.mapPopupHandle} aria-hidden="true" />
          <div className={styles.mapPopupHeading}>
            <div>
              <strong>{popup.mode === 'people' ? `${popup.people.length} people here` : `${popup.person.name} posted here`}</strong>
              <span>{popup.mode === 'people' ? 'Choose a profile' : 'Available on the map for 24 hours'}</span>
            </div>
            <button type="button" onClick={() => setPopup(null)} aria-label="Close">×</button>
          </div>
          <div className={styles.mapPopupList}>
            {popup.mode === 'people' ? popup.people.map((person) => (
              <button type="button" key={person.uid} className={styles.mapPopupPerson} onClick={() => openSelectedPerson(person)}>
                <span className={styles.mapPopupAvatar} style={person.photoURL ? { backgroundImage: `url(${person.photoURL})` } : undefined}>{person.photoURL ? '' : person.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{person.name}</strong><small>{(contentForPerson.get(person.uid)?.length ?? 0) ? `${contentForPerson.get(person.uid)?.length} recent post${contentForPerson.get(person.uid)?.length === 1 ? '' : 's'} here` : 'Open profile'}</small></span>
                <b>›</b>
              </button>
            )) : popup.activities.map((activity) => (
              <button type="button" key={activity.id} className={styles.mapPopupContent} onClick={() => { setPopup(null); if (onActivityClick?.(activity)) return; if (activity.href) openActivityHref(activity.href); }}>
                <span className={styles.mapPopupThumb} style={activity.thumbUrl ? { backgroundImage: `url(${activity.thumbUrl})` } : { backgroundColor: activity.color ?? '#1f6b55' }} />
                <span><strong>{activity.label || activity.kind}</strong><small>{activity.kind} · posted here</small></span>
                <b>›</b>
              </button>
            ))}
          </div>
        </section>
      </div>, document.body,
    ) : null}
  </>;
}
