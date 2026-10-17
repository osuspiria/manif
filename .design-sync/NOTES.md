# Claude Design sync — notes

Project: "Mobilização PT" — https://claude.ai/design/p/3efc90c0-1a6a-493f-813d-0740aba12e00

## How this repo is synced (read first)

- The app is **Preact** (Astro islands), not a React library, and has no Storybook. `.design-sync/bridge/` is a tiny
  React-facing package (`mobilizacao-pt-ui`, global `window.MobilizacaoUI`): each export is an "island" — a React
  component that `preact.render`s the real, unmodified component from `src/` into a `display: contents` host. Preact
  and the app code are inlined into `bridge/dist/index.mjs`; React stays external.
- Build order on every sync: `node .design-sync/bridge/build.mjs` (cfg.buildCmd: esbuild bundle + CSS + `tsc` d.ts)
  → `node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules .ds-sync/node_modules --entry .design-sync/bridge/dist/index.mjs --out ./ds-bundle [--remote …]`.
- Converter deps live in `.ds-sync/node_modules`: `esbuild ts-morph typescript @types/react@18 react@18.3.1 react-dom@18.3.1 playwright@1.64.1`
  (playwright pinned to the cached chromium-1248 = repo's @playwright/test 1.64.1).
- Fresh clone (Windows): recreate the junction so ts-morph resolves `react` types from the bridge d.ts:
  `cmd //c "mklink /J .design-sync\node_modules .ds-sync\node_modules"`. Without it the build prints `[DTS_REACT]`.
- Synced components (10): TypeIcon, TextField, TextArea, Checkbox, RadioChips, EventList, FilterPanel, EventSheet,
  EventDetailsFields, OccurrencesEditor. Not synced (API/MapLibre/Astro-bound): MapApp, MapCanvas, AddEventFlow,
  ReportForm (only inside EventSheet), PlaceSearchBox, admin/*, support/*, all `.astro` components.
- CSS shipped: `map.css` + `forms.css` (both `@import base.css`), via the bridge entry → `cssEntry: dist/index.css`.
  admin.css / support.css / prose.css are not shipped.

## Fixes learned

- **Previews need their own tsconfig** (`previews/tsconfig.json`, `jsxImportSource: react`). Without it esbuild picks
  up the repo's `jsxImportSource: preact` and every authored cell throws "Objects are not valid as a React child".
- **`AppRoot` provider** (bridge export, `cfg.provider`, excluded from cards via `componentSrcMap: {AppRoot: null}`):
  the font/colours live on `body.form-page` / `body.map-page`, so without it everything renders in serif.
- `.d.ts` extraction can't flatten the generic/zod-derived prop types (EventList `results` came out `unknown`; FilterPanel
  referenced undefined `WhenFilter`/`DayCount`) → hand-written bodies in `cfg.dtsPropsFor` for EventList, EventSheet,
  FilterPanel, OccurrencesEditor, EventDetailsFields.
- JSDoc summaries lose quotes and non-ASCII in the README index ("O quê" → "O qu") — keep bridge JSDoc ASCII, no quotes.
- EventSheet is `position: absolute` in the map pane → its preview wraps each story in a 360×640 positioned stage;
  `cfg.overrides.EventSheet.cardMode = "column"` (GRID_OVERFLOW).
- Previews use fixed `NOW = 2026-10-17T09:00Z` and fictional fixtures in `previews/_fixtures.ts` (`.ts` so it isn't
  treated as a component preview).

- **Fonts are inlined, there is no `fonts/` dir.** `base.css` imports Archivo from `@fontsource/archivo` (latin 400/600/800);
  `bridge/build.mjs` uses esbuild's `dataurl` loader for `.woff2`/`.woff`, so `_ds_bundle.css` carries the font itself.
  Adding a weight or subset in `base.css` just works; a font imported some other way needs the same treatment.

## Known render warns

- `[RENDER_THIN] … rendered height is 0px` on Checkbox, EventDetailsFields, EventList, FilterPanel — benign: the island
  host is `display: contents`, so the measured root has no box; screenshots show full content.

## Re-sync risks

- **Prop types in `cfg.dtsPropsFor` are hand copies** of `PublicEvent`, `RowState`, `DetailsState`, `WhenFilter`, the
  event-type and tz enums. If `src/shared/schemas.ts`, `form-state.ts`, `event-filter.ts` or `config/event-types.ts`
  change, update them — nothing fails automatically. The event-type enum is also spelled out in `conventions.md`
  (PublicEvent line): adding/removing a type means editing 7 places in `dtsPropsFor` plus that line.
- `RadioChipsProps` in `bridge/index.ts` narrows option labels to strings (React nodes can't cross into Preact).
- Islands wrap whole Preact components; if a synced component starts fetching on mount or reading globals (like
  `EventSheet` uses `window.location.origin`), its preview may change — recheck the sheet.
- `KEY_DATES` is empty today; when key dates are added, FilterPanel previews gain key-date chips (grades follow sources,
  so recheck FilterPanel visually).
- New Preact components are not picked up automatically — add them to `bridge/index.ts` and author a preview.
