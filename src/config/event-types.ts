/** Event types (SPEC §3.3). Colour is never the only cue: each type also has a distinct shape. */
export const EVENT_TYPE_KEYS = ['demonstration', 'rally', 'action', 'assembly', 'other'] as const;
export type EventType = (typeof EVENT_TYPE_KEYS)[number];

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon';

export interface EventTypeConfig {
  /** Key into `pt.eventTypes` in src/i18n/pt.ts. */
  key: EventType;
  color: string;
  shape: MarkerShape;
  /** Icon file name under public/icons/ (added in phase 2). */
  icon: string;
}

export const EVENT_TYPES: Record<EventType, EventTypeConfig> = {
  demonstration: { key: 'demonstration', color: '#c62828', shape: 'circle', icon: 'megaphone' },
  rally: { key: 'rally', color: '#6a1b9a', shape: 'square', icon: 'flame' },
  action: { key: 'action', color: '#e65100', shape: 'triangle', icon: 'flag' },
  assembly: { key: 'assembly', color: '#1565c0', shape: 'diamond', icon: 'people' },
  other: { key: 'other', color: '#37474f', shape: 'hexagon', icon: 'dot' },
};

export function isEventType(value: string): value is EventType {
  return (EVENT_TYPE_KEYS as readonly string[]).includes(value);
}
