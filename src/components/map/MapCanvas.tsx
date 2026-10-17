import { useEffect, useRef, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { MapEngine, MarkerCollection } from '../../map/engine';
import type { RegionKey } from '../../map/regions';

export interface MapCommand {
  /** Increments to re-run the same command. */
  seq: number;
  action:
    | { kind: 'region'; region: RegionKey }
    | { kind: 'focus'; lng: number; lat: number; offset: [number, number] }
    | { kind: 'user'; lng: number; lat: number }
    | { kind: 'fly'; lng: number; lat: number; zoom: number }
    | { kind: 'jump'; lng: number; lat: number; zoom: number };
}

interface Props {
  markers: MarkerCollection;
  selectedId: string | null;
  visible: boolean;
  command: MapCommand | null;
  onSelect: (id: string) => void;
  /** "Escolher ponto": fixed pin in the centre; the map moves under it. */
  picking?: boolean;
  onCenter?: (center: [number, number]) => void;
}

/** Hosts the lazily-loaded MapLibre engine. */
export function MapCanvas({
  markers,
  selectedId,
  visible,
  command,
  onSelect,
  picking,
  onCenter,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<MapEngine | null>(null);
  const latest = useRef({ markers, selectedId, command, onSelect, onCenter });
  latest.current = { markers, selectedId, command, onSelect, onCenter };

  // Load MapLibre only once the map is actually shown (not in list view).
  const [wanted, setWanted] = useState(visible);
  useEffect(() => {
    if (visible) setWanted(true);
  }, [visible]);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void import('../../map/engine').then(({ createMapEngine }) => {
      if (cancelled || !container.current) return;
      const e = createMapEngine(container.current, {
        onSelect: (id) => latest.current.onSelect(id),
        onMoveEnd: (c) => latest.current.onCenter?.(c),
      });
      latest.current.onCenter?.(e.getCenter());
      e.setMarkers(latest.current.markers);
      e.setSelected(latest.current.selectedId);
      engine.current = e;
      run(e, latest.current.command);
    });
    return () => {
      cancelled = true;
      engine.current?.destroy();
      engine.current = null;
    };
  }, [wanted]);

  useEffect(() => {
    engine.current?.setMarkers(markers);
  }, [markers]);

  useEffect(() => {
    engine.current?.setSelected(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (visible) engine.current?.resize();
  }, [visible]);

  // Report the centre when picking starts (the map may not move at all).
  useEffect(() => {
    if (picking && engine.current) {
      engine.current.resize();
      onCenter?.(engine.current.getCenter());
    }
  }, [picking]);

  useEffect(() => {
    if (engine.current) run(engine.current, command);
  }, [command?.seq]);

  return (
    <>
      <div class="map-canvas" ref={container} role="region" aria-label={pt.map.mapLabel} />
      {picking && (
        <div class="pick-pin" aria-hidden="true">
          <svg viewBox="0 0 24 36" width="36" height="54" focusable="false">
            <path
              d="M12 1C6 1 1.5 5.5 1.5 11.3 1.5 19 12 34 12 34s10.5-15 10.5-22.7C22.5 5.5 18 1 12 1Z"
              fill="#ff4d00"
              stroke="#000"
              stroke-width="2"
            />
            <circle cx="12" cy="11.5" r="4" fill="#000" />
          </svg>
        </div>
      )}
    </>
  );
}

function run(e: MapEngine, command: MapCommand | null) {
  if (!command) return;
  const a = command.action;
  if (a.kind === 'region') e.fitRegion(a.region);
  else if (a.kind === 'focus') e.focus(a.lng, a.lat, a.offset);
  else if (a.kind === 'fly') e.flyTo(a.lng, a.lat, a.zoom);
  else if (a.kind === 'jump') e.jumpTo(a.lng, a.lat, a.zoom);
  else e.showUser(a.lng, a.lat);
}
