/**
 * Progressive enhancement of the signature forms (SignatureForms.astro):
 * gets a Turnstile token on submit, sends the form with fetch and shows the
 * server's validation errors next to the fields, with focus on the first one.
 * Without this script the forms still POST normally (SPEC §9).
 */
import { getTurnstileToken, preloadTurnstile } from '../components/forms/turnstile';
import { pt } from '../i18n/pt';
import type { ApiIssue } from '../shared/schemas';

const CHECK_EMAIL_PAGE = '/apoio/confirma-email/';

type Control = HTMLInputElement | HTMLSelectElement;

function controls(form: HTMLFormElement, name: string): Control[] {
  return [...form.querySelectorAll<Control>(`[name="${CSS.escape(name)}"]`)].filter(
    (el) => el.type !== 'hidden',
  );
}

function errorEl(form: HTMLFormElement, name: string): HTMLElement | null {
  return form.querySelector<HTMLElement>(`#${form.dataset.prefix ?? ''}-${CSS.escape(name)}-error`);
}

function describedBy(el: Control, errorId: string, on: boolean): void {
  const ids = new Set((el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean));
  if (on) ids.add(errorId);
  else ids.delete(errorId);
  if (ids.size) el.setAttribute('aria-describedby', [...ids].join(' '));
  else el.removeAttribute('aria-describedby');
}

function clearErrors(form: HTMLFormElement): void {
  const errors = [...form.querySelectorAll<HTMLElement>('.field-error')];
  for (const el of form.querySelectorAll<Control>('[aria-invalid]')) {
    el.removeAttribute('aria-invalid');
    for (const p of errors) describedBy(el, p.id, false);
  }
  for (const p of errors) {
    p.hidden = true;
    p.textContent = '';
  }
  setFormError(form, '');
}

function setFormError(form: HTMLFormElement, text: string): void {
  const p = form.querySelector<HTMLElement>('[data-form-error]');
  if (p) p.textContent = text;
}

function showIssues(form: HTMLFormElement, issues: ApiIssue[]): void {
  for (const issue of issues) {
    const name = String(issue.path[0] ?? '');
    const p = errorEl(form, name);
    const els = controls(form, name);
    if (!p || !els.length) continue;
    if (!p.textContent) p.textContent = pt.errors.codes[issue.code] ?? pt.support.errors.generic;
    p.hidden = false;
    for (const el of els) {
      el.setAttribute('aria-invalid', 'true');
      describedBy(el, p.id, true);
    }
  }
  setFormError(form, pt.support.errors.fix);
  // Focus the first invalid field in document order.
  form.querySelector<Control>('[aria-invalid="true"]')?.focus();
}

function busy(form: HTMLFormElement, on: boolean): void {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button) return;
  button.disabled = on;
  button.textContent = on ? pt.support.submitting : (button.dataset.label ?? '');
}

async function submit(form: HTMLFormElement): Promise<void> {
  clearErrors(form);
  busy(form, true);
  try {
    const data = new FormData(form);
    const captcha = form.querySelector<HTMLElement>('[data-captcha]');
    try {
      if (captcha) data.set('cf-turnstile-response', await getTurnstileToken(captcha));
    } catch {
      setFormError(form, pt.support.errors.captcha_failed);
      return;
    } finally {
      captcha?.replaceChildren();
    }
    let res: Response;
    try {
      res = await fetch(form.action, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      });
    } catch {
      setFormError(form, pt.support.errors.network);
      return;
    }
    if (res.status === 202) {
      window.location.assign(CHECK_EMAIL_PAGE);
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: ApiIssue[] };
    if (body.error === 'invalid' && body.issues?.length) {
      showIssues(form, body.issues);
      return;
    }
    const messages: Record<string, string> = pt.support.errors;
    setFormError(form, messages[body.error ?? ''] ?? pt.support.errors.generic);
  } finally {
    busy(form, false);
  }
}

for (const form of document.querySelectorAll<HTMLFormElement>('form[data-signature-form]')) {
  // Our errors replace the browser's bubbles (consistent wording, linked to the fields).
  form.noValidate = true;
  form.addEventListener('focusin', preloadTurnstile, { once: true });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit(form);
  });
}
