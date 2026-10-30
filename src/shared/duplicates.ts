/**
 * Possible duplicates (docs/decisions.md #80): an event already on the map close
 * to the same point on one of the same local dates. Pure: used by "Adicionar
 * evento" in the browser (against the events it already loaded) and by the
 * admin event detail on the server.
 */
import { LIMITS } from '../config/app';

export interface DuplicateCandidate {
  lat: number;
  lng: number;
  /** Local dates ('YYYY-MM-DD') of the occurrences that are not cancelled. */
  dates: readonly string[];
}

export interface DuplicateSource {
  id: string;
  lat: number;
  lng: number;
  /** Ongoing ("sem fim"): on every date from this one. */
  ongoingSince: string | null;
  occurrences: readonly { localDate: string; cancelled: boolean }[];
}

export interface PossibleDuplicate<E> {
  event: E;
  distanceM: number;
  /** The dates both share, sorted. */
  dates: string[];
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Events within `LIMITS.duplicateRadiusM` of the candidate that share a local
 * date with it, nearest first, at most `LIMITS.duplicatesShown`.
 */
export function findPossibleDuplicates<E extends DuplicateSource>(
  candidate: DuplicateCandidate,
  events: readonly E[],
  excludeId: string | null = null,
): PossibleDuplicate<E>[] {
  const wanted = new Set(candidate.dates);
  if (!wanted.size) return [];
  const found: PossibleDuplicate<E>[] = [];
  for (const event of events) {
    if (event.id === excludeId) continue;
    const distanceM = distanceMeters(candidate, event);
    if (distanceM > LIMITS.duplicateRadiusM) continue;
    const since = event.ongoingSince;
    const shared = new Set(
      event.occurrences
        .filter((o) => !o.cancelled && wanted.has(o.localDate))
        .map((o) => o.localDate),
    );
    if (since) for (const date of wanted) if (date >= since) shared.add(date);
    if (shared.size) found.push({ event, distanceM, dates: [...shared].sort() });
  }
  return found.sort((a, b) => a.distanceM - b.distanceM).slice(0, LIMITS.duplicatesShown);
}
