'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import type { GeoJSONSource, MapGeoJSONFeature } from 'maplibre-gl';
import type { FeatureCollection, Point as GeoJSONPoint } from 'geojson';
import type { FriendMapPerson } from './FriendsWorldMap';
import styles from './ExploreMap.module.css';

type Point = { lat: number; lng: number };

export type ExploreActivity = Point & {
  id: string;
  kind: 'person' | 'post' | 'story';
  weight?: number;
  href?: string;
};

type ActivityProperties = {
  id: string;
  kind: ExploreActivity['kind'];
  weight: number;
  href: string;
};

export function ExploreMap({
  people,
  currentLocation,
  activities = [],
  onInteraction,
}: {
  people: FriendMapPerson[];
  currentLocation: Point | null;
  activities?: ExploreActivity[];
  onInteraction?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const libraryRef = useRef<typeof import('maplibre-gl') | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const interactionRef = useRef(onInteraction);
  const [ready, setReady] = useState(false);
  interactionRef.current = onInteraction;

  const activityGeoJSON = useMemo<FeatureCollection<GeoJSONPoint, ActivityProperties>>(() => ({
    type: 'FeatureCollection',
    features: activities.map((activity) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [activity.lng, activity.lat] },
      properties: {
        id: activity.id,
        kind: activity.kind,
        weight: Math.max(.15, activity.weight ?? 1),
        href: activity.href ?? '',
      },
    })),
  }), [activities]);

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
        zoom: currentLocation ? 16 : 13,
        attributionControl: false,
        cooperativeGestures: false,
      });
      map.addControl(new library.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new library.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true, showAccuracyCircle: true, showUserLocation: true }), 'top-right');
      map.on('dragstart', () => interactionRef.current?.());
      map.on('zoomstart', () => interactionRef.current?.());
      map.on('rotatestart', () => interactionRef.current?.());
      mapRef.current = map;
      map.once('load', () => setReady(true));
    }).catch(() => undefined);
    return () => {
      disposed = true;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !currentLocation) return;
    map.easeTo({ center: [currentLocation.lng, currentLocation.lat], zoom: Math.max(map.getZoom(), 16), duration: 850 });
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
        filter: ['in', ['get', 'kind'], ['literal', ['post', 'story']]],
        minzoom: 11,
        paint: { 'circle-radius': 12, 'circle-color': 'rgba(250,248,242,.9)', 'circle-blur': .08 },
      });
      map.addLayer({
        id: 'canact-content-pins',
        type: 'circle',
        source: 'canact-activity',
        filter: ['in', ['get', 'kind'], ['literal', ['post', 'story']]],
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
        if (typeof href === 'string' && href) window.location.href = href;
      };
      map.on('click', 'canact-content-pins', openContent);
      map.on('mouseenter', 'canact-content-pins', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'canact-content-pins', () => { map.getCanvas().style.cursor = ''; });
    } else {
      (map.getSource('canact-activity') as GeoJSONSource).setData(activityGeoJSON);
    }
  }, [activityGeoJSON, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const library = libraryRef.current;
    if (!map || !library) return;
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    if (currentLocation) {
      const me = document.createElement('div');
      me.className = styles.meMarker;
      me.setAttribute('aria-label', 'Your current location');
      markersRef.current.push(new library.Marker({ element: me }).setLngLat([currentLocation.lng, currentLocation.lat]).addTo(map));
    }
    for (const person of people) {
      if (typeof person.lat !== 'number' || typeof person.lng !== 'number') continue;
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = styles.personMarker;
      marker.setAttribute('aria-label', `Open ${person.name}`);
      if (person.photoURL) marker.style.backgroundImage = `url(${JSON.stringify(person.photoURL).slice(1, -1)})`;
      else marker.textContent = person.name.slice(0, 1).toUpperCase();
      marker.onclick = () => { window.location.href = `/profile/${encodeURIComponent(person.uid)}`; };
      markersRef.current.push(new library.Marker({ element: marker, anchor: 'bottom' }).setLngLat([person.lng, person.lat]).addTo(map));
    }
  }, [currentLocation?.lat, currentLocation?.lng, people, ready]);

  return <div className={styles.frame} data-canact-map="true"><div ref={containerRef} className={styles.map} /><div className={styles.tint} aria-hidden="true" /></div>;
}
