/**
 * Admin API client. Every write carries X-Admin-Request (CSRF check on the
 * server); the session cookie (path /api/admin) is sent by the browser.
 */
let onUnauthorized: () => void = () => undefined;

/** Called when the session has ended (401): the app goes back to the login form. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

/** Throws only on network errors. */
export async function adminApi<T>(
  path: string,
  /** `form`: multipart body (the browser sets its Content-Type). */
  init: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<ApiResult<T>> {
  const method = init.method ?? (init.json === undefined && !init.form ? 'GET' : 'POST');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['X-Admin-Request'] = '1';
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers,
    body: init.form ?? (init.json === undefined ? undefined : JSON.stringify(init.json)),
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/session')) onUnauthorized();
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}
