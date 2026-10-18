import type { ReactNode } from 'react';
import { EventSheet } from 'mobilizacao-pt-ui';
import { EVENTS, NOW } from './_fixtures';

// The sheet is an overlay anchored to the bottom of the map pane (position:
// absolute; max-height: 70%), so each story gets a positioned, phone-sized stage
// standing in for the map.
function MapStage({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'relative', width: 360, height: 640, background: 'var(--chip-bg)', overflow: 'hidden' }}>
      {children}
    </div>
  );
}

export function WithSeveralDates() {
  return (
    <MapStage>
      <EventSheet event={EVENTS[0]!} loading={false} when={{ kind: 'upcoming' }} now={NOW} onClose={() => {}} />
    </MapStage>
  );
}

export function UnverifiedAzores() {
  return (
    <MapStage>
      <EventSheet event={EVENTS[3]!} loading={false} when={{ kind: 'upcoming' }} now={NOW} onClose={() => {}} />
    </MapStage>
  );
}

export function WithCancelledDate() {
  return (
    <MapStage>
      <EventSheet event={EVENTS[4]!} loading={false} when={{ kind: 'upcoming' }} now={NOW} onClose={() => {}} />
    </MapStage>
  );
}

export function Ongoing() {
  return (
    <MapStage>
      <EventSheet event={EVENTS[5]!} loading={false} when={{ kind: 'upcoming' }} now={NOW} onClose={() => {}} />
    </MapStage>
  );
}

export function Loading() {
  return (
    <MapStage>
      <EventSheet event={null} loading when={{ kind: 'upcoming' }} now={NOW} onClose={() => {}} />
    </MapStage>
  );
}
