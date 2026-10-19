/**
 * HTML fragments the Worker injects into static pages for search engines and
 * readers without JavaScript: the event list of a district page, the text of
 * an event page, and sitemap.xml. Only public event fields are used.
 */
import { pt } from '../../i18n/pt';
import { formatOccurrence, formatOngoing } from '../../shared/event-view';
import type { FilteredEvent } from '../../shared/event-filter';
import type { PublicEvent } from '../../shared/schemas';
import { escapeHtml } from './escape';

export function eventPath(id: string): string {
  return `/mapa/e/${id}`;
}

function whenLabel(r: FilteredEvent<PublicEvent>): string {
  const when = r.event.ongoingSince
    ? formatOngoing(r.event.ongoingSince)
    : formatOccurrence(r.highlight, r.event.tz);
  const more = r.event.ongoingSince ? 0 : r.inRange.length + r.others.length - 1;
  return more > 0 ? `${when} ${pt.event.otherDates(more)}` : when;
}

function placeLabel(e: PublicEvent): string {
  return [e.placeLabel, e.municipality].filter(Boolean).join(', ');
}

/** The <ol> of a district page, or a "no events" paragraph. */
export function districtEventsHtml(results: FilteredEvent<PublicEvent>[], where: string): string {
  if (results.length === 0) {
    return `<p class="district-empty">${escapeHtml(pt.seo.districtEmpty(where))}</p>`;
  }
  const items = results.map((r) => {
    const e = r.event;
    const meta = [pt.eventTypes[e.type], whenLabel(r)].join(' · ');
    return (
      `<li><a href="${eventPath(e.id)}">` +
      `<span class="district-event-title">${escapeHtml(e.title)}</span>` +
      `<span class="district-event-meta">${escapeHtml(meta)}</span>` +
      `<span class="district-event-meta">${escapeHtml(placeLabel(e))}</span>` +
      `</a></li>`
    );
  });
  return `<ol class="district-events">${items.join('')}</ol>`;
}

/** Text of an event page for readers without JavaScript (the <noscript> of the map page). */
export function eventNoscriptHtml(event: PublicEvent, when: string): string {
  const parts = [
    `<h1>${escapeHtml(event.title)}</h1>`,
    `<p>${escapeHtml([pt.eventTypes[event.type], when].filter(Boolean).join(' · '))}</p>`,
    `<p>${escapeHtml(placeLabel(event))}</p>`,
    event.description ? `<p>${escapeHtml(event.description)}</p>` : '',
    event.organizer ? `<p>${escapeHtml(`${pt.event.organizer}: ${event.organizer}`)}</p>` : '',
    `<p>${escapeHtml(pt.map.noscript)}</p>`,
  ];
  return parts.join('');
}

export function sitemapXml(urls: readonly string[]): string {
  const entries = urls.map((u) => `<url><loc>${escapeHtml(u)}</loc></url>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`
  );
}
