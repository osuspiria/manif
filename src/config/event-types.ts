import type { PictogramName } from '../map/pictograms';

/** Event types (SPEC §3.3). Each type has its own pictogram on the same square pin (no colour code). */
export const EVENT_TYPE_KEYS = [
  'demonstration',
  'rally',
  'action',
  'assembly',
  'camp',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPE_KEYS)[number];

export interface EventTypeConfig {
  /** Key into `pt.eventTypes` in src/i18n/pt.ts. */
  key: EventType;
  /** Pictogram drawn on the pin (src/map/pictograms.ts). */
  icon: PictogramName;
}

export const EVENT_TYPES: Record<EventType, EventTypeConfig> = {
  demonstration: { key: 'demonstration', icon: 'megaphone' },
  rally: { key: 'rally', icon: 'placard' },
  action: { key: 'action', icon: 'flag' },
  assembly: { key: 'assembly', icon: 'people' },
  camp: { key: 'camp', icon: 'tent' },
  other: { key: 'other', icon: 'dots' },
};

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPE_KEYS as readonly string[]).includes(value);
}
