import { useEffect, useRef, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { nowIso } from '../../shared/dates';
import { filterEvents, type WhenFilter } from '../../shared/event-filter';
import { formatOccurrence } from '../../shared/event-view';
import type { PublicEvent, PublicOccurrence } from '../../shared/schemas';
import { TypeIcon } from './TypeIcon';

interface Props {
  event: PublicEvent | null;
  /** true while fetching an event that is not in the map data */
  loading: boolean;
  when: WhenFilter;
  now: Date;
  onClose: () => void;
}

function OccurrenceItem({
  o,
  event,
  faded,
}: {
  o: PublicOccurrence;
  event: PublicEvent;
  faded: boolean;
}) {
  return (
    <li class={faded ? 'occ occ-faded' : 'occ'}>
      <span class={o.cancelled ? 'occ-cancelled' : undefined}>{formatOccurrence(o, event.tz)}</span>
      {o.cancelled && <span class="badge"> {pt.event.cancelled}</span>}
      {o.note && <span class="occ-note">{o.note}</span>}
    </li>
  );
}

export function EventSheet({ event, loading, when, now, onClose }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    setExpanded(false);
    setStatus('');
    titleRef.current?.focus();
  }, [event?.id]);

  if (!event) {
    return (
      <section class="event-sheet" role="dialog" aria-modal="false" aria-label={pt.event.close}>
        <div class="sheet-head">
          <p>{loading ? pt.map.loading : pt.event.notFound}</p>
          <button type="button" class="btn-icon" aria-label={pt.event.close} onClick={onClose}>
            ×
          </button>
        </div>
      </section>
    );
  }

  const match =
    filterEvents([event], { when, types: [] }, now)[0] ??
    filterEvents([event], { when: { kind: 'upcoming' }, types: [] }, now)[0];
  const cancelledFuture = event.occurrences.filter((o) => o.cancelled && o.endsAt > nowIso(now));
  const extra = match
    ? [
        ...match.inRange.slice(1).map((o) => ({ o, faded: false })),
        ...match.others.map((o) => ({ o, faded: true })),
        ...cancelledFuture.map((o) => ({ o, faded: true })),
      ].sort((a, b) => (a.o.startsAt < b.o.startsAt ? -1 : 1))
    : [];

  const url = `${window.location.origin}/mapa/e/${event.id}`;
  const osm = `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}#map=17/${event.lat}/${event.lng}`;
  const directions = `https://www.openstreetmap.org/directions?route=%3B${event.lat}%2C${event.lng}`;

  async function share() {
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: event?.title, url });
        return;
      } catch {
        /* cancelled: fall back to copying */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus(pt.event.linkCopied);
    } catch {
      setStatus(url);
    }
  }

  return (
    <section
      class="event-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby="event-sheet-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div class="sheet-head">
        <p class="event-type">
          <TypeIcon type={event.type} size={20} /> {pt.eventTypes[event.type]}
          <span class={event.verified ? 'badge badge-ok' : 'badge'}>
            {event.verified ? pt.event.verified : pt.event.unverified}
          </span>
        </p>
        <button type="button" class="btn-icon" aria-label={pt.event.close} onClick={onClose}>
          ×
        </button>
      </div>
      <h2 id="event-sheet-title" tabIndex={-1} ref={titleRef}>
        {event.title}
      </h2>
      <p class="event-place">
        {[event.placeLabel, event.municipality, event.district].filter(Boolean).join(' · ')}
      </p>

      {match ? (
        <div class="event-dates">
          <p class="occ-highlight">{formatOccurrence(match.highlight, event.tz)}</p>
          {match.highlight.note && <p class="occ-note">{match.highlight.note}</p>}
          {extra.length > 0 && (
            <>
              <button
                type="button"
                class="btn-link"
                aria-expanded={expanded}
                aria-controls="event-other-dates"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? pt.event.hideOtherDates : pt.event.otherDates(extra.length)}
              </button>
              {expanded && (
                <ul id="event-other-dates" class="occ-list">
                  {extra.map(({ o, faded }) => (
                    <OccurrenceItem key={o.id} o={o} event={event} faded={faded} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : (
        <p class="event-ended">{pt.event.ended}</p>
      )}

      {event.description && <p class="event-description">{event.description}</p>}
      {event.organizer && (
        <p class="event-organizer">
          {pt.event.organizer}: {event.organizer}
        </p>
      )}

      <div class="sheet-actions">
        <a class="btn" href={directions} rel="noopener noreferrer" target="_blank">
          {pt.event.directions}
        </a>
        <button type="button" class="btn" onClick={() => void share()}>
          {pt.event.share}
        </button>
        <a class="btn" href={`geo:${event.lat},${event.lng}`}>
          {pt.event.openInApp}
        </a>
        <a class="btn" href={osm} rel="noopener noreferrer" target="_blank">
          {pt.event.openInOsm}
        </a>
      </div>
      <p class="sr-status" role="status">
        {status}
      </p>
    </section>
  );
}
