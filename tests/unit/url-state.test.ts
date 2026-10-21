import { describe, expect, it } from 'vitest';
import { isDefaultFilter, parseMapUrl, serializeMapUrl } from '../../src/shared/url-state';

describe('parseMapUrl', () => {
  it('defaults to upcoming, all types, map view', () => {
    expect(parseMapUrl('')).toEqual({ when: { kind: 'upcoming' }, types: [], view: 'map' });
  });

  it.each([
    ['hoje', 'today'],
    ['amanha', 'tomorrow'],
    ['fds', 'weekend'],
    ['7dias', 'next7'],
    ['passados', 'past'],
    ['proximos', 'upcoming'],
  ] as const)('quando=%s → %s', (param, kind) => {
    expect(parseMapUrl(`?quando=${param}`).when).toEqual({ kind });
  });

  it('parses the SPEC example', () => {
    expect(parseMapUrl('?quando=fds&tipo=rally,action')).toEqual({
      when: { kind: 'weekend' },
      types: ['rally', 'action'],
      view: 'map',
    });
  });

  it('parses a picked day', () => {
    expect(parseMapUrl('?dia=2026-11-25').when).toEqual({ kind: 'day', date: '2026-11-25' });
  });

  it('dia wins over quando', () => {
    expect(parseMapUrl('?quando=hoje&dia=2026-11-25').when).toEqual({
      kind: 'day',
      date: '2026-11-25',
    });
  });

  it('ignores invalid values', () => {
    expect(parseMapUrl('?quando=ontem').when).toEqual({ kind: 'upcoming' });
    expect(parseMapUrl('?dia=2026-13-45').when).toEqual({ kind: 'upcoming' });
    expect(parseMapUrl('?dia=amanha').when).toEqual({ kind: 'upcoming' });
    expect(parseMapUrl('?tipo=rally,banana,,rally').types).toEqual(['rally']);
  });

  it('parses the list view', () => {
    expect(parseMapUrl('?vista=lista').view).toBe('list');
    expect(parseMapUrl('?vista=xpto').view).toBe('map');
  });
});

describe('serializeMapUrl', () => {
  it('omits defaults', () => {
    expect(serializeMapUrl({ when: { kind: 'upcoming' }, types: [], view: 'map' })).toBe('');
  });

  it('serializes the SPEC example with a canonical type order', () => {
    expect(
      serializeMapUrl({ when: { kind: 'weekend' }, types: ['action', 'rally'], view: 'map' }),
    ).toBe('?quando=fds&tipo=rally,action');
  });

  it('serializes a picked day and the list view', () => {
    expect(
      serializeMapUrl({ when: { kind: 'day', date: '2026-11-25' }, types: [], view: 'list' }),
    ).toBe('?dia=2026-11-25&vista=lista');
  });

  it('round-trips', () => {
    for (const qs of [
      '?quando=hoje',
      '?quando=7dias&tipo=assembly',
      '?dia=2026-12-01&vista=lista',
    ]) {
      expect(serializeMapUrl(parseMapUrl(qs))).toBe(qs);
    }
  });
});

describe('isDefaultFilter', () => {
  it('is true only for upcoming + all types', () => {
    expect(isDefaultFilter({ when: { kind: 'upcoming' }, types: [] })).toBe(true);
    expect(isDefaultFilter({ when: { kind: 'today' }, types: [] })).toBe(false);
    expect(isDefaultFilter({ when: { kind: 'upcoming' }, types: ['rally'] })).toBe(false);
  });
});
