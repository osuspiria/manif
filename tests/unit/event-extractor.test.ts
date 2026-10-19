import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/config/app';
import {
  normalizeDraft,
  userPrompt,
  type RawDraft,
} from '../../src/server/services/event-extractor';
import { addDays, isValidLocalDate } from '../../src/shared/dates';

const raw = (over: Partial<RawDraft> = {}): RawDraft => ({
  type: 'rally',
  title: 'Concentração pela habitação',
  description: 'Descrição.',
  organizer: 'Coletivo Exemplo',
  placeQuery: 'Praça do Município, Lisboa',
  occurrences: [{ localDate: '2026-11-18', startTime: '18:00', endTime: '20:00', note: null }],
  warnings: [],
  ...over,
});

describe('normalizeDraft', () => {
  it('keeps a well-formed draft as it is', () => {
    expect(normalizeDraft(raw())).toEqual(raw());
  });

  it('clips texts to the form limits and turns blanks into null', () => {
    const d = normalizeDraft(
      raw({
        title: `  ${'x'.repeat(200)}  `,
        description: '   ',
        organizer: '',
        placeQuery: ' Rossio, Lisboa ',
      }),
    );
    expect(d.title).toHaveLength(LIMITS.titleMax);
    expect(d.description).toBeNull();
    expect(d.organizer).toBeNull();
    expect(d.placeQuery).toBe('Rossio, Lisboa');
  });

  it('drops invalid dates and times, and end times without a usable start', () => {
    const d = normalizeDraft(
      raw({
        occurrences: [
          { localDate: '2026-02-30', startTime: '18:00', endTime: null, note: null },
          { localDate: '25/11', startTime: '18:00', endTime: null, note: null },
          { localDate: '2026-11-20', startTime: '18h', endTime: '20:00', note: null },
          { localDate: '2026-11-21', startTime: '18:00', endTime: '18:00', note: null },
          { localDate: '2026-11-22', startTime: '25:00', endTime: null, note: null },
        ],
      }),
    );
    expect(d.occurrences).toEqual([
      { localDate: '2026-11-20', startTime: null, endTime: null, note: null },
      { localDate: '2026-11-21', startTime: '18:00', endTime: null, note: null },
      { localDate: '2026-11-22', startTime: null, endTime: null, note: null },
    ]);
  });

  it('removes duplicates, sorts by date and time, and caps the number of dates', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      localDate: addDays('2027-01-01', i),
      startTime: '10:00',
      endTime: null,
      note: null,
    }));
    const d = normalizeDraft(
      raw({
        occurrences: [
          { localDate: '2026-11-20', startTime: '18:00', endTime: null, note: null },
          { localDate: '2026-11-18', startTime: null, endTime: null, note: null },
          { localDate: '2026-11-20', startTime: '18:00', endTime: '20:00', note: 'dup' },
          { localDate: '2026-11-20', startTime: '10:00', endTime: null, note: null },
        ],
      }),
    );
    expect(d.occurrences.map((o) => `${o.localDate} ${o.startTime ?? ''}`)).toEqual([
      '2026-11-18 ',
      '2026-11-20 10:00',
      '2026-11-20 18:00',
    ]);
    expect(normalizeDraft(raw({ occurrences: many })).occurrences).toHaveLength(
      LIMITS.occurrencesMax,
    );
  });

  it('keeps at most five short warnings', () => {
    const d = normalizeDraft(raw({ warnings: ['', ' a ', 'b', 'c', 'd', 'e', 'f'] }));
    expect(d.warnings).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('userPrompt', () => {
  it("starts with today's Lisbon date and weekday, then the post as data", () => {
    const p = userPrompt('Concentração sábado às 15h', '2026-10-19');
    expect(p.split('\n')[0]).toBe('Today is Monday, 2026-10-19 (Portugal).');
    expect(p).toContain('<post>\nConcentração sábado às 15h\n</post>');
  });

  it('points at the image when there is no text', () => {
    expect(userPrompt(undefined, '2026-10-25')).toContain('Today is Sunday, 2026-10-25');
    expect(userPrompt(undefined, '2026-10-25')).toContain('read the event from the image');
  });
});

describe('isValidLocalDate', () => {
  it('accepts real days only', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-1-01')).toBe(false);
  });
});
