/**
 * /editar/#e=<id>&t=<token> — edit an event with its secret link (SPEC §4.4):
 * change details and dates, cancel a date or the whole event. The token stays
 * in the URL fragment and is sent only in the X-Edit-Token header.
 */
import { useEffect, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import type { ApiIssue, EditableEvent } from '../../shared/schemas';
import { EventEditForm, type SaveResult } from '../forms/EventEditForm';
import { OwnerPoster } from './OwnerPoster';

type Load = { state: 'loading' } | { state: 'invalid' } | { state: 'ok'; event: EditableEvent };

function readFragment(): { id: string; token: string } | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const id = params.get('e');
  const token = params.get('t');
  return id && token ? { id, token } : null;
}

export function EditEventApp() {
  const [link] = useState(readFragment);
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  function reload() {
    if (!link) return setLoad({ state: 'invalid' });
    fetch(`/api/events/${link.id}/edit`, { headers: { 'X-Edit-Token': link.token } })
      .then((r) => (r.ok ? (r.json() as Promise<EditableEvent>) : null))
      .then((e) => setLoad(e ? { state: 'ok', event: e } : { state: 'invalid' }))
      .catch(() => setLoad({ state: 'invalid' }));
  }

  useEffect(reload, []);

  async function save(body: unknown): Promise<SaveResult> {
    if (!link) return { ok: false };
    try {
      const res = await fetch(`/api/events/${link.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Edit-Token': link.token },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as EditableEvent & { issues?: ApiIssue[] };
      return res.ok ? { ok: true, event: json } : { ok: false, issues: json.issues };
    } catch {
      return { ok: false, network: true };
    }
  }

  if (load.state === 'loading') return <p>{pt.edit.loading}</p>;
  if (load.state === 'invalid') return <p role="alert">{pt.edit.invalidLink}</p>;

  const e = load.event;
  return (
    <>
      <p>
        <strong>{pt.edit.statusLabel}:</strong> {pt.edit.status[e.status]} ·{' '}
        <span class={e.verified ? 'badge badge-ok' : 'badge'}>
          {e.verified ? pt.event.verified : pt.event.unverified}
        </span>
      </p>
      <p>
        <strong>{pt.edit.place}:</strong>{' '}
        {[e.placeLabel, e.municipality, e.district].filter(Boolean).join(' · ')}
      </p>
      <EventEditForm
        event={e}
        onSave={save}
        onSaved={(event) => setLoad({ state: 'ok', event })}
        verifiedNote={pt.edit.verifiedNote}
      />
      {link && <OwnerPoster event={e} token={link.token} onChanged={reload} />}
    </>
  );
}
