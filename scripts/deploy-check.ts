/**
 * Pre-deploy checks (docs/deploy.md). A production build without these would
 * deploy fine and fail later: e.g. without PUBLIC_TURNSTILE_SITE_KEY the
 * client falls back to Cloudflare's test key, and every submission is then
 * rejected by the real secret.
 *
 * Usage: npm run deploy (runs this first). Pure functions + CLI.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const TEST_SITE_KEYS = [
  '1x00000000000000000000AA',
  '1x00000000000000000000BB',
  '2x00000000000000000000AB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
];

/**
 * The environment the production build will see: .env.production, which Astro
 * loads for `astro build`, with variables already set in the shell taking
 * precedence (Astro/Vite behave the same way).
 */
export function deployEnv(
  shellEnv: Record<string, string | undefined>,
  envFile: string | null,
): Record<string, string | undefined> {
  return { ...(envFile === null ? {} : parseEnv(envFile)), ...shellEnv };
}

export function checkDeployConfig(
  env: Record<string, string | undefined>,
  wranglerToml: string,
): string[] {
  const errors: string[] = [];
  const siteKey = env.PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (!siteKey)
    errors.push('PUBLIC_TURNSTILE_SITE_KEY is not set (Turnstile site key of the real widget).');
  else if (TEST_SITE_KEYS.includes(siteKey))
    errors.push('PUBLIC_TURNSTILE_SITE_KEY is a Cloudflare test key; use the real widget key.');

  const site = env.PUBLIC_SITE_URL?.trim();
  if (!site)
    errors.push('PUBLIC_SITE_URL is not set (e.g. https://exemplo.pt), needed for link previews.');
  else if (!/^https:\/\/[^/\s]+\.[^/\s]+\/?$/.test(site))
    errors.push(`PUBLIC_SITE_URL must be an https origin without a path, got "${site}".`);

  if (/database_id\s*=\s*"0{8}-0{4}-0{4}-0{4}-0{12}"/.test(wranglerToml))
    errors.push(
      'wrangler.toml: replace the D1 database_id (npx wrangler d1 create mobilizacao-pt).',
    );
  if (/\[\[kv_namespaces\]\][^[]*id\s*=\s*"0{32}"/.test(wranglerToml))
    errors.push('wrangler.toml: replace the KV id (npx wrangler kv namespace create RATE_LIMIT).');
  if (/^\s*DEV_MAILBOX\s*=/m.test(wranglerToml))
    errors.push('wrangler.toml: DEV_MAILBOX must not be set in production.');
  return errors;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const toml = readFileSync(resolve(import.meta.dirname, '../wrangler.toml'), 'utf8');
  const envPath = resolve(import.meta.dirname, '../.env.production');
  const envFile = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
  const errors = checkDeployConfig(deployEnv(process.env, envFile), toml);
  if (errors.length) {
    console.error('Deploy blocked:\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log('Deploy configuration OK.');
}
