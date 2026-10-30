import { pt } from '../../i18n/pt';
import type { FilteredEvent } from '../../shared/event-filter';
import {
  formatDayHeading,
  formatOccurrence,
  formatOngoing,
  formatPlace,
  groupByDay,
} from '../../shared/event-view';
import type { PublicEvent } from '../../shared/schemas';
import { TypeIcon } from './TypeIcon';

interface Props {
  results: FilteredEvent<PublicEvent>[];
  /** Past events: newest day first. */
  newestFirst?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function EventList({ results, newestFirst = false, selectedId, onSelect }: Props) {
  if (results.length === 0) return <p class="empty">{pt.map.empty}</p>;

  return (
    <div class="event-list">
      {groupByDay(results, newestFirst ? 'desc' : 'asc').map((group) => (
        <section key={group.date} aria-labelledby={`day-${group.date}`}>
          <h2 class="day-heading" id={`day-${group.date}`}>
            {formatDayHeading(group.date)}
          </h2>
          <ul>
            {group.items.map(({ event, highlight, inRange, others }) => {
              // Ongoing events repeat every day: one "Todos os dias desde…" line, no count.
              const more = event.ongoingSince ? 0 : inRange.length - 1 + others.length;
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    class="event-card"
                    aria-current={selectedId === event.id ? 'true' : undefined}
                    onClick={() => onSelect(event.id)}
                  >
                    <TypeIcon type={event.type} size={22} />
                    <span class="event-card-body">
                      <span class="event-card-title">{event.title}</span>
                      <span class="event-card-meta">
                        {event.ongoingSince
                          ? formatOngoing(event.ongoingSince)
                          : formatOccurrence(highlight, event.tz)}
                      </span>
                      <span class="event-card-meta">{formatPlace(event)}</span>
                      <span class="event-card-type">
                        {pt.eventTypes[event.type]}
                        {more > 0 && ` · ${pt.event.otherDates(more)}`}
                      </span>
                    </span>
                    {event.poster && (
                      // Decorative here: the title is right next to it.
                      <img
                        class="event-card-thumb"
                        src={event.poster.thumbUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
