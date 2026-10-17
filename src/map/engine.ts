/**
 * MapLibre setup: self-hosted Protomaps basemap (PMTiles via /tiles, glyphs and
 * sprites from /map), clustered event markers drawn from the type shapes.
 * Loaded lazily so the filters and the list work before the map is ready.
 */
import { layers, namedFlavor } from '@protomaps/basemaps';
import {
  addProtocol,
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
  type LngLatBoundsLike,
  type StyleSpecification,
} from 'maplibre-gl';
// Linked when the engine loads, so it never blocks the first paint. A file of
// our own (not an inline <style>), so the Content-Security-Policy needs no
// 'unsafe-inline'.
import maplibreCssUrl from 'maplibre-gl/dist/maplibre-gl.css?url';
// The worker is a separate file; Vite copies it and gives us its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { Protocol } from 'pmtiles';
import { MAP_TILES_PATH } from '../config/app';
import { EVENT_TYPES, EVENT_TYPE_KEYS, type EventType } from '../config/event-types';
import { pt } from '../i18n/pt';
import { MAX_BOUNDS, REGIONS, type RegionKey } from './regions';
import { SHAPE_PATHS } from './shapes';

export interface MarkerProps {
  id: string;
  type: EventType;
  /** '24/11' or '' */
  dayLabel: string;
}

export interface MarkerCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: MarkerProps;
  }[];
}

export interface MapEngine {
  setMarkers(fc: MarkerCollection): void;
  fitRegion(region: RegionKey): void;
  /** `offset`: pixels to shift the point from the centre (e.g. above a bottom sheet). */
  focus(lng: number, lat: number, offset?: [number, number]): void;
  showUser(lng: number, lat: number): void;
  flyTo(lng: number, lat: number, zoom: number): void;
  /** Like flyTo without animation (safe right before a resize). */
  jumpTo(lng: number, lat: number, zoom: number): void;
  getCenter(): [number, number];
  resize(): void;
  destroy(): void;
}

const SOURCE = 'events';
const FONT = ['Noto Sans Medium'];
let protocolRegistered = false;

function buildStyle(origin: string): StyleSpecification {
  const base = namedFlavor('light');
  // Outside the tiles extract only the background shows: make it sea, not grey.
  const flavor = { ...base, background: base.water };
  return {
    version: 8,
    glyphs: `${origin}/map/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/map/sprites/light`,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${origin}${MAP_TILES_PATH}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: layers('protomaps', flavor, { lang: 'pt' }),
  };
}

/** Draws a type marker (shape + colour + white outline) at 2× for crisp rendering. */
function markerImage(type: EventType): ImageData {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  const cfg = EVENT_TYPES[type];
  ctx.scale(size / 24, size / 24);
  const path = new Path2D(SHAPE_PATHS[cfg.shape]);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke(path);
  ctx.fillStyle = cfg.color;
  ctx.fill(path);
  return ctx.getImageData(0, 0, size, size);
}

export function createMapEngine(
  container: HTMLElement,
  opts: {
    onSelect: (id: string) => void;
    /** Called with the map centre after every move (used by "escolher ponto"). */
    onMoveEnd?: (center: [number, number]) => void;
    initialBounds?: LngLatBoundsLike;
  },
): MapEngine {
  if (!protocolRegistered) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = maplibreCssUrl;
    document.head.append(link);
    setWorkerUrl(workerUrl);
    addProtocol('pmtiles', new Protocol().tile);
    protocolRegistered = true;
  }

  const map = new MlMap({
    container,
    style: buildStyle(window.location.origin),
    bounds: opts.initialBounds ?? REGIONS.mainland,
    fitBoundsOptions: { padding: 24 },
    maxBounds: MAX_BOUNDS,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

  let pending: MarkerCollection | null = null;
  let loaded = false;
  let userMarker: Marker | null = null;

  map.on('load', () => {
    for (const type of EVENT_TYPE_KEYS) {
      map.addImage(`type-${type}`, markerImage(type), { pixelRatio: 2 });
    }
    map.addSource(SOURCE, {
      type: 'geojson',
      data: pending ?? { type: 'FeatureCollection', features: [] },
      cluster: true,
      clusterRadius: 44,
      clusterMaxZoom: 12,
    });
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#263238',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 50, 26],
      },
    });
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': FONT,
        'text-size': 13,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#ffffff' },
    });
    map.addLayer({
      id: 'event-icons',
      type: 'symbol',
      source: SOURCE,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': ['concat', 'type-', ['get', 'type']],
        'icon-allow-overlap': true,
        'icon-size': 1,
      },
    });
    map.addLayer({
      id: 'event-day-labels',
      type: 'symbol',
      source: SOURCE,
      minzoom: 8,
      filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'dayLabel'], '']],
      layout: {
        'text-field': ['get', 'dayLabel'],
        'text-font': FONT,
        'text-size': 11,
        'text-offset': [0, 1.5],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': '#1a1a1a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    loaded = true;
  });

  map.on('moveend', () => {
    const c = map.getCenter();
    opts.onMoveEnd?.([c.lng, c.lat]);
  });

  map.on('click', 'event-icons', (e) => {
    const id = e.features?.[0]?.properties?.id as unknown;
    if (typeof id === 'string') opts.onSelect(id);
  });
  map.on('click', 'clusters', async (e) => {
    const feature = e.features?.[0];
    const clusterId = feature?.properties?.cluster_id as unknown;
    if (!feature || typeof clusterId !== 'number' || feature.geometry.type !== 'Point') return;
    const zoom = await (map.getSource(SOURCE) as GeoJSONSource).getClusterExpansionZoom(clusterId);
    map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
  });
  for (const layer of ['event-icons', 'clusters']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  return {
    setMarkers(fc) {
      pending = fc;
      if (loaded) (map.getSource(SOURCE) as GeoJSONSource).setData(fc);
    },
    fitRegion(region) {
      map.fitBounds(REGIONS[region], { padding: 24 });
    },
    focus(lng, lat, offset = [0, 0]) {
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), offset });
    },
    showUser(lng, lat) {
      if (!userMarker) {
        const el = document.createElement('div');
        el.className = 'user-dot';
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', pt.map.nearMe);
        userMarker = new Marker({ element: el });
      }
      userMarker.setLngLat([lng, lat]).addTo(map);
      map.easeTo({ center: [lng, lat], zoom: 11 });
    },
    flyTo(lng, lat, zoom) {
      map.easeTo({ center: [lng, lat], zoom });
    },
    jumpTo(lng, lat, zoom) {
      map.jumpTo({ center: [lng, lat], zoom });
    },
    getCenter() {
      const c = map.getCenter();
      return [c.lng, c.lat];
    },
    resize() {
      map.resize();
    },
    destroy() {
      map.remove();
    },
  };
}
