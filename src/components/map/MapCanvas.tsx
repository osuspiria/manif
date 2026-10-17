import { useEffect, useRef } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { MapEngine, MarkerCollection } from '../../map/engine';
import type { RegionKey } from '../../map/regions';

export interface MapCommand {
  /** Increments to re-run the same command. */
  seq: number;
  action:
    | { kind: 'region'; region: RegionKey }
    | { kind: 'focus'; lng: number; lat: number; offset: [number, number] }
    | { kind: 'user'; lng: number; lat: number };
}

interface Props {
  markers: MarkerCollection;
  visible: boolean;
  command: MapCommand | null;
  onSelect: (id: string) => void;
}

/** Hosts the lazily-loaded MapLibre engine. */
export function MapCanvas({ markers, visible, command, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const latest = useRef({ markers, command, onSelect });
  latest.current = { markers, command, onSelect };

  useEffect(() => {
    let cancelled = false;
    void import('../../map/engine').then(({ createMapEngine }) => {
      if (cancelled || !container.current) return;
      const e = createMapEngine(container.current, {
        onSelect: (id) => latest.current.onSelect(id),
      });
      e.setMarkers(latest.current.markers);
      engine.current = e;
      run(e, latest.current.command);
    });
    return () => {
      cancelled = true;
      engine.current?.destroy();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setMarkers(markers);
  }, [markers]);

  useEffect(() => {
    if (visible) engine.current?.resize();
  }, [visible]);

  useEffect(() => {
    if (engine.current) run(engine.current, command);
  }, [command?.seq]);

  return <div class="map-canvas" ref={container} role="region" aria-label={pt.map.mapLabel} />;
}

function run(e: MapEngine, command: MapCommand | null) {
  if (!command) return;
  const a = command.action;
  if (a.kind === 'region') e.fitRegion(a.region);
  else if (a.kind === 'focus') e.focus(a.lng, a.lat, a.offset);
  else e.showUser(a.lng, a.lat);
}
