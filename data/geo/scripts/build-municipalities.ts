/**
 * Builds data/geo/municipalities.geo.json and data/geo/municipalities.json from
 * the CAOP GeoPackages (DGT). See data/geo/README.md for how to download them.
 *
 * Usage: npm run geo:build [-- --year 2025 --interval 100]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
// @ts-expect-error -- mapshaper ships no type declarations
import mapshaper from 'mapshaper';

const { values } = parseArgs({
  options: {
    year: { type: 'string', default: '2025' },
    /** Simplification tolerance in metres (in the source projected CRS). */
    interval: { type: 'string', default: '100' },
  },
});
const year = values.year;
const interval = Number(values.interval);

const GEO_DIR = resolve(import.meta.dirname, '..');
const RAW = join(GEO_DIR, 'raw');
const TMP = join(RAW, 'tmp');

type Tz = 'Europe/Lisbon' | 'Atlantic/Madeira' | 'Atlantic/Azores';

interface Source {
  file: string;
  layer: string;
  tz: Tz;
}

const SOURCES: Source[] = [
  {
    file: `CAOP_Continente_${year}/Continente_CAOP${year}.gpkg`,
    layer: 'cont_municipios',
    tz: 'Europe/Lisbon',
  },
  {
    file: `CAOP_RAM_${year}/ArqMadeira_CAOP${year}.gpkg`,
    layer: 'ram_municipios',
    tz: 'Atlantic/Madeira',
  },
  {
    file: `CAOP_RAA_${year}/ArqAcores_GOcidental_CAOP${year}.gpkg`,
    layer: 'raa_oci_municipios',
    tz: 'Atlantic/Azores',
  },
  {
    file: `CAOP_RAA_${year}/ArqAcores_GCentral_GOriental_CAOP${year}.gpkg`,
    layer: 'raa_cen_ori_municipios',
    tz: 'Atlantic/Azores',
  },
];

interface MunicipalityProps {
  code: string;
  name: string;
  /** District (continent) or autonomous region (islands). */
  district: string;
  /** Island name, islands only. */
  island: string | null;
  tz: Tz;
}

interface Feature {
  type: 'Feature';
  properties: MunicipalityProps;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

const EXPECTED = { 'Europe/Lisbon': 278, 'Atlantic/Madeira': 11, 'Atlantic/Azores': 19 } as const;

async function run(cmd: string): Promise<void> {
  await mapshaper.runCommands(cmd);
}

const q = (p: string) => `"${p.replaceAll('\\', '/')}"`;

async function main(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  const features: Feature[] = [];

  for (const [i, src] of SOURCES.entries()) {
    const out = join(TMP, `part-${i}.geojson`);
    // Simplify in the projected source CRS (metres) so the tolerance is uniform,
    // then reproject to WGS84. ETRS89/PTRA08 ≈ WGS84 at metre level.
    await run(
      [
        `-i ${q(join(RAW, src.file))} layers=${src.layer}`,
        `-simplify interval=${interval} keep-shapes`,
        `-proj wgs84`,
        `-filter-fields dtmn,municipio,distrito_ilha,nuts1`,
        `-o ${q(out)} format=geojson precision=0.00001`,
      ].join(' '),
    );
    const fc = JSON.parse(readFileSync(out, 'utf8')) as {
      features: { properties: Record<string, string>; geometry: Feature['geometry'] }[];
    };
    for (const f of fc.features) {
      const p = f.properties;
      const isIsland = src.tz !== 'Europe/Lisbon';
      features.push({
        type: 'Feature',
        properties: {
          code: String(p.dtmn),
          name: String(p.municipio),
          district: isIsland ? String(p.nuts1) : String(p.distrito_ilha),
          island: isIsland ? String(p.distrito_ilha) : null,
          tz: src.tz,
        },
        geometry: f.geometry,
      });
    }
  }

  validate(features);
  features.sort((a, b) => a.properties.code.localeCompare(b.properties.code));

  const geojson = { type: 'FeatureCollection', features };
  writeFileSync(join(GEO_DIR, 'municipalities.geo.json'), JSON.stringify(geojson));

  const list = features
    .map(({ properties: { code, name, district, tz } }) => ({ code, name, district, tz }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT'));
  writeFileSync(join(GEO_DIR, 'municipalities.json'), JSON.stringify(list, null, 2) + '\n');

  const kb = (JSON.stringify(geojson).length / 1024).toFixed(0);
  console.log(`OK: ${features.length} municipalities, geojson ${kb} KB`);
}

function validate(features: Feature[]): void {
  for (const [tz, n] of Object.entries(EXPECTED)) {
    const got = features.filter((f) => f.properties.tz === tz).length;
    if (got !== n) throw new Error(`Expected ${n} municipalities in ${tz}, got ${got}`);
  }
  const codes = new Set(features.map((f) => f.properties.code));
  if (codes.size !== features.length) throw new Error('Duplicate municipality codes');
  const names = new Set(features.map((f) => `${f.properties.district}/${f.properties.name}`));
  if (names.size !== features.length) throw new Error('Duplicate municipality names in a district');
  for (const f of features) {
    if (!/^\d{4}$/.test(f.properties.code)) throw new Error(`Bad code ${f.properties.code}`);
    if (!f.geometry) throw new Error(`Missing geometry for ${f.properties.name}`);
  }
}

await main();
