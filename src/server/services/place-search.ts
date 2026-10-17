/**
 * Place search for "Procurar local" (SPEC §2): Photon (OSM-based geocoder)
 * called from the Worker, so the browser never talks to third parties.
 * Only the query text is sent; never the user's IP.
 */
import type { PlaceResult } from '../../shared/schemas';

export interface PlaceSearch {
  search(query: string): Promise<PlaceResult[]>;
}

const PHOTON = 'https://photon.komoot.io/api/';
/** minLon, minLat, maxLon, maxLat — mainland and islands. */
const PT_BBOX = '-31.5,29.9,-6.0,42.3';

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

function label(p: Record<string, string | undefined>): string {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const place = p.city ?? p.town ?? p.village ?? p.county;
  const parts = [p.name, street, place].filter((x): x is string => Boolean(x));
  return [...new Set(parts)].join(', ');
}

export class PhotonSearch implements PlaceSearch {
  constructor(private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init)) {}

  async search(query: string): Promise<PlaceResult[]> {
    const url = `${PHOTON}?q=${encodeURIComponent(query)}&limit=8&bbox=${PT_BBOX}`;
    const res = await this.fetchFn(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`photon ${res.status}`);
    const json: { features?: PhotonFeature[] } = await res.json();
    const results: PlaceResult[] = [];
    for (const f of json.features ?? []) {
      const [lng, lat] = f.geometry?.coordinates ?? [];
      const p = f.properties ?? {};
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;
      if (p.countrycode && p.countrycode !== 'PT') continue;
      const l = label(p);
      if (l && !results.some((r) => r.label === l)) results.push({ label: l, lat, lng });
    }
    return results.slice(0, 6);
  }
}
