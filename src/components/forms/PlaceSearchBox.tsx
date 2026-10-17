/** "Procurar local": searches through our proxy (/api/geo/search) on submit. */
import { useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { PlaceResult } from '../../shared/schemas';

interface Props {
  id: string;
  onPick: (place: PlaceResult) => void;
  autoFocus?: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'done'; results: PlaceResult[] };

export function PlaceSearchBox({ id, onPick, autoFocus }: Props) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function search(e: Event) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/geo/search?q=${encodeURIComponent(q.trim())}`);
      if (!res.ok) throw new Error(String(res.status));
      setState({ kind: 'done', results: (await res.json()) as PlaceResult[] });
    } catch {
      setState({ kind: 'error' });
    }
  }

  return (
    <div class="place-search">
      <form role="search" onSubmit={(e) => void search(e)}>
        <label for={id}>{pt.search.label}</label>
        <div class="search-row">
          <input
            id={id}
            type="search"
            value={q}
            placeholder={pt.search.placeholder}
            autoComplete="off"
            autoFocus={autoFocus}
            onInput={(e) => setQ(e.currentTarget.value)}
          />
          <button type="submit" class="btn">
            {pt.search.submit}
          </button>
        </div>
      </form>
      <div role="status" class="search-status">
        {state.kind === 'loading' && pt.search.searching}
        {state.kind === 'error' && pt.search.error}
        {state.kind === 'done' && state.results.length === 0 && pt.search.noResults}
      </div>
      {state.kind === 'done' && state.results.length > 0 && (
        <ul class="search-results" aria-label={pt.search.results}>
          {state.results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                class="search-result"
                onClick={() => {
                  onPick(r);
                  setState({ kind: 'idle' });
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
