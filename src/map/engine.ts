/**
 * MapLibre setup: self-hosted Protomaps basemap (PMTiles via /tiles, glyphs and
 * sprites from /map), clustered event markers drawn as square pictogram pins.
 * Loaded lazily so the filters and the list work before the map is ready.
 */
import { layers, namedFlavor } from '@protomaps/basemaps';
import {
  addProtocol,
  Map as MlMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
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
import { PICTOGRAMS, PICTOGRAM_SCALE, PICTOGRAM_STROKE } from './pictograms';

export interface MarkerProps {
  id: string;
  type: EventType;
  /** '24/11' or '' */
  dayLabel: string;
  /** The highlighted occurrence falls on one of KEY_DATES. */
  keyDate: boolean;
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
  /** Draws this event's pin as selected (bigger, orange, on top). */
  setSelected(id: string | null): void;
  fitRegion(region: RegionKey): void;
  /**
   * Centres an event, zooming in to FOCUS_ZOOM if further out (never out).
   * `offset`: pixels to shift the point from the centre (e.g. above a bottom sheet).
   */
  focus(lng: number, lat: number, offset?: [number, number]): void;
  showUser(lng: number, lat: number): void;
  flyTo(lng: number, lat: number, zoom: number): void;
  /** Like flyTo without animation (safe right before a resize). */
  jumpTo(lng: number, lat: number, zoom: number): void;
  getCenter(): [number, number];
  getZoom(): number;
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

const ACCENT = '#ff4d00';
const PIN = 40;
const PIN_SELECTED = 48;
const TIP_W = 10;
const TIP_H = 6;
const CLUSTER_SIZES = [32, 40, 52] as const;
/**
 * Zoom when an event is opened: close enough to see the streets around it and
 * no cluster (clusterMaxZoom is 12), far enough to keep the town in view.
 */
const FOCUS_ZOOM = 13;

/** A 2× canvas context for an image of `width`×`height` CSS pixels. */
function canvas2d(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not available');
  ctx.scale(2, 2);
  return ctx;
}

/**
 * Square pin with the type pictogram and a tip pointing at the place: black
 * with a white border and pictogram; selected is bigger and orange with black
 * border and pictogram; a key date adds an orange bar along the top.
 */
function pinImage(type: EventType, variant: 'base' | 'key' | 'selected'): ImageData {
  const selected = variant === 'selected';
  const side = selected ? PIN_SELECTED : PIN;
  const ctx = canvas2d(side, side + TIP_H);
  const fg = selected ? '#000000' : '#ffffff';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = fg;
  ctx.fillRect(1, 1, side - 2, side - 2);
  ctx.fillStyle = selected ? ACCENT : '#000000';
  ctx.fillRect(3, 3, side - 6, side - 6);
  if (variant === 'key') {
    ctx.fillStyle = ACCENT;
    ctx.fillRect(3, 3, side - 6, 4);
  }
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo((side - TIP_W) / 2, side);
  ctx.lineTo((side + TIP_W) / 2, side);
  ctx.lineTo(side / 2, side + TIP_H);
  ctx.closePath();
  ctx.fill();

  const icon = side * PICTOGRAM_SCALE;
  const pic = PICTOGRAMS[EVENT_TYPES[type].icon];
  ctx.translate((side - icon) / 2, (side - icon) / 2);
  ctx.scale(icon / 24, icon / 24);
  const path = new Path2D(pic.d);
  if (pic.fill) {
    ctx.fillStyle = fg;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = fg;
    ctx.lineWidth = PICTOGRAM_STROKE;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  }
  return ctx.getImageData(0, 0, side * 2, (side + TIP_H) * 2);
}

/** Cluster background: white square with a 2px black border. */
function clusterImage(side: number): ImageData {
  const ctx = canvas2d(side, side);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, side, side);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2, 2, side - 4, side - 4);
  return ctx.getImageData(0, 0, side * 2, side * 2);
}

function pinExpression(selectedId: string | null): ExpressionSpecification {
  return [
    'case',
    ['==', ['get', 'id'], selectedId ?? ''],
    ['concat', 'pin-selected-', ['get', 'type']],
    ['==', ['get', 'keyDate'], true],
    ['concat', 'pin-key-', ['get', 'type']],
    ['concat', 'pin-', ['get', 'type']],
  ];
}

/** The selected pin is drawn above its neighbours. */
function sortExpression(selectedId: string | null): ExpressionSpecification {
  return ['case', ['==', ['get', 'id'], selectedId ?? ''], 1, 0];
}

export function createMapEngine(
  container: HTMLElement,
  opts: {
    onSelect: (id: string) => void;
    /** Called with the map centre and zoom after every move (used by "escolher ponto"). */
    onMoveEnd?: (center: [number, number], zoom: number) => void;
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
    locale: pt.map.controls,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

  let pending: MarkerCollection | null = null;
  let loaded = false;
  let userMarker: Marker | null = null;
  let selectedId: string | null = null;

  map.on('load', () => {
    for (const type of EVENT_TYPE_KEYS) {
      map.addImage(`pin-${type}`, pinImage(type, 'base'), { pixelRatio: 2 });
      map.addImage(`pin-key-${type}`, pinImage(type, 'key'), { pixelRatio: 2 });
      map.addImage(`pin-selected-${type}`, pinImage(type, 'selected'), { pixelRatio: 2 });
    }
    for (const side of CLUSTER_SIZES) {
      map.addImage(`cluster-${side}`, clusterImage(side), { pixelRatio: 2 });
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
      type: 'symbol',
      source: SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': [
          'step',
          ['get', 'point_count'],
          `cluster-${CLUSTER_SIZES[0]}`,
          10,
          `cluster-${CLUSTER_SIZES[1]}`,
          50,
          `cluster-${CLUSTER_SIZES[2]}`,
        ],
        'icon-allow-overlap': true,
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': FONT,
        'text-size': 14,
        'text-allow-overlap': true,
      },
      // Only a Medium glyph set is self-hosted: a same-colour halo makes the count heavier.
      paint: { 'text-color': '#000000', 'text-halo-color': '#000000', 'text-halo-width': 0.6 },
    });
    map.addLayer({
      id: 'event-icons',
      type: 'symbol',
      source: SOURCE,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': pinExpression(selectedId),
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'symbol-sort-key': sortExpression(selectedId),
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
        'text-offset': [0, 0.3],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: { 'text-color': '#000000', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
    loaded = true;
  });

  map.on('moveend', () => {
    const c = map.getCenter();
    opts.onMoveEnd?.([c.lng, c.lat], map.getZoom());
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
    setSelected(id) {
      selectedId = id;
      if (!loaded) return;
      map.setLayoutProperty('event-icons', 'icon-image', pinExpression(id));
      map.setLayoutProperty('event-icons', 'symbol-sort-key', sortExpression(id));
    },
    fitRegion(region) {
      map.fitBounds(REGIONS[region], { padding: 24 });
    },
    focus(lng, lat, offset = [0, 0]) {
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), FOCUS_ZOOM), offset });
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
    getZoom() {
      return map.getZoom();
    },
    resize() {
      map.resize();
    },
    destroy() {
      map.remove();
    },
  };
}
