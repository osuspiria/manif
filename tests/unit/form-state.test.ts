import { describe, expect, it } from 'vitest';
import {
  detailsToInput,
  emptyRow,
  fromEditable,
  issuesToErrors,
  remapRowIssues,
  rowToEdit,
  rowToOccurrence,
} from '../../src/components/forms/form-state';

describe('rows', () => {
  it('a new row copies the times of the previous one, not its date', () => {
    const prev = { ...emptyRow(), localDate: '2026-11-12', startTime: '18:00', endTime: '20:00' };
    expect(emptyRow(prev)).toMatchObject({ localDate: '', startTime: '18:00', endTime: '20:00' });
  });

  it('converts empty strings to null and all-day to no times', () => {
    const r = {
      ...emptyRow(),
      localDate: '2026-11-12',
      startTime: '18:00',
      endTime: '',
      note: ' ',
    };
    expect(rowToOccurrence(r)).toEqual({
      localDate: '2026-11-12',
      startTime: '18:00',
      endTime: null,
      note: null,
    });
    expect(rowToOccurrence({ ...r, allDay: true, endTime: '20:00' })).toMatchObject({
      startTime: null,
      endTime: null,
    });
  });

  it('keeps id and cancelled for edits', () => {
    const r = { ...emptyRow(), id: 'o1', localDate: '2026-11-12', cancelled: true };
    expect(rowToEdit(r)).toMatchObject({ id: 'o1', cancelled: true });
  });
});

describe('details', () => {
  it('trims and nulls optional fields', () => {
    expect(
      detailsToInput({
        type: 'rally',
        title: ' Título ',
        description: '',
        organizer: ' X ',
        placeLabel: '',
      }),
    ).toEqual({
      type: 'rally',
      title: 'Título',
      description: null,
      organizer: 'X',
      placeLabel: null,
    });
  });
});

describe('fromEditable', () => {
  it('marks past occurrences read-only', () => {
    const { rows } = fromEditable(
      {
        id: 'e',
        type: 'rally',
        title: 'T',
        description: null,
        organizer: null,
        lat: 0,
        lng: 0,
        placeLabel: null,
        municipality: 'Porto',
        district: 'Porto',
        tz: 'Europe/Lisbon',
        verified: false,
        status: 'published',
        occurrences: [
          {
            id: 'a',
            localDate: '2026-11-04',
            startTime: null,
            endTime: null,
            startsAt: '2026-11-04T00:00:00Z',
            endsAt: '2026-11-05T00:00:00Z',
            note: null,
            cancelled: false,
          },
          {
            id: 'b',
            localDate: '2026-11-18',
            startTime: '18:00',
            endTime: null,
            startsAt: '2026-11-18T18:00:00Z',
            endsAt: '2026-11-19T00:00:00Z',
            note: 'n',
            cancelled: true,
          },
        ],
      },
      '2026-11-11T10:00:00Z',
    );
    expect(rows.map((r) => [r.id, r.past, r.allDay, r.cancelled])).toEqual([
      ['a', true, true, false],
      ['b', false, false, true],
    ]);
  });
});

describe('errors', () => {
  it('maps codes to pt-PT messages, first message per field wins', () => {
    expect(
      issuesToErrors([
        { path: ['title'], code: 'too_short' },
        { path: ['title'], code: 'too_long' },
        { path: ['occurrences', 1, 'localDate'], code: 'occurrence_past' },
      ]),
    ).toEqual({ title: 'Demasiado curto.', 'occurrences.1.localDate': 'Esta data já passou.' });
  });

  it('remaps row indexes after validating a subset of rows', () => {
    expect(remapRowIssues([{ path: ['occurrences', 0, 'localDate'], code: 'x' }], [2, 3])).toEqual([
      { path: ['occurrences', 2, 'localDate'], code: 'x' },
    ]);
  });
});
