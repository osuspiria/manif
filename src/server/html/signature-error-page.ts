/**
 * Error page for the signature form submitted without JavaScript (SPEC §9:
 * the form works as a plain POST). Lists the problems; never echoes what was
 * typed (no personal data in responses).
 */
import { pt } from '../../i18n/pt';
import type { ApiIssue } from '../../shared/schemas';
import { escapeHtml as escape } from './escape';

type FieldKey = keyof typeof pt.support.fields;

function fieldLabel(path: (string | number)[], kind: string): string | null {
  const key = path[0];
  if (typeof key !== 'string') return null;
  if (key === 'email' && kind === 'organization') return pt.support.fields.orgEmail;
  if (key === 'municipality' && kind === 'organization') return pt.support.fields.municipalityOrg;
  return key in pt.support.fields ? pt.support.fields[key as FieldKey] : null;
}

export function signatureErrorPage(opts: {
  message: string;
  issues?: ApiIssue[];
  kind?: string;
}): string {
  const items = (opts.issues ?? []).map((i) => {
    const label = fieldLabel(i.path, opts.kind ?? 'individual');
    const text = pt.errors.codes[i.code] ?? pt.support.errors.generic;
    return `<li>${label ? `<strong>${escape(label)}:</strong> ` : ''}${escape(text)}</li>`;
  });
  return `<!doctype html>
<html lang="pt-PT">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(pt.support.errors.pageTitle)} · ${escape(pt.site.title)}</title>
<style>
body{margin:0;font-family:system-ui,sans-serif;line-height:1.5;color:#1a1a1a;background:#fff}
main{max-width:640px;margin:0 auto;padding:16px}
h1{font-size:1.375rem}
.err{color:#b3261e}
a{display:inline-flex;align-items:center;min-height:44px;color:#0b57d0}
</style>
</head>
<body>
<main>
<h1>${escape(pt.support.errors.pageTitle)}</h1>
<p class="err" role="alert">${escape(opts.message)}</p>
${items.length ? `<ul>${items.join('')}</ul>` : ''}
<p>${escape(pt.support.errors.backHint)}</p>
<p><a href="/apoio/#assinar">${escape(pt.support.errors.back)}</a></p>
</main>
</body>
</html>`;
}
