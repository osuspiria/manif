/** Admin sign-in: asks for a magic link (SPEC §6). Same message for every address. */
import { useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { TextField } from '../forms/fields';
import { adminApi } from './api';

export function AdminLogin({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: Event) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await adminApi<{ error?: string }>('/login', { json: { email } });
      if (res.ok) setSent(true);
      else if (res.status === 400) setError(pt.errors.codes.invalid_email ?? '');
      else if (res.status === 429) setError(pt.add.errors.rate_limited);
      else setError(pt.admin.actionError);
    } catch {
      setError(pt.add.errors.network);
    } finally {
      setSending(false);
    }
  }

  return (
    <section class="admin-login" aria-labelledby="admin-login-heading">
      <h2 id="admin-login-heading">{pt.admin.loginHeading}</h2>
      {expired && <p role="status">{pt.admin.sessionExpired}</p>}
      {sent ? (
        <p role="status" class="form-ok">
          {pt.admin.linkSent}
        </p>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <p>{pt.admin.loginText}</p>
          <TextField
            id="admin-email"
            label={pt.admin.email}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onValue={setEmail}
            error={error || undefined}
          />
          <button type="submit" class="btn-primary" disabled={sending}>
            {sending ? pt.admin.sending : pt.admin.sendLink}
          </button>
        </form>
      )}
    </section>
  );
}
