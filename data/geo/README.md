# Geodata

What lives here:

| File                      | In git                      | What                                                                                                                   |
| ------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `municipalities.geo.json` | yes (~1.2 MB, ~340 KB gzip) | 308 municipalities (CAOP), simplified with a 100 m tolerance, WGS84, 5 decimals. Used by `/api/geo/reverse`.           |
| `municipalities.json`     | yes                         | `{code, name, district, tz}` for the 308 municipalities, sorted by name (pt-PT). Used by the signature form (phase 5). |
| `pt-region.geojson`       | yes                         | Rough boxes (mainland, Madeira + Porto Santo, Selvagens, Azores) used to cut the PMTiles extract.                      |
| `raw/`                    | **no**                      | CAOP downloads and temporary files.                                                                                    |
| `*.pmtiles`               | **no**                      | Basemap extract (~2.4 GB), hosted on R2.                                                                               |

Properties of each municipality:

- `code` is the DTMN/DICO code (4 digits, e.g. `1312` = Porto).
- `district` is the district on the mainland, or `Região Autónoma da Madeira` / `Região Autónoma dos Açores` on the islands.
- `island` is the island name, or `null` on the mainland.
- `tz` is derived from the region: `Europe/Lisbon`, `Atlantic/Madeira` or `Atlantic/Azores`.

## 1. Municipalities from the CAOP

Source: [Carta Administrativa Oficial de Portugal (CAOP)](https://www.dgterritorio.gov.pt/cartografia/cartografia-tematica/caop), from DGT, under an open licence (CC BY 4.0). The current edition is 2025. There are three GeoPackages, about 140 MB zipped in total:

```powershell
# PowerShell. Invoke-WebRequest uses the Windows certificate store; on networks with a TLS proxy, Git Bash curl may fail.
$y = 2025
foreach ($r in 'Continente','RAM','RAA') {
  Invoke-WebRequest -UseBasicParsing "https://geo2.dgterritorio.gov.pt/caop/CAOP_${r}_${y}-gpkg.zip" -OutFile "data/geo/raw/CAOP_${r}_${y}-gpkg.zip"
  Expand-Archive -Force "data/geo/raw/CAOP_${r}_${y}-gpkg.zip" "data/geo/raw/CAOP_${r}_${y}"
}
```

```bash
# bash / macOS / Linux
y=2025; for r in Continente RAM RAA; do
  curl -fL -o data/geo/raw/CAOP_${r}_${y}-gpkg.zip https://geo2.dgterritorio.gov.pt/caop/CAOP_${r}_${y}-gpkg.zip
  unzip -o data/geo/raw/CAOP_${r}_${y}-gpkg.zip -d data/geo/raw/CAOP_${r}_${y}
done
```

Then generate the files:

```bash
npm run geo:build                 # defaults: --year 2025 --interval 100
npm run geo:build -- --year 2026  # when a new edition comes out
```

The script uses [mapshaper](https://github.com/mbloch/mapshaper), which reads the GeoPackage directly, so **GDAL is not needed**. For each region it:

1. reads the `*_municipios` layer;
2. simplifies it in the source CRS (PT-TM06 or PTRA08-UTM, in metres);
3. reprojects to WGS84.

ETRS89 and PTRA08 differ from WGS84 by less than 1 m, which is irrelevant here. The script fails if it does not get exactly 278 + 11 + 19 municipalities, or if there are duplicate codes or names.

A tolerance of 100 m means points less than about 100 m from a municipal border may be assigned to the neighbouring municipality. The submission form shows the detected municipality, so the person can move the pin. Points just off the coast (at most 1 km out, `GEO_SNAP_METERS`) are assigned to the nearest municipality.

## 2. Basemap (PMTiles)

The Protomaps daily planet build is about 139 GB, but only the region we need is fetched, using HTTP range requests:

```bash
# go-pmtiles CLI: https://github.com/protomaps/go-pmtiles/releases (single binary, Windows/macOS/Linux)
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles data/geo/pt.pmtiles \
  --region=data/geo/pt-region.geojson --maxzoom=15
```

With the 20261029 build, the `--dry-run` reports an **archive of ~2.4 GB**. The extract can't resume, so if the download drops, run it again (`--download-threads=2` is more stable on a weak connection). The mainland box includes a margin of Spain and sea (−11° to 0°, 36° to 43.5°), wide enough for a desktop viewport to centre the mainland; the map's pan limit (`MAX_BOUNDS` in `src/map/regions.ts`) matches its east and north edges, so the cut is never visible. **Keep the two in sync.** For local development, a smaller extract is enough. For example, the Lisbon area only:

```bash
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles data/geo/dev.pmtiles --bbox=-9.5,38.6,-9.0,38.85 --maxzoom=15
```

Upload to R2. The Worker/R2 serves the file with `Range` support:

```bash
# ~2.4 GB: too big for `wrangler r2 object put` (limit ~300 MB). Use the S3 API with rclone:
# R2 → Manage API tokens → Object Read & Write; then `rclone config`:
#   provider = Cloudflare, endpoint = https://<ACCOUNT_ID>.r2.cloudflarestorage.com
rclone copyto data/geo/pt.pmtiles r2:mobilizacao-tiles/pt.pmtiles --s3-chunk-size=100M --progress
```

### Development tiles

For local development, use an extract of the whole country down to z11 (~51 MB). MapLibre overzooms beyond that:

```bash
pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles data/geo/dev.pmtiles   --region=data/geo/pt-region.geojson --maxzoom=11
npm run tiles:dev   # puts it in the LOCAL R2 bucket as pt.pmtiles
```

The Worker serves it at `/tiles/pt.pmtiles`, with `Range` support. In production, upload the full extract under the same key.

## 3. Glyphs and sprites

The Protomaps style also needs fonts (_glyphs_) and _sprites_, which are self-hosted in `public/map/` and committed (~1.7 MB). They come from [protomaps/basemaps-assets](https://github.com/protomaps/basemaps-assets), pinned to a specific commit. Only Latin ranges of Noto Sans Regular, Medium and Italic are included. The Noto fonts are under the SIL Open Font License.

```bash
npm run map:assets   # behind a TLS proxy: NODE_USE_SYSTEM_CA=1 npm run map:assets
```
