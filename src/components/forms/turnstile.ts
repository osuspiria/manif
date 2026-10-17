/**
 * Cloudflare Turnstile (the only third-party request allowed, CLAUDE.md).
 * The script is loaded only when a form is about to be submitted, never on
 * page load. Invisible mode: a token is requested on submit.
 */
interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      execution: 'execute';
      appearance: 'interaction-only';
      language: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'expired-callback': () => void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __onTurnstileLoad?: () => void;
  }
}

/** Public site key. Defaults to Cloudflare's "always passes (invisible)" test key. */
export const TURNSTILE_SITE_KEY: string =
  (import.meta.env.PUBLIC_TURNSTILE_SITE_KEY as string | undefined) ?? '1x00000000000000000000BB';

let loading: Promise<TurnstileApi> | null = null;

function load(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    window.__onTurnstileLoad = () => (window.turnstile ? resolve(window.turnstile) : reject());
    const s = document.createElement('script');
    s.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__onTurnstileLoad';
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile_load'));
    };
    document.head.append(s);
  });
  return loading;
}

/** Gets a fresh token, rendering the (normally invisible) widget into `container`. */
export async function getTurnstileToken(container: HTMLElement): Promise<string> {
  const ts = await load();
  return new Promise((resolve, reject) => {
    container.replaceChildren();
    const id = ts.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      execution: 'execute',
      appearance: 'interaction-only',
      language: 'pt',
      callback: (token) => {
        resolve(token);
        setTimeout(() => ts.remove(id), 0);
      },
      'error-callback': () => reject(new Error('turnstile_error')),
      'expired-callback': () => reject(new Error('turnstile_expired')),
    });
    ts.execute(id);
  });
}
