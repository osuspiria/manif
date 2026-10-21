/**
 * Map filter state <-> URL query string (SPEC §4.2), for shareable links:
 *   /mapa?quando=fds&tipo=rally,action   /mapa?dia=2026-11-25   ?quando=passados   ?vista=lista
 * Defaults (upcoming, all types, map view) are omitted.
 */
import { Temporal } from 'temporal-polyfill';
import { EVENT_TYPE_KEYS, isEventType, type EventType } from '../config/event-types';
import type { EventFilter, WhenFilter } from './event-filter';

export type MapView = 'map' | 'list';

export interface MapUrlState extends EventFilter {
  types: EventType[];
  view: MapView;
}

type NamedWhen = Exclude<WhenFilter['kind'], 'day'>;

const WHEN_PARAM: Record<NamedWhen, string> = {
  upcoming: 'proximos',
  today: 'hoje',
  tomorrow: 'amanha',
  weekend: 'fds',
  next7: '7dias',
  past: 'passados',
};

const WHEN_BY_PARAM = new Map(
  Object.entries(WHEN_PARAM).map(([kind, param]) => [param, kind as NamedWhen]),
);

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' });
    return true;
  } catch {
    return false;
  }
}

function canonicalTypes(types: readonly EventType[]): EventType[] {
  const set = new Set(types);
  return EVENT_TYPE_KEYS.filter((k) => set.has(k));
}

export function parseMapUrl(search: string): MapUrlState {
  const params = new URLSearchParams(search);

  let when: WhenFilter = { kind: 'upcoming' };
  const day = params.get('dia');
  const named = WHEN_BY_PARAM.get(params.get('quando') ?? '');
  if (day !== null && isValidDate(day)) when = { kind: 'day', date: day };
  else if (named) when = { kind: named };

  const types = (params.get('tipo') ?? '').split(',').filter(isEventType);

  return {
    when,
    types: [...new Set(types)],
    view: params.get('vista') === 'lista' ? 'list' : 'map',
  };
}

export function serializeMapUrl(state: MapUrlState): string {
  const parts: string[] = [];
  if (state.when.kind === 'day') parts.push(`dia=${state.when.date}`);
  else if (state.when.kind !== 'upcoming') parts.push(`quando=${WHEN_PARAM[state.when.kind]}`);
  const types = canonicalTypes(state.types);
  if (types.length > 0) parts.push(`tipo=${types.join(',')}`);
  if (state.view === 'list') parts.push('vista=lista');
  return parts.length ? `?${parts.join('&')}` : '';
}

export function isDefaultFilter(filter: EventFilter): boolean {
  return filter.when.kind === 'upcoming' && filter.types.length === 0;
}
