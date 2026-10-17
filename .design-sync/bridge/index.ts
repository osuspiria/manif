/**
 * React-facing entry for the Claude Design sync (/design-sync).
 *
 * The app's UI is Preact (Astro islands). Claude Design renders with React, so
 * each component here is a thin "island": a React component that mounts the
 * real, unmodified Preact component into its own host element and re-renders it
 * with the latest props. Nothing is reimplemented - see .design-sync/NOTES.md.
 */
import { h, render, type ComponentType as PreactComponent } from 'preact';
import * as React from 'react';

import { TypeIcon as PTypeIcon } from '../../src/components/map/TypeIcon';
import { EventList as PEventList } from '../../src/components/map/EventList';
import { FilterPanel as PFilterPanel } from '../../src/components/map/FilterPanel';
import { EventSheet as PEventSheet } from '../../src/components/map/EventSheet';
import { MapIntro as PMapIntro } from '../../src/components/map/MapIntro';
import {
  Checkbox as PCheckbox,
  RadioChips as PRadioChips,
  TextArea as PTextArea,
  TextField as PTextField,
} from '../../src/components/forms/fields';
import { EventDetailsFields as PEventDetailsFields } from '../../src/components/forms/EventDetailsFields';
import { OccurrencesEditor as POccurrencesEditor } from '../../src/components/forms/OccurrencesEditor';

import '../../src/styles/map.css';
import '../../src/styles/forms.css';

function island<P extends object>(component: unknown, name: string): React.FC<P> {
  // The Preact component's own prop type is enforced by the exported *Props below.
  const C = component as PreactComponent<P>;
  const Island = (props: P) => {
    const host = React.useRef<HTMLDivElement>(null);
    React.useLayoutEffect(() => {
      if (host.current) render(h(C, props), host.current);
    });
    React.useLayoutEffect(() => {
      const el = host.current;
      return () => {
        if (el) render(null, el);
      };
    }, []);
    return React.createElement('div', { ref: host, 'data-island': name, style: { display: 'contents' } });
  };
  Island.displayName = name;
  return Island;
}

export interface AppRootProps {
  /** Which page shell's body class to apply: "form" (scrolling pages) or "map" (full-screen, overflow hidden). */
  page?: 'form' | 'map';
  children?: React.ReactNode;
}
/**
 * Page root: applies the app's real body class (`form-page` / `map-page`, as the
 * Astro pages do), which carries the font, colours and line-height.
 */
export function AppRoot({ page = 'form', children }: AppRootProps): React.ReactElement {
  React.useLayoutEffect(() => {
    const cls = `${page}-page`;
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [page]);
  return React.createElement(React.Fragment, null, children);
}

export type TypeIconProps =Parameters<typeof PTypeIcon>[0];
/** Event-type marker (inline SVG): same shape and colour as the map marker. */
export const TypeIcon: React.FC<TypeIconProps> = island<TypeIconProps>(PTypeIcon, 'TypeIcon');

export type TextFieldProps = Parameters<typeof PTextField>[0];
/** Labelled text/date/time input with hint and error wired via aria-describedby. */
export const TextField: React.FC<TextFieldProps> = island<TextFieldProps>(PTextField, 'TextField');

export type TextAreaProps = Parameters<typeof PTextArea>[0];
/** Labelled textarea with optional character counter, hint and error. */
export const TextArea: React.FC<TextAreaProps> = island<TextAreaProps>(PTextArea, 'TextArea');

export type CheckboxProps = Parameters<typeof PCheckbox>[0];
/** Native checkbox with a visible label. */
export const Checkbox: React.FC<CheckboxProps> = island<CheckboxProps>(PCheckbox, 'Checkbox');

export interface RadioChipsProps {
  name: string;
  legend: string;
  /** Labels are plain text across the React boundary. */
  options: { value: string; label: string }[];
  value: string;
  onValue: (v: string) => void;
  error?: string;
}
/** Single-choice group: native radios styled as chips. */
export const RadioChips: React.FC<RadioChipsProps> = island<RadioChipsProps>(PRadioChips, 'RadioChips');

export type EventListProps = Parameters<typeof PEventList>[0];
/** List view of the map: results grouped by day, one card per event. */
export const EventList: React.FC<EventListProps> = island<EventListProps>(PEventList, 'EventList');

export type FilterPanelProps = Parameters<typeof PFilterPanel>[0];
/** Map filters: when chips, optional day strip, and event-type chips with counts. */
export const FilterPanel: React.FC<FilterPanelProps> = island<FilterPanelProps>(PFilterPanel, 'FilterPanel');

export type EventSheetProps = Parameters<typeof PEventSheet>[0];
/** Event detail sheet: type, title, place, dates, description and actions. */
export const EventSheet: React.FC<EventSheetProps> = island<EventSheetProps>(PEventSheet, 'EventSheet');

export type MapIntroProps = Parameters<typeof PMapIntro>[0];
/** Home page intro above the map top bar: site title and a one-line description of the platform. */
export const MapIntro: React.FC<MapIntroProps> = island<MapIntroProps>(PMapIntro, 'MapIntro');

export type EventDetailsFieldsProps = Parameters<typeof PEventDetailsFields>[0];
/** What step of the add/edit event form: type chips, title, description, organizer. */
export const EventDetailsFields: React.FC<EventDetailsFieldsProps> = island<EventDetailsFieldsProps>(PEventDetailsFields, 'EventDetailsFields');

export type OccurrencesEditorProps = Parameters<typeof POccurrencesEditor>[0];
/** When step: one row per date with native date/time inputs, add and weekly repeat. */
export const OccurrencesEditor: React.FC<OccurrencesEditorProps> = island<OccurrencesEditorProps>(POccurrencesEditor, 'OccurrencesEditor');

// Pure helpers the components' props are built from (no I/O).
export { filterEvents, countByDay } from '../../src/shared/event-filter';
export type { WhenFilter, FilteredEvent } from '../../src/shared/event-filter';
export { countByType, summaryLabel } from '../../src/shared/event-view';
export { lisbonToday } from '../../src/shared/dates';
export { emptyRow, emptyDetails } from '../../src/components/forms/form-state';
export type { RowState, DetailsState, FieldErrors } from '../../src/components/forms/form-state';
export { EVENT_TYPE_KEYS, EVENT_TYPES } from '../../src/config/event-types';
export type { EventType } from '../../src/config/event-types';
export type { PublicEvent, PublicOccurrence } from '../../src/shared/schemas';
export { pt } from '../../src/i18n/pt';
