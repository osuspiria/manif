## Conventions for building with MobilizacaoUI

Portuguese mobilisation platform (map of events + event submission). Mobile-first: design for **360 px** width first; touch targets ≥ 44 px. All UI copy is **European Portuguese (PT-PT)** — "telemóvel", "ecrã", "concelho"; never Brazilian forms. Reuse the app's own strings from `MobilizacaoUI.pt` (e.g. `pt.eventTypes.rally`, `pt.when.weekend`, `pt.map.empty`) instead of writing new copy.

### Setup

Always wrap the tree in `AppRoot`. It applies the app's body class (`form-page` by default; `page="map"` for full-screen, non-scrolling map layouts), which carries the font (Archivo, inlined in the bundle CSS), colours and line-height. Without it everything renders in the browser's serif default.

```jsx
const { AppRoot, TextField } = window.MobilizacaoUI;
<AppRoot><main className="form-main">…</main></AppRoot>
```

Components are controlled: keep state in React and pass `value`/`onValue` (`onChecked`, `onChange` for the composite editors). Props cross into the real Preact components, so pass **plain data and callbacks only — never React elements as props** (e.g. `RadioChips` option labels are strings).

### Styling idiom: plain CSS classes + tokens

No CSS-in-JS, no utility framework. Style your own layout with the app's tokens and existing classes:

- Tokens: `var(--bg)` (white), `--fg` (black), `--muted`, `--line`, `--chip-bg`, `--accent` (orange `#ff4d00`), `--accent-fg` (black), `--accent-tint` (`#ffe2d4`, hover/soft highlight), `--key` (key dates), `--danger`, `--shadow` (`none`), `--radius` (`0`), `--topbar-h`, `--font`.
- "Acid" look: black on white, square corners, `2px solid var(--fg)` borders, no soft shadows (the only shadows are flat orange offsets, e.g. `6px 6px 0 var(--accent)`). **Orange is never text on white** (3.3:1 contrast) — use it only as a background behind black text (`btn-primary`, selected card). Links are black text with a 2px orange underline (`text-decoration: underline 2px var(--accent)`), as `btn-link` / `btn-quiet` do.
- Buttons: `btn`, `btn-primary`, `btn-quiet`, `btn-danger`, `btn-link`, `btn-icon`.
- Chips: `chips` (row) + `chips-wrap` / `chips-scroll`, `chip` with `aria-pressed="true"` for selected, `chip-count`.
- Forms: `field`, `hint`, `field-error`, `form-error`, `form-ok`, `form-header`, `form-main`.
- Map shell: `map-app`, `topbar`, `summary-button`, `content`, `list-pane`, `map-pane`, `fabs`/`fab`/`fab-add`, `segmented`, `toast`, `badge`/`badge-ok`, `visually-hidden`.

Selected/pressed state is expressed with ARIA attributes (`aria-pressed`, `aria-current`), not extra classes. Event-type colour is never the only cue — always pair it with `TypeIcon` (shape) and the type label.

### Data

Event props use the API shape (`PublicEvent`: `type` ∈ `demonstration | rally | action | assembly | camp | other`, `tz` ∈ `Europe/Lisbon | Atlantic/Madeira | Atlantic/Azores`, `occurrences[]` with `localDate`, `startTime`, `startsAt`/`endsAt` in UTC, `cancelled`). Build list/filter props with the bundled pure helpers — `filterEvents(events, { when, types }, now)`, `countByType(results)`, `countByDay(events, types, now, 14)`, `lisbonToday(now)`, `summaryLabel(n, when, types)`, `emptyRow()`, `emptyDetails()`. Sample content must be clearly fictional (e.g. "Marcha pelo clima (exemplo)").

`EventSheet` is an overlay (absolute, bottom of the map pane): place it inside a positioned container with a height, as `map-pane` is.

### Where the truth lives

`styles.css` (→ `_ds_bundle.css`, the app's `base.css` + `forms.css` + `map.css`) and each `components/general/<Name>/<Name>.prompt.md` / `.d.ts`.

### Example

```jsx
const { AppRoot, FilterPanel, EventList, filterEvents, countByType, countByDay, lisbonToday, summaryLabel } = window.MobilizacaoUI;
function ListScreen({ events, now }) {
  const [when, setWhen] = React.useState({ kind: 'upcoming' });
  const [types, setTypes] = React.useState([]);
  const [sel, setSel] = React.useState(null);
  const results = filterEvents(events, { when, types }, now);
  return (
    <AppRoot>
      <div className="topbar"><button className="summary-button">{summaryLabel(results.length, when, types)}</button></div>
      <FilterPanel id="filters" when={when} types={types}
        typeCounts={countByType(filterEvents(events, { when, types: [] }, now))}
        dayCounts={countByDay(events, types, now, 14)} today={lisbonToday(now)}
        dayStripOpen={false} isDefault={when.kind === 'upcoming' && !types.length}
        resultsLabel={summaryLabel(results.length, when, types)} overlay={false}
        onWhen={setWhen} onToggleType={(t) => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t])}
        onToggleDayStrip={() => {}} onClear={() => { setWhen({ kind: 'upcoming' }); setTypes([]); }} onClose={() => {}} />
      <EventList results={results} selectedId={sel} onSelect={setSel} />
    </AppRoot>
  );
}
```
