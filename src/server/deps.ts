/**
 * Adapters chosen per environment. Tests replace them (fake captcha, mailer,
 * in-memory rate limiter, fixed clock); routes and services only see interfaces.
 */
import { ulid } from 'ulidx';
import { FEATURES, MODERATION_MODE, type Features, type ModerationMode } from '../config/app';
import { lisbonToday } from '../shared/dates';
import { systemClock, type Clock } from './clock';
import type { Env } from './env';
import { kvOpsStore, type OpsStore } from './repos/ops-store';
import { r2PosterStore, type PosterStore } from './repos/poster-store';
import { KvDevMailbox, NullMailer, ResendMailer, type Mailer } from './mailer';
import { TurnstileVerifier, type CaptchaVerifier } from './security/captcha';
import { KvRateLimiter, type RateLimiter } from './security/rate-limit';
import { clientKey, emailKey } from './security/tokens';
import { ClaudeExtractor, FakeExtractor, type EventExtractor } from './services/event-extractor';
import { FakePlaceSearch, PhotonSearch, type PlaceSearch } from './services/place-search';

// Note: never store the global `fetch` unbound and call it as a method
// (`this.fetchFn(...)`): the Workers runtime throws "Illegal invocation".

export interface AppDeps {
  clock: Clock;
  captcha: (env: Env) => CaptchaVerifier;
  mailer: (env: Env) => Mailer;
  rateLimiter: (env: Env) => RateLimiter;
  placeSearch: (env: Env) => PlaceSearch;
  /** Admin import; null when not configured (no ANTHROPIC_API_KEY). */
  extractor: (env: Env) => EventExtractor | null;
  /** Poster files (SPEC §4.7). */
  posters: (env: Env) => PosterStore;
  /** Daily job state and import counts (docs/decisions.md #82). */
  ops: (env: Env) => OpsStore;
  newId: () => string;
  /** Which optional features are mounted (FEATURES; tests switch them on). */
  features: Features;
}

export const defaultDeps: AppDeps = {
  clock: systemClock,
  captcha: (env) => new TurnstileVerifier(env.TURNSTILE_SECRET_KEY),
  mailer: (env) =>
    devMailboxEnabled(env)
      ? new KvDevMailbox(env.RATE_LIMIT)
      : env.RESEND_API_KEY && env.MAIL_FROM
        ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
        : new NullMailer(),
  rateLimiter: (env) => new KvRateLimiter(env.RATE_LIMIT),
  placeSearch: (env) => (fakeExternal(env) ? new FakePlaceSearch() : new PhotonSearch()),
  extractor: (env) =>
    fakeExternal(env)
      ? new FakeExtractor()
      : env.ANTHROPIC_API_KEY
        ? new ClaudeExtractor(env.ANTHROPIC_API_KEY)
        : null,
  posters: (env) => r2PosterStore(env.POSTERS),
  ops: (env) => kvOpsStore(env.RATE_LIMIT),
  newId: () => ulid(),
  features: FEATURES,
};

/** e2e only: no calls to Claude or Photon. */
function fakeExternal(env: Env): boolean {
  return env.FAKE_EXTERNAL === 'on';
}

export function devMailboxEnabled(env: Env): boolean {
  return env.DEV_MAILBOX === 'on';
}

export function moderationMode(env: Env): ModerationMode {
  return env.MODERATION_MODE === 'pre' || env.MODERATION_MODE === 'post'
    ? env.MODERATION_MODE
    : MODERATION_MODE;
}

let warnedSecret = false;

function rateLimitSecret(env: Env): string {
  if (env.RATE_LIMIT_SECRET) return env.RATE_LIMIT_SECRET;
  if (!warnedSecret) console.error('RATE_LIMIT_SECRET is not configured');
  warnedSecret = true;
  return 'unconfigured';
}

/** Pseudonymous per-client key for rate limits (hashed IP, daily salt). */
export function requestClientKey(req: Request, env: Env, now: Date): Promise<string> {
  // Set by Cloudflare's edge; absent locally.
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  return clientKey(ip, rateLimitSecret(env), lisbonToday(now));
}

/** Pseudonymous key for an email address (per-address throttles). */
export function addressKey(email: string, env: Env): Promise<string> {
  return emailKey(email, rateLimitSecret(env));
}
