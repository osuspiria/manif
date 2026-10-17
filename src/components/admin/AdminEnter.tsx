/**
 * /admin/entrar/#t=<token>: exchanges the magic-link token for a session.
 * The token is in the fragment (never in logs); mail scanners that open the
 * link do not run this script, so they cannot use it up.
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { adminApi } from './api';

export function AdminEnter() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
    history.replaceState(null, '', window.location.pathname);
    if (!token) return setFailed(true);
    adminApi('/session', { json: { token } })
      .then((r) => (r.ok ? window.location.replace('/admin/') : setFailed(true)))
      .catch(() => setFailed(true));
  }, []);

  if (!failed) return <p>{pt.admin.entering}</p>;
  return (
    <>
      <p role="alert">{pt.admin.invalidLogin}</p>
      <p>
        <a class="btn-primary" href="/admin/">
          {pt.admin.requestNew}
        </a>
      </p>
    </>
  );
}
