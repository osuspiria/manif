/** "Reportar" inside the event sheet (SPEC §4.3). Native radios, no third parties. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { REPORT_REASONS, type ReportReason } from '../../config/reports';

interface Props {
  eventId: string;
  onClose: () => void;
}

export function ReportForm({ eventId, onClose }: Props) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [detail, setDetail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'missing'>('idle');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRadio = useRef<HTMLInputElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  async function submit(e: Event) {
    e.preventDefault();
    if (!reason) {
      setState('missing');
      firstRadio.current?.focus();
      return;
    }
    setState('sending');
    try {
      const res = await fetch(`/api/events/${eventId}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, detail }),
      });
      setState(res.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return (
      <div class="report">
        <p role="status">{pt.report.thanks}</p>
        <button type="button" class="btn" onClick={onClose}>
          {pt.event.close}
        </button>
      </div>
    );
  }

  return (
    <form class="report" onSubmit={(e) => void submit(e)}>
      <h3 tabIndex={-1} ref={headingRef}>
        {pt.report.heading}
      </h3>
      <fieldset aria-describedby={state === 'missing' ? 'report-error' : undefined}>
        <legend>{pt.report.reason}</legend>
        {REPORT_REASONS.map((r, i) => (
          <div class="field-check" key={r}>
            <input
              id={`report-${r}`}
              type="radio"
              name="reason"
              value={r}
              ref={i === 0 ? firstRadio : undefined}
              checked={reason === r}
              aria-invalid={state === 'missing' ? 'true' : undefined}
              onChange={() => setReason(r)}
            />
            <label for={`report-${r}`}>{pt.report.reasons[r]}</label>
          </div>
        ))}
        {state === 'missing' && (
          <p class="field-error" id="report-error">
            {pt.errors.codes.required}
          </p>
        )}
      </fieldset>
      <div class="field">
        <label for="report-detail">{pt.report.detail}</label>
        <textarea
          id="report-detail"
          maxLength={500}
          rows={2}
          value={detail}
          onInput={(e) => setDetail(e.currentTarget.value)}
        />
      </div>
      <p role="alert" class="form-error">
        {state === 'error' ? pt.report.error : ''}
      </p>
      <div class="add-actions">
        <button type="button" class="btn" onClick={onClose}>
          {pt.report.cancel}
        </button>
        <button type="submit" class="btn-primary" disabled={state === 'sending'}>
          {pt.report.submit}
        </button>
      </div>
    </form>
  );
}
