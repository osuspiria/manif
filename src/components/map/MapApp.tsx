/**
 * Map page island (/): loads all visible events once, filters them in the browser
 * (SPEC §4.2), keeps the filter in the URL, and shows them on the map and in
 * the equivalent list. Past events ("Já aconteceram") come from a separate
 * list, loaded only when that filter is picked.
 */
import type { ComponentType } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { FEATURES, KEY_DATES, LIMITS } from '../../config/app';
import type { EventType } from '../../config/event-types';
import { pt } from '../../i18n/pt';
import { currentTime } from '../../map/clock';
import type { MarkerCollection } from '../../map/engine';
import type { RegionKey } from '../../map/regions';
import { lisbonToday } from '../../shared/dates';
import { countByDay, filterEvents, type WhenFilter } from '../../shared/event-filter';
import {
  countByType,
  formatShortDate,
  showsDayLabels,
  summaryLabel,
} from '../../shared/event-view';
import type { PublicEvent, PublicEventCollection } from '../../shared/schemas';
import {
  isDefaultFilter,
  parseMapUrl,
  serializeMapUrl,
  type MapUrlState,
} from '../../shared/url-state';
import { PlaceSearchBox } from '../forms/PlaceSearchBox';
import type { AddEventFlowProps } from './AddEventFlow';
import { EventList } from './EventList';
import { EventSheet } from './EventSheet';
import { FilterPanel } from './FilterPanel';
import { MapCanvas, type MapCommand } from './MapCanvas';
import { MapIntro } from './MapIntro';

const DESKTOP_QUERY = '(min-width: 960px)';
const EVENT_PATH = /^\/mapa\/e\/([0-9A-HJKMNP-TV-Z]{26})\/?$/;

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function eventIdFromPath(path: string): string | null {
  return EVENT_PATH.exec(path)?.[1] ?? null;
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ok'; events: PublicEvent[] };

export function MapApp() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [url, setUrl] = useState<MapUrlState>(() => parseMapUrl(window.location.search));
  const [selectedId, setSelectedId] = useState(() => eventIdFromPath(window.location.pathname));
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [pastLoad, setPastLoad] = useState<Load | null>(null);
  const [extraEvent, setExtraEvent] = useState<{
    id: string;
    event: PublicEvent | null;
    loading: boolean;
  } | null>(null);
  const [now, setNow] = useState(currentTime);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dayStripOpen, setDayStripOpen] = useState(() => url.when.kind === 'day');
  const [command, setCommand] = useState<MapCommand | null>(null);
  const [message, setMessage] = useState('');
  // "Adicionar evento" (lazy-loaded) and "Procurar local".
  const [adding, setAdding] = useState(false);
  const [AddFlow, setAddFlow] = useState<ComponentType<AddEventFlowProps> | null>(null);
  const [picking, setPicking] = useState(false);
  const [center, setCenter] = useState<[number, number] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // Keep a focused event visible next to the event sheet (bottom on mobile, right on desktop).
  const sheetOffset = (): [number, number] =>
    isDesktop ? [-210, 0] : [0, -Math.round(window.innerHeight * 0.22)];

  const issue = (action: MapCommand['action']) =>
    setCommand((c) => ({ seq: (c?.seq ?? 0) + 1, action }));

  // --- data ------------------------------------------------------------------
  const loadList = (url: string, set: (l: Load) => void, fresh: boolean) => {
    set({ state: 'loading' });
    fetch(url, { cache: fresh ? 'reload' : 'default' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // Our own API, validated by its tests: no Zod in the client bundle.
      .then((fc: PublicEventCollection) => {
        set({ state: 'ok', events: fc.features.map((f) => f.properties) });
      })
      .catch(() => set({ state: 'error' }));
  };
  /** `fresh`: after our own change, skip any cached copy. */
  const fetchEvents = useCallback((fresh = false) => {
    loadList('/api/events.geojson', setLoad, fresh);
    // Loaded again only if "Já aconteceram" is picked (again).
    setPastLoad(null);
  }, []);
  const fetchPast = () => loadList('/api/past-events.geojson', setPastLoad, false);

  useEffect(() => fetchEvents(), [fetchEvents]);

  const showingPast = url.when.kind === 'past';
  useEffect(() => {
    if (showingPast && pastLoad === null) fetchPast();
  }, [showingPast, pastLoad]);

  useEffect(() => {
    const t = setInterval(() => setNow(currentTime()), 60_000);
    return () => clearInterval(t);
  }, []);

  const events = load.state === 'ok' ? load.events : [];
  // What the list, the markers and the type counts show.
  const shownLoad: Load = showingPast ? (pastLoad ?? { state: 'loading' }) : load;
  const shown = shownLoad.state === 'ok' ? shownLoad.events : [];

  // An event opened by link that is not in the map data (ended, or filtered out server-side).
  useEffect(() => {
    if (!selectedId || load.state !== 'ok') return;
    if (shown.some((e) => e.id === selectedId) || events.some((e) => e.id === selectedId)) return;
    if (extraEvent?.id === selectedId) return;
    setExtraEvent({ id: selectedId, event: null, loading: true });
    fetch(`/api/events/${selectedId}`)
      .then((r) => (r.ok ? (r.json() as Promise<PublicEvent>) : null))
      .then((event) => setExtraEvent({ id: selectedId, event, loading: false }))
      .catch(() => setExtraEvent({ id: selectedId, event: null, loading: false }));
  }, [selectedId, load.state]);

  // Opened by link: centre the map on the event once the data is in.
  useEffect(() => {
    if (shownLoad.state !== 'ok' || !selectedId) return;
    const e = shown.find((x) => x.id === selectedId);
    if (e) issue({ kind: 'focus', lng: e.lng, lat: e.lat, offset: sheetOffset() });
    // Runs when the data arrives, not on every selection.
  }, [shownLoad.state]);

  // --- URL state -------------------------------------------------------------
  useEffect(() => {
    const path = selectedId ? `/mapa/e/${selectedId}` : '/';
    const next = path + serializeMapUrl(url);
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [url, selectedId]);

  useEffect(() => {
    const onPop = () => {
      setUrl(parseMapUrl(window.location.search));
      setSelectedId(eventIdFromPath(window.location.pathname));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // --- derived ---------------------------------------------------------------
  const results = useMemo(() => filterEvents(shown, url, now), [shown, url, now]);
  const typeCounts = useMemo(
    () => countByType(filterEvents(shown, { when: url.when, types: [] }, now)),
    [shown, url.when, now],
  );
  const dayCounts = useMemo(
    () => countByDay(events, url.types, now, LIMITS.dayStripDays),
    [events, url.types, now],
  );
  const summary = summaryLabel(results.length, url.when, url.types);
  const [summaryCount, ...rest] = summary.split(' · ');
  const summaryRest = rest.join(' · ');

  const markers = useMemo<MarkerCollection>(() => {
    const labels = showsDayLabels(url.when);
    return {
      type: 'FeatureCollection',
      features: results.map(({ event, highlight }) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [event.lng, event.lat] },
        properties: {
          id: event.id,
          type: event.type,
          dayLabel: labels ? formatShortDate(highlight.localDate) : '',
          keyDate: KEY_DATES.includes(highlight.localDate),
        },
      })),
    };
  }, [results, url.when]);

  const selectedEvent =
    shown.find((e) => e.id === selectedId) ??
    events.find((e) => e.id === selectedId) ??
    (extraEvent?.id === selectedId ? extraEvent.event : null);

  // --- actions ---------------------------------------------------------------
  const update = (patch: Partial<MapUrlState>) => setUrl((u) => ({ ...u, ...patch }));

  const setWhen = (when: WhenFilter) => {
    update({ when });
    if (when.kind !== 'day') setDayStripOpen(false);
  };
  const toggleType = (type: EventType) =>
    setUrl((u) => ({
      ...u,
      types: u.types.includes(type) ? u.types.filter((t) => t !== type) : [...u.types, type],
    }));
  const clear = () => {
    update({ when: { kind: 'upcoming' }, types: [] });
    setDayStripOpen(false);
  };
  const select = (id: string) => {
    setSelectedId(id);
    // The filters and the event sheet never cover each other.
    setPanelOpen(false);
    const e = shown.find((x) => x.id === id);
    if (e && (isDesktop || url.view === 'map'))
      issue({ kind: 'focus', lng: e.lng, lat: e.lat, offset: sheetOffset() });
  };
  const goRegion = (region: RegionKey) => issue({ kind: 'region', region });
  const locate = (onPos: (lng: number, lat: number) => void, highAccuracy = false) => {
    if (!('geolocation' in navigator)) return setMessage(pt.map.nearMeError);
    navigator.geolocation.getCurrentPosition(
      // Stays in the browser: nothing is sent to the server.
      (pos) => onPos(pos.coords.longitude, pos.coords.latitude),
      () => setMessage(pt.map.nearMeError),
      { enableHighAccuracy: highAccuracy, timeout: 10_000, maximumAge: 300_000 },
    );
  };
  const nearMe = () =>
    locate((lng, lat) => {
      update({ view: 'map' });
      issue({ kind: 'user', lng, lat });
    });

  const startAdding = () => {
    setSelectedId(null);
    setPanelOpen(false);
    setSearchOpen(false);
    update({ view: 'map' });
    setAdding(true);

    if (!AddFlow) {
      void import('./AddEventFlow').then((m) => setAddFlow(() => m.AddEventFlow));
    }
  };
  const stopAdding = () => {
    setAdding(false);
    setPicking(false);
  };

  const isDefault = isDefaultFilter(url);
  const showList = !adding && (isDesktop || url.view === 'list');
  const showMap = isDesktop || url.view === 'map' || adding;
  const overlay = !isDesktop && panelOpen && !adding;
  // On a phone the intro makes room for the filters and the event sheet.
  const showIntro = !adding && (isDesktop || (!panelOpen && !selectedId));

  const panel = (
    <FilterPanel
      id="filters"
      when={url.when}
      types={url.types}
      typeCounts={typeCounts}
      dayCounts={dayCounts}
      today={lisbonToday(now)}
      dayStripOpen={dayStripOpen}
      isDefault={isDefault}
      resultsLabel={summary}
      overlay={overlay}
      onWhen={setWhen}
      onToggleType={toggleType}
      onToggleDayStrip={() => setDayStripOpen((o) => !o)}
      onClear={clear}
      onClose={() => {
        setPanelOpen(false);
        document.getElementById('summary-button')?.focus();
      }}
    />
  );

  return (
    <main
      class={`map-app${adding ? ' adding' : ''}${picking ? ' picking' : ''}`}
      data-view={url.view}
      data-desktop={isDesktop}
    >
      <MapIntro hidden={!showIntro} />

      <div class="topbar">
        {isDesktop ? (
          <p class="summary-text" aria-live="polite">
            {summary}
          </p>
        ) : (
          <button
            id="summary-button"
            type="button"
            class="summary-button"
            aria-expanded={panelOpen}
            aria-controls="filters"
            onClick={() => {
              if (!panelOpen) setSelectedId(null);
              setPanelOpen(!panelOpen);
            }}
          >
            <span class="summary-label">
              <span class="summary-count">{summaryCount}</span>
              <span class="summary-when">{summaryRest}</span>
            </span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <path
                d="M4 6h16M7 12h10M10 18h4"
                stroke="currentColor"
                stroke-width="2"
                fill="none"
                stroke-linecap="round"
              />
            </svg>
          </button>
        )}
        {!isDefault && !isDesktop && (
          <button type="button" class="btn-link topbar-clear" onClick={clear}>
            {pt.when.clear}
          </button>
        )}
        {!isDesktop && (
          <div class="segmented" role="group" aria-label={pt.map.viewToggle}>
            <button
              type="button"
              aria-pressed={url.view === 'map'}
              onClick={() => update({ view: 'map' })}
            >
              {pt.map.viewMap}
            </button>
            <button
              type="button"
              aria-pressed={url.view === 'list'}
              onClick={() => update({ view: 'list' })}
            >
              {pt.map.viewList}
            </button>
          </div>
        )}
      </div>

      {!isDesktop && (
        <p class="visually-hidden" aria-live="polite">
          {summary}
        </p>
      )}

      {isDesktop && !adding && <div class="panel-side">{panel}</div>}

      {adding && (
        <div class={`add-container${picking ? ' add-compact' : ''}`}>
          {AddFlow ? (
            <AddFlow
              center={center}
              now={now}
              events={events}
              onPickingChange={setPicking}
              onFly={(lng, lat, zoom) => issue({ kind: 'fly', lng, lat, zoom })}
              onUseLocation={() =>
                locate((lng, lat) => issue({ kind: 'fly', lng, lat, zoom: 16 }), true)
              }
              onStartOutside={() =>
                // Wide screens can start out at sea. Zoom 9: at lower zooms the pan
                // limit keeps the centre offshore; no animation, as a resize may follow.
                issue({ kind: 'jump', lng: -8.1, lat: 39.6, zoom: 9 })
              }
              onClose={stopAdding}
              onCreated={() => fetchEvents(true)}
              onView={(id) => {
                stopAdding();
                setSelectedId(id);
              }}
            />
          ) : (
            <p class="empty">{pt.map.loading}</p>
          )}
        </div>
      )}

      <div class="content">
        {/* Inside .content: it opens right under the top bar, whatever its height. */}
        {overlay && <div class="panel-overlay">{panel}</div>}
        <div class="list-pane" hidden={!showList}>
          {shownLoad.state === 'loading' && <p class="empty">{pt.map.loading}</p>}
          {shownLoad.state === 'error' && (
            <p class="empty">
              {pt.map.loadError}{' '}
              <button
                type="button"
                class="btn-link"
                onClick={() => (showingPast ? fetchPast() : fetchEvents())}
              >
                {pt.map.retry}
              </button>
            </p>
          )}
          {!isDesktop && (
            <button type="button" class="btn-primary list-add" onClick={startAdding}>
              + {pt.add.open}
            </button>
          )}
          {shownLoad.state === 'ok' && (
            <EventList
              results={results}
              newestFirst={showingPast}
              selectedId={selectedId}
              onSelect={select}
            />
          )}
          {(FEATURES.signatures || FEATURES.privacyPage) && (
            <nav class="list-footer" aria-label={pt.nav.footer}>
              {FEATURES.signatures && <a href="/apoio/">{pt.nav.support}</a>}
              {FEATURES.privacyPage && <a href="/privacidade/">{pt.nav.privacy}</a>}
            </nav>
          )}
        </div>

        <div class="map-pane" hidden={!showMap}>
          <MapCanvas
            markers={markers}
            selectedId={selectedId}
            visible={showMap}
            command={command}
            onSelect={(id) => {
              if (!adding) select(id);
            }}
            picking={adding && picking}
            onCenter={setCenter}
          />
          {searchOpen && !adding && (
            <div class="map-search">
              <PlaceSearchBox
                id="map-search"
                autoFocus
                onPick={(r) => {
                  setSearchOpen(false);
                  issue({ kind: 'fly', lng: r.lng, lat: r.lat, zoom: 15 });
                }}
              />
              <button
                type="button"
                class="btn-icon"
                aria-label={pt.search.close}
                onClick={() => setSearchOpen(false)}
              >
                ×
              </button>
            </div>
          )}
          <div class="regions" role="group" aria-label={pt.map.regions} hidden={adding}>
            <button type="button" onClick={() => goRegion('mainland')}>
              {pt.map.regionMainland}
            </button>
            <button type="button" onClick={() => goRegion('madeira')}>
              {pt.map.regionMadeira}
            </button>
            <button type="button" onClick={() => goRegion('azores')}>
              {pt.map.regionAzores}
            </button>
          </div>
          {!adding && (
            <div class="fabs">
              <button
                type="button"
                class="fab"
                aria-label={pt.search.open}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen((o) => !o)}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle
                    cx="10.5"
                    cy="10.5"
                    r="6.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  />
                  <path
                    d="M15.5 15.5 21 21"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                </svg>
              </button>
              <button type="button" class="fab" onClick={nearMe} aria-label={pt.map.nearMe}>
                <svg
                  viewBox="0 0 24 24"
                  width="22"
                  height="22"
                  aria-hidden="true"
                  focusable="false"
                >
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                  <path
                    d="M12 2v3M12 19v3M2 12h3M19 12h3"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  />
                  <circle
                    cx="12"
                    cy="12"
                    r="7.5"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  />
                </svg>
              </button>
              <button type="button" class="fab fab-add" onClick={startAdding}>
                <span aria-hidden="true">+</span> {pt.add.open}
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedId && !adding && (
        <EventSheet
          event={selectedEvent}
          loading={
            load.state === 'loading' || (extraEvent?.id === selectedId && extraEvent.loading)
          }
          when={url.when}
          now={now}
          onClose={() => setSelectedId(null)}
        />
      )}

      <p class="toast" role="status">
        {message}
      </p>
    </main>
  );
}
