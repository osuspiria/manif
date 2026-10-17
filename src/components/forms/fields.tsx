/**
 * Accessible form fields: visible labels, hints and errors linked with
 * aria-describedby, aria-invalid on error (CLAUDE.md › Formulários).
 */
import type { ComponentChildren } from 'preact';

interface BaseProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

function describedBy(p: BaseProps): string | undefined {
  const ids = [p.hint && `${p.id}-hint`, p.error && `${p.id}-error`].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

function Messages(p: BaseProps) {
  return (
    <>
      {p.hint && (
        <p class="hint" id={`${p.id}-hint`}>
          {p.hint}
        </p>
      )}
      {p.error && (
        <p class="field-error" id={`${p.id}-error`}>
          {p.error}
        </p>
      )}
    </>
  );
}

interface InputProps extends BaseProps {
  value: string;
  onValue: (v: string) => void;
  type?: 'text' | 'email' | 'date' | 'time' | 'search';
  required?: boolean;
  maxLength?: number;
  autoComplete?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  inputMode?: 'text' | 'email' | 'search';
}

export function TextField(p: InputProps) {
  return (
    <div class={`field field-${p.type ?? 'text'}`}>
      <label for={p.id}>{p.label}</label>
      <input
        id={p.id}
        name={p.id}
        // Preact's per-type input typings reject a union; every value here is valid HTML.
        type={(p.type ?? 'text') as 'text'}
        value={p.value}
        required={p.required}
        maxLength={p.maxLength}
        autoComplete={p.autoComplete ?? 'off'}
        min={p.min}
        max={p.max}
        disabled={p.disabled}
        inputMode={p.inputMode}
        aria-invalid={p.error ? 'true' : undefined}
        aria-describedby={describedBy(p)}
        onInput={(e) => p.onValue(e.currentTarget.value)}
      />
      <Messages {...p} />
    </div>
  );
}

interface AreaProps extends BaseProps {
  value: string;
  onValue: (v: string) => void;
  maxLength?: number;
  rows?: number;
}

export function TextArea(p: AreaProps) {
  return (
    <div class="field">
      <label for={p.id}>{p.label}</label>
      <textarea
        id={p.id}
        name={p.id}
        value={p.value}
        maxLength={p.maxLength}
        rows={p.rows ?? 3}
        aria-invalid={p.error ? 'true' : undefined}
        aria-describedby={describedBy(p)}
        onInput={(e) => p.onValue(e.currentTarget.value)}
      />
      {p.maxLength && (
        <p class="hint counter" aria-hidden="true">
          {p.value.length}/{p.maxLength}
        </p>
      )}
      <Messages {...p} />
    </div>
  );
}

export function Checkbox(p: {
  id: string;
  label: string;
  checked: boolean;
  onChecked: (v: boolean) => void;
}) {
  return (
    <div class="field field-check">
      <input
        id={p.id}
        type="checkbox"
        checked={p.checked}
        onChange={(e) => p.onChecked(e.currentTarget.checked)}
      />
      <label for={p.id}>{p.label}</label>
    </div>
  );
}

/** Group of options as native radios (styled as chips). */
export function RadioChips<T extends string>(p: {
  name: string;
  legend: string;
  options: { value: T; label: ComponentChildren }[];
  value: T | '';
  onValue: (v: T) => void;
  error?: string;
}) {
  const errorId = `${p.name}-error`;
  return (
    <fieldset class="field radio-chips" aria-describedby={p.error ? errorId : undefined}>
      <legend>{p.legend}</legend>
      <div class="chips chips-wrap">
        {p.options.map((o) => (
          <label key={o.value} class="chip chip-radio">
            <input
              type="radio"
              name={p.name}
              value={o.value}
              checked={p.value === o.value}
              aria-invalid={p.error ? 'true' : undefined}
              aria-describedby={p.error ? errorId : undefined}
              onChange={() => p.onValue(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {p.error && (
        <p class="field-error" id={errorId}>
          {p.error}
        </p>
      )}
    </fieldset>
  );
}
