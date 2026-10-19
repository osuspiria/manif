/**
 * /admin (SPEC §6): sign-in by magic link, then two tabs — Eventos and
 * Assinaturas. Hash routes: #eventos, #eventos/novo, #eventos/<id>, #assinaturas.
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { adminApi, setUnauthorizedHandler } from './api';
import { AdminEventDetail } from './AdminEventDetail';
import { AdminEvents } from './AdminEvents';
import { AdminLogin } from './AdminLogin';
import { AdminNewEvent } from './AdminNewEvent';
import { AdminSignatures } from './AdminSignatures';

type Auth =
  | { state: 'checking' }
  | { state: 'out'; expired?: boolean }
  | { state: 'in'; email: string; signatures: boolean };

type Route = { tab: 'events'; eventId?: string } | { tab: 'signatures' };

function parseRoute(hash: string): Route {
  const [first, id] = hash.replace(/^#/, '').split('/');
  if (first === 'assinaturas') return { tab: 'signatures' };
  return { tab: 'events', eventId: id || undefined };
}

export function AdminApp() {
  const [auth, setAuth] = useState<Auth>({ state: 'checking' });
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    setUnauthorizedHandler(() => setAuth({ state: 'out', expired: true }));
    adminApi<{ email?: string; features?: { signatures?: boolean } }>('/me')
      .then((r) =>
        setAuth(
          r.ok && r.data.email
            ? { state: 'in', email: r.data.email, signatures: r.data.features?.signatures === true }
            : { state: 'out' },
        ),
      )
      .catch(() => setAuth({ state: 'out' }));
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  async function logout() {
    await adminApi('/logout', { method: 'POST' }).catch(() => undefined);
    setAuth({ state: 'out' });
  }

  if (auth.state === 'checking') return <p>{pt.admin.loading}</p>;
  if (auth.state === 'out') return <AdminLogin expired={auth.expired} />;

  return (
    <div class="admin">
      <div class="admin-bar">
        <span class="admin-who">{pt.admin.signedInAs(auth.email)}</span>
        <button type="button" class="btn" onClick={() => void logout()}>
          {pt.admin.logout}
        </button>
      </div>
      <nav class="admin-tabs" aria-label={pt.admin.title}>
        <a
          class="chip"
          href="#eventos"
          aria-current={route.tab === 'signatures' && auth.signatures ? undefined : 'page'}
        >
          {pt.admin.tabs.events}
        </a>
        {auth.signatures && (
          <a
            class="chip"
            href="#assinaturas"
            aria-current={route.tab === 'signatures' ? 'page' : undefined}
          >
            {pt.admin.tabs.signatures}
          </a>
        )}
      </nav>
      {route.tab === 'signatures' && auth.signatures ? (
        <AdminSignatures />
      ) : route.tab === 'events' && route.eventId === 'novo' ? (
        <AdminNewEvent />
      ) : route.tab === 'events' && route.eventId ? (
        <AdminEventDetail id={route.eventId} />
      ) : (
        <AdminEvents />
      )}
    </div>
  );
}
