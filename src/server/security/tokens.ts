/**
 * Secret tokens (edit links, later confirmation links): 32 random bytes,
 * base64url. Only the SHA-256 hash is stored.
 */

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function newToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

/** Constant-time comparison of two equal-length hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}

/**
 * Pseudonymous client key for rate limiting: HMAC of the IP with a salt that
 * changes every day (derived from a server secret + the date). The IP itself
 * is never stored or logged (CLAUDE.md › Privacidade).
 */
export async function clientKey(ip: string, secret: string, day: string): Promise<string> {
  const salt = await hmac(secret, `ip-salt:${day}`);
  return (await hmac(salt, ip)).slice(0, 32);
}
