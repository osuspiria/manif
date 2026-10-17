import { describe, expect, it } from 'vitest';
import { checkDeployConfig, deployEnv } from '../../scripts/deploy-check';

const READY_TOML = `
[[d1_databases]]
binding = "DB"
database_id = "4f1c2d3e-aaaa-bbbb-cccc-123456789abc"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"
`;
const PLACEHOLDER_TOML = `
[[d1_databases]]
database_id = "00000000-0000-0000-0000-000000000000"

[[kv_namespaces]]
binding = "RATE_LIMIT"
id = "00000000000000000000000000000000"
`;
const ENV = {
  PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAAexemploReal',
  PUBLIC_SITE_URL: 'https://exemplo.pt',
};

describe('checkDeployConfig', () => {
  it('passes a complete configuration', () => {
    expect(checkDeployConfig(ENV, READY_TOML)).toEqual([]);
  });

  it('blocks a missing or test Turnstile site key', () => {
    expect(checkDeployConfig({ ...ENV, PUBLIC_TURNSTILE_SITE_KEY: '' }, READY_TOML)).toHaveLength(
      1,
    );
    expect(
      checkDeployConfig(
        { ...ENV, PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000BB' },
        READY_TOML,
      )[0],
    ).toMatch(/test key/);
  });

  it('needs an https origin as PUBLIC_SITE_URL', () => {
    expect(checkDeployConfig({ ...ENV, PUBLIC_SITE_URL: undefined }, READY_TOML)).toHaveLength(1);
    expect(
      checkDeployConfig({ ...ENV, PUBLIC_SITE_URL: 'http://exemplo.pt' }, READY_TOML),
    ).toHaveLength(1);
    expect(
      checkDeployConfig({ ...ENV, PUBLIC_SITE_URL: 'https://exemplo.pt/mapa' }, READY_TOML),
    ).toHaveLength(1);
    expect(
      checkDeployConfig({ ...ENV, PUBLIC_SITE_URL: 'https://exemplo.pt/' }, READY_TOML),
    ).toEqual([]);
  });

  it('blocks placeholder D1/KV ids and DEV_MAILBOX', () => {
    const errors = checkDeployConfig(ENV, PLACEHOLDER_TOML + '\n[vars]\nDEV_MAILBOX = "on"\n');
    expect(errors).toHaveLength(3);
  });
});

describe('deployEnv', () => {
  it('reads values from .env.production', () => {
    const env = deployEnv(
      {},
      'PUBLIC_SITE_URL=https://exemplo.pt\nPUBLIC_TURNSTILE_SITE_KEY=0x4AAA\n',
    );
    expect(env.PUBLIC_SITE_URL).toBe('https://exemplo.pt');
    expect(env.PUBLIC_TURNSTILE_SITE_KEY).toBe('0x4AAA');
  });

  it('lets the shell override the file, as Astro does', () => {
    const env = deployEnv(
      { PUBLIC_SITE_URL: 'https://outro.pt' },
      'PUBLIC_SITE_URL=https://exemplo.pt\n',
    );
    expect(env.PUBLIC_SITE_URL).toBe('https://outro.pt');
  });

  it('uses only the shell when there is no file', () => {
    expect(deployEnv({ PUBLIC_SITE_URL: 'https://exemplo.pt' }, null)).toEqual({
      PUBLIC_SITE_URL: 'https://exemplo.pt',
    });
  });
});
