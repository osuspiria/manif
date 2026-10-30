import { describe, expect, it } from 'vitest';
import { toUtcRange, type Tz } from '../../src/shared/dates';
import type { PublicEvent } from '../../src/shared/schemas';
import { eventJsonLd, itemListJsonLd, jsonLdScript } from '../../src/shared/seo';

// Wednesday 11 Nov 2026, 10:00 Lisbon.
const NOW = new Date('2026-11-11T10:00:00Z');
const URL_ = 'https://manifesta.pt/mapa/e/01JC0000000000000000000AAA';

interface Occ {
  localDate: string;
  startTime: string | null;
  endTime?: string | null;
  cancelled?: boolean;
}

function event(occs: Occ[], over: Partial<PublicEvent> = {}): PublicEvent {
  const tz: Tz = over.tz ?? 'Europe/Lisbon';
  return {
    id: '01JC0000000000000000000AAA',
    type: 'rally',
    title: 'Concentração de teste',
    description: 'Descrição.',
    organizer: 'Coletivo Exemplo',
    lat: 38.71,
    lng: -9.14,
    placeLabel: 'Rossio',
    municipality: 'Lisboa',
    district: 'Lisboa',
    tz,
    verified: false,
    ongoingSince: null,
    poster: null,
    ...over,
    occurrences: occs.map((o, i) => {
      const local = { localDate: o.localDate, startTime: o.startTime, endTime: o.endTime ?? null };
      return {
        id: `o${i}`,
        ...local,
        ...toUtcRange(local, tz),
        note: null,
        cancelled: o.cancelled ?? false,
      };
    }),
  };
}

describe('eventJsonLd', () => {
  it('describes a timed event with its place, organizer and UTC instants', () => {
    const [ld] = eventJsonLd(
      event([{ localDate: '2026-11-18', startTime: '18:00', endTime: '20:00' }]),
      URL_,
      NOW,
    );
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Concentração de teste',
      url: URL_,
      startDate: '2026-11-18T18:00:00Z',
      endDate: '2026-11-18T20:00:00Z',
      eventStatus: 'https://schema.org/EventScheduled',
      location: {
        name: 'Rossio',
        address: { addressLocality: 'Lisboa', addressRegion: 'Lisboa', addressCountry: 'PT' },
      },
      organizer: { name: 'Coletivo Exemplo' },
    });
  });

  it('leaves out endDate when there is no end time, and organizer when there is none', () => {
    const [ld] = eventJsonLd(
      event([{ localDate: '2026-11-18', startTime: '18:00' }], { organizer: null }),
      URL_,
      NOW,
    );
    expect(ld).not.toHaveProperty('endDate');
    expect(ld).not.toHaveProperty('organizer');
  });

  it('uses the local date for an all-day event', () => {
    const [ld] = eventJsonLd(event([{ localDate: '2026-11-18', startTime: null }]), URL_, NOW);
    expect(ld).toMatchObject({ startDate: '2026-11-18', endDate: '2026-11-18' });
  });

  it('keeps the Azores offset: 23:30 local is 00:30 UTC the next day', () => {
    const [ld] = eventJsonLd(
      event([{ localDate: '2026-11-18', startTime: '23:30' }], { tz: 'Atlantic/Azores' }),
      URL_,
      NOW,
    );
    expect(ld?.startDate).toBe('2026-11-19T00:30:00Z');
  });

  it('gives a summer-time event its offset (last Sunday of March onwards)', () => {
    const [ld] = eventJsonLd(event([{ localDate: '2027-03-28', startTime: '18:00' }]), URL_, NOW);
    expect(ld?.startDate).toBe('2027-03-28T17:00:00Z');
  });

  it('lists only upcoming, not cancelled dates of a multi-date event', () => {
    const lds = eventJsonLd(
      event([
        { localDate: '2026-11-04', startTime: '18:00' }, // past
        { localDate: '2026-11-25', startTime: '18:00', cancelled: true },
        { localDate: '2026-11-18', startTime: '18:00' },
        { localDate: '2026-12-02', startTime: '18:00' },
      ]),
      URL_,
      NOW,
    );
    expect(lds.map((l) => l.startDate)).toEqual(['2026-11-18T18:00:00Z', '2026-12-02T18:00:00Z']);
  });

  it('marks an event whose only date was cancelled as cancelled', () => {
    const lds = eventJsonLd(
      event([{ localDate: '2026-11-18', startTime: '18:00', cancelled: true }]),
      URL_,
      NOW,
    );
    expect(lds).toHaveLength(1);
    expect(lds[0]?.eventStatus).toBe('https://schema.org/EventCancelled');
  });

  it('describes a past event by its last date', () => {
    const lds = eventJsonLd(
      event([
        { localDate: '2026-11-01', startTime: '10:00' },
        { localDate: '2026-11-04', startTime: '10:00' },
      ]),
      URL_,
      NOW,
    );
    expect(lds.map((l) => l.startDate)).toEqual(['2026-11-04T10:00:00Z']);
  });

  it('describes an ongoing event from its first date', () => {
    const lds = eventJsonLd(
      event([{ localDate: '2026-10-12', startTime: null }], { ongoingSince: '2026-10-12' }),
      URL_,
      NOW,
    );
    expect(lds).toHaveLength(1);
    expect(lds[0]).toMatchObject({ startDate: '2026-10-12' });
    expect(lds[0]).not.toHaveProperty('endDate');
  });
});

describe('jsonLdScript', () => {
  it('cannot be closed by text in the data', () => {
    const html = jsonLdScript(itemListJsonLd(['https://x.pt/</script><script>alert(1)']));
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('\\u003c/script>');
    const json = html.slice(html.indexOf('>') + 1, html.lastIndexOf('<'));
    expect(JSON.parse(json).itemListElement[0].url).toBe('https://x.pt/</script><script>alert(1)');
  });
});
