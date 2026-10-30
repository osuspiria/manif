import { useEffect, useRef, useState } from 'preact/hooks';
import { pt } from '../../i18n/pt';
import { nowIso } from '../../shared/dates';
import { filterEvents, type WhenFilter } from '../../shared/event-filter';
import {
  collapseDailyRuns,
  formatDailyRun,
  formatOccurrence,
  formatOngoing,
  formatPlace,
} from '../../shared/event-view';
import { detectPlatform, mapsAppUrl } from '../../shared/maps-links';
import type { PublicEvent, PublicOccurrence } from '../../shared/schemas';
import { ReportForm } from './ReportForm';
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
  const [reporting, setReporting] = useState(false);
  // Phones: the sheet opens at half height, so the map stays in view.
  const [full, setFull] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setStatus('');
    setReporting(false);
    setFull(false);
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
  // Ongoing events: the daily all-day dates are summed up in one line; only
  // real dates (with their own time or note) are listed.
  const realIds = new Set(event.occurrences.map((o) => o.id));
  const shown = (o: PublicOccurrence) => !event.ongoingSince || realIds.has(o.id);
  const extra = match
    ? [
        ...match.inRange.slice(1).map((o) => ({ o, faded: false })),
        ...match.others.map((o) => ({ o, faded: true })),
        ...cancelledFuture.map((o) => ({ o, faded: true })),
      ]
        .filter(({ o }) => shown(o))
        .sort((a, b) => (a.o.startsAt < b.o.startsAt ? -1 : 1))
    : [];
  // Daily dates read as one line ("Todos os dias de … a …").
  const extraEntries = collapseDailyRuns(
    extra,
    (x) => x.o,
    (a, b) => a.faded === b.faded,
  );

  const url = `${window.location.origin}/mapa/e/${event.id}`;
  const osm = `https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}#map=17/${event.lat}/${event.lng}`;
  const directions = `https://www.openstreetmap.org/directions?route=%3B${event.lat}%2C${event.lng}`;
  const mapsApp = mapsAppUrl(
    { lat: event.lat, lng: event.lng, label: event.title },
    detectPlatform(navigator.userAgent, navigator.maxTouchPoints),
  );

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
      class={full ? 'event-sheet sheet-full' : 'event-sheet'}
      role="dialog"
      aria-modal="false"
      aria-labelledby="event-sheet-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <button
        type="button"
        class="sheet-grip"
        aria-expanded={full}
        aria-label={full ? pt.event.collapse : pt.event.expand}
        onClick={() => setFull(!full)}
      >
        <span aria-hidden="true" />
      </button>
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
      <p class="event-place">{formatPlace(event, { district: true })}</p>
      {event.poster && (
        <a
          class="event-poster"
          href={event.poster.url}
          target="_blank"
          rel="noopener"
          aria-label={pt.poster.open}
        >
          <img
            src={event.poster.url}
            width={event.poster.width}
            height={event.poster.height}
            alt={event.poster.alt ?? event.title}
            decoding="async"
          />
        </a>
      )}

      {match ? (
        <div class="event-dates">
          <p class="occ-highlight">
            {event.ongoingSince
              ? formatOngoing(event.ongoingSince)
              : formatOccurrence(match.highlight, event.tz)}
          </p>
          {!event.ongoingSince && match.highlight.note && (
            <p class="occ-note">{match.highlight.note}</p>
          )}
          {extra.length > 0 && (
            <>
              <button
                type="button"
                class="btn-link"
                aria-expanded={expanded}
                aria-controls="event-other-dates"
                onClick={() => {
                  setExpanded(!expanded);
                  if (!expanded) setFull(true);
                }}
              >
                {expanded ? pt.event.hideOtherDates : pt.event.otherDates(extra.length)}
              </button>
              {expanded && (
                <ul id="event-other-dates" class="occ-list">
                  {extraEntries.map((entry) =>
                    entry.kind === 'one' ? (
                      <OccurrenceItem
                        key={entry.item.o.id}
                        o={entry.item.o}
                        event={event}
                        faded={entry.item.faded}
                      />
                    ) : (
                      <li
                        key={entry.first.o.id}
                        class={entry.first.faded ? 'occ occ-faded' : 'occ'}
                      >
                        {formatDailyRun(entry.first.o, entry.last.o, event.tz)}
                      </li>
                    ),
                  )}
                </ul>
              )}
            </>
          )}
        </div>
      ) : (
        <p class="event-ended">{pt.event.ended}</p>
      )}
      {/* "Já aconteceram": the past date is shown above; say so if none is left. */}
      {match && when.kind === 'past' && match.others.length === 0 && (
        <p class="event-ended">{pt.event.ended}</p>
      )}

      <div class="sheet-actions">
        <a class="btn" href={directions} rel="noopener noreferrer" target="_blank">
          {pt.event.directions}
        </a>
        <button type="button" class="btn" onClick={() => void share()}>
          {pt.event.share}
        </button>
        {/* Phones open their maps app; desktops (no app) get OpenStreetMap. */}
        {mapsApp ? (
          <a class="btn" href={mapsApp}>
            {pt.event.openInApp}
          </a>
        ) : (
          <a class="btn" href={osm} rel="noopener noreferrer" target="_blank">
            {pt.event.openInOsm}
          </a>
        )}
      </div>

      {event.description && <p class="event-description">{event.description}</p>}
      {event.organizer && (
        <p class="event-organizer">
          {pt.event.organizer}: {event.organizer}
        </p>
      )}
      {reporting ? (
        <ReportForm eventId={event.id} onClose={() => setReporting(false)} />
      ) : (
        <button type="button" class="btn btn-quiet sheet-report" onClick={() => setReporting(true)}>
          {pt.report.open}
        </button>
      )}
      <p class="sr-status" role="status">
        {status}
      </p>
    </section>
  );
}
