import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CRONS } from '../../src/config/app';

describe('CRONS', () => {
  it('match the Cron Triggers in wrangler.toml', () => {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const crons = /^crons = (\[.*\])$/m.exec(toml)?.[1] ?? '[]';
    expect(JSON.parse(crons)).toEqual([CRONS.daily, CRONS.digest]);
  });
});
