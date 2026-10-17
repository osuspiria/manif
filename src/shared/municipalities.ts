/**
 * The 308 municipalities (data/geo/municipalities.json, from the CAOP), for
 * the signature form's "Concelho" select and the public list. Signatures store
 * the DICO code: names are not unique (there are two "Lagoa").
 */
import list from '../../data/geo/municipalities.json';

export interface Municipality {
  code: string;
  name: string;
  district: string;
}

export const MUNICIPALITIES: readonly Municipality[] = list.map(({ code, name, district }) => ({
  code,
  name,
  district,
}));

const byCode = new Map(MUNICIPALITIES.map((m) => [m.code, m]));
const nameCount = new Map<string, number>();
for (const m of MUNICIPALITIES) nameCount.set(m.name, (nameCount.get(m.name) ?? 0) + 1);

const SHORT_REGION: Record<string, string> = {
  'Região Autónoma da Madeira': 'Madeira',
  'Região Autónoma dos Açores': 'Açores',
};

export function isMunicipalityCode(code: string): boolean {
  return byCode.has(code);
}

/** Display name; ambiguous names get the district or region: "Lagoa (Faro)", "Lagoa (Açores)". */
export function municipalityLabel(code: string): string {
  const m = byCode.get(code);
  if (!m) return code;
  if ((nameCount.get(m.name) ?? 0) < 2) return m.name;
  return `${m.name} (${SHORT_REGION[m.district] ?? m.district})`;
}

const collator = new Intl.Collator('pt-PT');

/** Districts (mainland, alphabetically) then the two autonomous regions, each with its municipalities. */
export function municipalitiesByDistrict(): { district: string; items: Municipality[] }[] {
  const groups = new Map<string, Municipality[]>();
  for (const m of MUNICIPALITIES) groups.set(m.district, [...(groups.get(m.district) ?? []), m]);
  const isRegion = (d: string) => d in SHORT_REGION;
  return [...groups.entries()]
    .sort(([a], [b]) => Number(isRegion(a)) - Number(isRegion(b)) || collator.compare(a, b))
    .map(([district, items]) => ({
      district,
      items: items.sort((a, b) => collator.compare(a.name, b.name)),
    }));
}
