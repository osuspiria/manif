/** Cloudflare Turnstile verification (SPEC §8). */
export interface CaptchaVerifier {
  verify(token: string): Promise<boolean>;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export class TurnstileVerifier implements CaptchaVerifier {
  constructor(
    private readonly secret: string | undefined,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async verify(token: string): Promise<boolean> {
    if (!this.secret) {
      // Fail closed: a missing secret must never let submissions through.
      console.error('TURNSTILE_SECRET_KEY is not configured');
      return false;
    }
    const body = new FormData();
    body.append('secret', this.secret);
    body.append('response', token);
    // The client IP is deliberately not sent.
    try {
      const res = await this.fetchFn(SITEVERIFY, { method: 'POST', body });
      if (!res.ok) {
        console.error(`turnstile siteverify HTTP ${res.status}`);
        return false;
      }
      const json: { success?: boolean; 'error-codes'?: string[] } = await res.json();
      // Error codes only (never the token): e.g. timeout-or-duplicate, invalid-input-secret.
      if (json.success !== true)
        console.error(`turnstile rejected: ${(json['error-codes'] ?? []).join(',')}`);
      return json.success === true;
    } catch (e) {
      console.error(`turnstile siteverify failed: ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    }
  }
}

export class FakeCaptcha implements CaptchaVerifier {
  constructor(private readonly result = true) {}
  verify(): Promise<boolean> {
    return Promise.resolve(this.result);
  }
}
