/**
 * Adapters chosen per environment. Tests replace them (fake captcha, mailer,
 * in-memory rate limiter, fixed clock); routes and services only see interfaces.
 */
import { ulid } from 'ulidx';
import { MODERATION_MODE, type ModerationMode } from '../config/app';
import { lisbonToday } from '../shared/dates';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { NullMailer, ResendMailer, type Mailer } from './mailer';
import { TurnstileVerifier, type CaptchaVerifier } from './security/captcha';
import { KvRateLimiter, type RateLimiter } from './security/rate-limit';
import { clientKey } from './security/tokens';
import { PhotonSearch, type PlaceSearch } from './services/place-search';

// Note: never store the global `fetch` unbound and call it as a method
// (`this.fetchFn(...)`): the Workers runtime throws "Illegal invocation".

export interface AppDeps {
  clock: Clock;
  captcha: (env: Env) => CaptchaVerifier;
  mailer: (env: Env) => Mailer;
  rateLimiter: (env: Env) => RateLimiter;
  placeSearch: (env: Env) => PlaceSearch;
  newId: () => string;
}

export const defaultDeps: AppDeps = {
  clock: systemClock,
  captcha: (env) => new TurnstileVerifier(env.TURNSTILE_SECRET_KEY),
  mailer: (env) =>
    env.RESEND_API_KEY && env.MAIL_FROM
      ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
      : new NullMailer(),
  rateLimiter: (env) => new KvRateLimiter(env.RATE_LIMIT),
  placeSearch: () => new PhotonSearch(),
  newId: () => ulid(),
};

export function moderationMode(env: Env): ModerationMode {
  return env.MODERATION_MODE === 'pre' || env.MODERATION_MODE === 'post'
    ? env.MODERATION_MODE
    : MODERATION_MODE;
}

let warnedSecret = false;

/** Pseudonymous per-client key for rate limits (hashed IP, daily salt). */
export function requestClientKey(req: Request, env: Env, now: Date): Promise<string> {
  // Set by Cloudflare's edge; absent locally.
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  let secret = env.RATE_LIMIT_SECRET;
  if (!secret) {
    if (!warnedSecret) console.error('RATE_LIMIT_SECRET is not configured');
    warnedSecret = true;
    secret = 'unconfigured';
  }
  return clientKey(ip, secret, lisbonToday(now));
}
