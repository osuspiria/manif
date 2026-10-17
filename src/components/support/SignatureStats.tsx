/** "4 321 apoios · 87 organizações" (SPEC §5.1): confirmed signatures only. */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { SignatureStats as Stats } from '../../shared/schemas';

const fmt = (n: number) => n.toLocaleString('pt-PT');

export function SignatureStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch('/api/signatures/stats')
      .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, []);

  if (!stats) return <p class="stats stats-loading">{pt.support.statsLoading}</p>;
  const s = pt.support;
  return (
    <p class="stats" data-testid="signature-stats">
      <span class="stats-n">
        {stats.supporters === 1 ? s.supportersOne : s.supporters(fmt(stats.supporters))}
      </span>
      <span aria-hidden="true"> · </span>
      <span class="stats-o">
        {stats.organizations === 1 ? s.orgsOne : s.orgs(fmt(stats.organizations))}
      </span>
    </p>
  );
}
