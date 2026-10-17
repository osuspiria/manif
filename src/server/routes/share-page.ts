/**
 * /mapa/e/:id — serves the static map page (/) with the event's title and
 * Open Graph tags, so shared links get a proper preview. The client reads the
 * id from the path and opens the event sheet.
 */
import { Hono } from 'hono';
import { APP_NAME } from '../../config/app';
import { nowIso } from '../../shared/dates';
import { formatOccurrence } from '../../shared/event-view';
import type { PublicEvent } from '../../shared/schemas';
import type { Clock } from '../clock';
import type { Env } from '../env';
import { d1Db } from '../repos/db';
import { eventsRepo } from '../repos/events-repo';
import { createEventsService } from '../services/events-service';

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function describe(event: PublicEvent, now: Date): string {
  const at = nowIso(now);
  const next =
    event.occurrences.find((o) => !o.cancelled && o.endsAt > at) ?? event.occurrences.at(-1);
  const when = next ? formatOccurrence(next, event.tz) : '';
  return [when, event.placeLabel, event.municipality].filter(Boolean).join(' · ');
}

export function sharePageRoutes(clock: Clock) {
  return new Hono<{ Bindings: Env }>().get('/:id', async (c) => {
    const id = c.req.param('id');
    const event = ID_RE.test(id)
      ? await createEventsService(eventsRepo(d1Db(c.env.DB))).getPublic(id)
      : null;

    if (!event) {
      const notFound = await c.env.ASSETS.fetch(new URL('/404.html', c.req.url));
      return new Response(notFound.body, { status: 404, headers: notFound.headers });
    }

    const page = await c.env.ASSETS.fetch(new URL('/', c.req.url));
    const title = `${event.title} · ${APP_NAME}`;
    const url = new URL(`/mapa/e/${event.id}`, c.req.url).toString();
    const description = describe(event, clock());
    const meta = [
      ['og:type', 'website'],
      ['og:site_name', APP_NAME],
      ['og:locale', 'pt_PT'],
      ['og:title', event.title],
      ['og:description', description],
      ['og:url', url],
      ['og:image', new URL('/og.png', c.req.url).toString()],
      ['og:image:width', '1200'],
      ['og:image:height', '630'],
    ]
      .map(([p, v]) => `<meta property="${p}" content="${escapeAttr(v ?? '')}">`)
      .join('');

    const res = new HTMLRewriter()
      .on('title', {
        element(el) {
          el.setInnerContent(title);
        },
      })
      // The static page's own preview tags are replaced by the event's.
      .on('meta[property^="og:"]', {
        element(el) {
          el.remove();
        },
      })
      .on('meta[name="description"]', {
        element(el) {
          el.setAttribute('content', description);
        },
      })
      .on('head', {
        element(el) {
          el.append(meta, { html: true });
        },
      })
      .transform(page);
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(res.body, { status: 200, headers });
  });
}
