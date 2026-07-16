'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import type maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import type { FeatureCollection, Point as GeoJSONPoint } from 'geojson';
import type { FriendMapPerson } from './FriendsWorldMap';
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
type PersonCluster = { id: string; people: LocatedPerson[] };
type MapPopup =
  | { mode: 'people'; people: LocatedPerson[] }
  | { mode: 'content'; person: LocatedPerson; activities: ExploreActivity[] };

const MAP_CONTENT_TTL = 24 * 3600 * 1000;
const SAME_LOCATION_METERS = 1;
const OVERLAP_METERS = 2;

function isLocatedPerson(person: FriendMapPerson): person is LocatedPerson {
  return typeof person.lat === 'number' && typeof person.lng === 'number';
}

function clusterPeople(people: FriendMapPerson[]): PersonCluster[] {
  const clusters: PersonCluster[] = [];
  for (const person of people.filter(isLocatedPerson)) {
    const cluster = clusters.find((candidate) =>
      haversineMeters(candidate.people[0], person) <= OVERLAP_METERS,
    );
    if (cluster) cluster.people.push(person);
    else clusters.push({ id: person.uid, people: [person] });
  }
  return clusters;
}

export function ExploreMap({
  people,
  currentLocation,
  activities = [],
  onInteraction,
  preview = false,
  myPhotoURL,
}: {
  people: FriendMapPerson[];
  currentLocation: Point | null;
  activities?: ExploreActivity[];
  onInteraction?: () => void;
  preview?: boolean;
  /** Current user's profile photo — shown as their map pin with a distinct gold border. */
  myPhotoURL?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libraryRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const interactionRef = useRef(onInteraction);
  const locationRef = useRef(currentLocation);
  const router = useRouter();
  const routerRef = useRef(router);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const [popup, setPopup] = useState<MapPopup | null>(null);
  interactionRef.current = onInteraction;
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
  ), [activities, clock]);
  const personClusters = useMemo(() => clusterPeople(people), [people]);
  const contentForPerson = useMemo(() => {
    const result = new Map<string, ExploreActivity[]>();
    for (const person of people.filter(isLocatedPerson)) {
      result.set(person.uid, recentContent.filter((activity) =>
        activity.authorUid === person.uid
        && haversineMeters(person, activity) <= SAME_LOCATION_METERS,
      ));
    }
    return result;
  }, [people, recentContent]);
  const detachedContent = useMemo(() => recentContent.filter((activity) => {
    const author = people.filter(isLocatedPerson).find((person) => person.uid === activity.authorUid);
    return !author || haversineMeters(author, activity) > SAME_LOCATION_METERS;
  }), [people, recentContent]);
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let disposed = false;
    import('maplibre-gl').then((library) => {
      if (disposed || !containerRef.current) return;
      libraryRef.current = library;
      const center: [number, number] = currentLocation ? [currentLocation.lng, currentLocation.lat] : [77.209, 28.6139];
      const map = new library.Map({
        container: containerRef.current,
        style: 'https://tiles.openfreemap.org/styles/bright',
        center,
        zoom: currentLocation ? 20 : 13,
        attributionControl: false,
        cooperativeGestures: false,
        interactive: !preview,
      });
      if (!preview) {
        map.addControl(new library.NavigationControl({ showCompass: false }), 'top-right');
        map.addControl(new library.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true, showUserLocation: true }), 'top-right');
        map.on('dragstart', () => interactionRef.current?.());
        map.on('zoomstart', () => interactionRef.current?.());
        map.on('rotatestart', () => interactionRef.current?.());

        // Re-center on user pin after 3 seconds of inactivity
        let recenterTimer: ReturnType<typeof setTimeout> | null = null;
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
      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);
      map.once('load', () => { map.resize(); setReady(true); });
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
      map.once('remove', () => resizeObserver.disconnect());
    }).catch(() => setLoadError(true));
    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [preview]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentLocation) return;
    // Padding offsets the center so the pin lands in the visual middle
    // of the screen, not the geometric center of the map div (which sits
    // behind the header greeting and the bottom people sheet).
    map.easeTo({
      center: [currentLocation.lng, currentLocation.lat],
      zoom: 20,
      duration: 850,
      padding: { top: 140, bottom: 220, left: 32, right: 32 },
    });
  }, [currentLocation?.lat, currentLocation?.lng, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!map.getSource('canact-activity')) {
      map.addSource('canact-activity', { type: 'geojson', data: activityGeoJSON });
      map.addLayer({
        id: 'canact-activity-heat',
        type: 'heatmap',
        source: 'canact-activity',
        maxzoom: 17,
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 3, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, .55, 15, 1.5],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 18, 15, 48],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 7, .45, 16, .72, 17, 0],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(31,107,85,0)', .18, 'rgba(124,166,96,.32)', .42, 'rgba(59,137,72,.55)', .7, 'rgba(20,111,54,.78)', 1, 'rgba(8,73,43,.9)'],
        },
      });
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
        const href = event.features?.[0]?.properties?.href;
        if (typeof href === 'string' && href) openActivityHref(href);
      };
      map.on('click', 'canact-content-pins', openContent);
      map.on('mouseenter', 'canact-content-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'canact-content-pins', () => { map.getCanvas().style.cursor = ''; });
    } else {
      (map.getSource('canact-activity') as GeoJSONSource).setData(activityGeoJSON);
    }
  }, [activityGeoJSON, openActivityHref, ready]);

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
          background-image: url(${JSON.stringify(myPhotoURL).slice(1, -1)});
          background-size: cover;
          background-position: center;
          box-shadow: 0 0 0 8px rgba(232,184,48,0.2), 0 8px 20px rgba(17,40,34,0.25);
        `;
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
      const outsideImmediateRadius = currentLocation
        ? haversineMeters(currentLocation, { lat: person.lat, lng: person.lng }) > 15
        : false;
      marker.dataset.outsideRadius = String(outsideImmediateRadius);
      marker.dataset.hasLocalContent = String(cluster.people.some((entry) => (contentForPerson.get(entry.uid)?.length ?? 0) > 0));
      marker.setAttribute('aria-label', cluster.people.length > 1 ? `Choose from ${cluster.people.length} people here` : `Open ${person.name}`);
      const portrait = document.createElement('span');
      portrait.className = styles.personMarkerPhoto;
      if (person.photoURL) portrait.style.backgroundImage = `url(${JSON.stringify(person.photoURL).slice(1, -1)})`;
      else portrait.textContent = person.name.slice(0, 1).toUpperCase();
      marker.appendChild(portrait);
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
      markersRef.current.push(new library.Marker({ element: marker, anchor: 'bottom' }).setLngLat([person.lng, person.lat]).addTo(map));
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

      // Build location pin shape inline
      const pinSvg = `
        <svg width="44" height="56" viewBox="-2 -2 44 56" overflow="visible" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="pinClip-${activity.id}">
              <circle cx="20" cy="18" r="16"/>
            </clipPath>
          </defs>
          <path d="M20 0C8.95 0 0 8.95 0 20c0 11.05 20 32 20 32s20-20.95 20-32C40 8.95 31.05 0 20 0z" fill="#fff" stroke="${color}" stroke-width="3"/>
          ${thumb ? `<image href="${thumb}" x="4" y="2" width="32" height="32" clip-path="url(#pinClip-${activity.id})" preserveAspectRatio="xMidYMid slice"/>` : `<circle cx="20" cy="18" r="10" fill="${color}"/>`}
        </svg>`;

      el.innerHTML = pinSvg;
      if (!preview) {
        el.onpointerdown = (event) => event.stopPropagation();
        el.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          el.blur();
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
              <button type="button" key={activity.id} className={styles.mapPopupContent} onClick={() => { setPopup(null); if (activity.href) openActivityHref(activity.href); }}>
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
