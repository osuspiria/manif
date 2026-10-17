/**
 * Public list (SPEC §5.1): approved organisations, then public individuals,
 * newest first, paginated, with a municipality filter.
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { municipalitiesByDistrict } from '../../shared/municipalities';
import type { PublicIndividual, PublicOrganization, PublicSignatures } from '../../shared/schemas';

const groups = municipalitiesByDistrict();

interface State {
  organizations: PublicOrganization[];
  individuals: PublicIndividual[];
  page: number;
  total: number;
}

export function SignatureList() {
  const [municipality, setMunicipality] = useState('');
  const [data, setData] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function load(page: number, filter: string) {
    setLoading(true);
    setError(false);
    try {
      const q = new URLSearchParams({ page: String(page) });
      if (filter) q.set('municipality', filter);
      const res = await fetch(`/api/signatures/public?${q.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as PublicSignatures;
      setData((prev) =>
        page === 1 || !prev
          ? body
          : {
              ...prev,
              individuals: [...prev.individuals, ...body.individuals],
              page: body.page,
              total: body.total,
            },
      );
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1, municipality);
  }, [municipality]);

  const s = pt.support;
  return (
    <div class="sig-list">
      <div class="field">
        <label for="sig-filter">{s.filterMunicipality}</label>
        <select
          id="sig-filter"
          value={municipality}
          onChange={(e) => setMunicipality(e.currentTarget.value)}
        >
          <option value="">{s.allMunicipalities}</option>
          {groups.map((g) => (
            <optgroup key={g.district} label={g.district}>
              {g.items.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {error && (
        <p class="form-error" role="alert">
          {s.listError}{' '}
          <button
            type="button"
            class="btn-link"
            onClick={() => void load(data ? data.page + 1 : 1, municipality)}
          >
            {pt.map.retry}
          </button>
        </p>
      )}
      {!data && loading && <p>{s.listLoading}</p>}

      {data && (
        <>
          <h3>{s.orgsHeading}</h3>
          {data.organizations.length ? (
            <ul class="sig-orgs">
              {data.organizations.map((o, i) => (
                <li key={i}>
                  <strong>
                    {o.website ? (
                      <a href={o.website} rel="nofollow ugc noopener noreferrer" target="_blank">
                        {o.name}
                      </a>
                    ) : (
                      o.name
                    )}
                  </strong>
                  <span class="sig-meta">
                    {s.orgTypes[o.type]} · {o.municipality}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="hint">{s.noOrgs}</p>
          )}

          <h3>{s.peopleHeading}</h3>
          {data.individuals.length ? (
            <>
              <ul class="sig-people">
                {data.individuals.map((p, i) => (
                  <li key={i}>
                    <strong>{p.name}</strong>
                    <span class="sig-meta">
                      {[p.activity, p.municipality].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
              <p class="hint" aria-live="polite">
                {s.showing(data.individuals.length, data.total)}
              </p>
              {data.individuals.length < data.total && (
                <button
                  type="button"
                  class="btn"
                  disabled={loading}
                  onClick={() => void load(data.page + 1, municipality)}
                >
                  {loading ? s.listLoading : s.loadMore}
                </button>
              )}
            </>
          ) : (
            <p class="hint">{s.noPeople}</p>
          )}
        </>
      )}
    </div>
  );
}
