/**
 * /mapa/e/:id — serves the static map page (/) with the event's title and
 * Open Graph tags, so shared links get a proper preview, plus a canonical
 * URL, schema.org Event data and the event's text (in <noscript>) for search
 * engines. The client reads the id from the path and opens the event sheet.
 */
import { Hono } from 'hono';
import { APP_NAME } from '../../config/app';
import { nowIso } from '../../shared/dates';
import { formatOccurrence, formatOngoing } from '../../shared/event-view';
import type { PublicEvent } from '../../shared/schemas';
import { eventJsonLd, jsonLdScript } from '../../shared/seo';
import type { Clock } from '../clock';
import type { Env } from '../env';
import { escapeHtml } from '../html/escape';
import { eventNoscriptHtml, eventPath } from '../html/seo-html';
import { d1Db } from '../repos/db';
import { eventsRepo } from '../repos/events-repo';
import { createEventsService } from '../services/events-service';

const ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function whenLabel(event: PublicEvent, now: Date): string {
  const at = nowIso(now);
  const next =
    event.occurrences.find((o) => !o.cancelled && o.endsAt > at) ?? event.occurrences.at(-1);
  return event.ongoingSince
    ? formatOngoing(event.ongoingSince)
    : next
      ? formatOccurrence(next, event.tz)
      : '';
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
    const now = clock();
    const title = `${event.title} · ${APP_NAME}`;
    const url = new URL(eventPath(event.id), c.req.url).toString();
    const when = whenLabel(event, now);
    const description = [when, event.placeLabel, event.municipality].filter(Boolean).join(' · ');
    const meta = [
      ['og:type', 'website'],
      ['og:site_name', APP_NAME],
      ['og:locale', 'pt_PT'],
      ['og:title', event.title],
      ['og:description', description],
      ['og:url', url],
      // The approved poster (SPEC §4.7), else the site's image.
      ...(event.poster
        ? [
            ['og:image', new URL(event.poster.url, c.req.url).toString()],
            ['og:image:width', String(event.poster.width)],
            ['og:image:height', String(event.poster.height)],
            ['og:image:alt', event.poster.alt ?? event.title],
          ]
        : [
            ['og:image', new URL('/og.png', c.req.url).toString()],
            ['og:image:width', '1200'],
            ['og:image:height', '630'],
          ]),
    ]
      .map(([p, v]) => `<meta property="${p}" content="${escapeHtml(v ?? '')}">`)
      .join('');
    const jsonLd = jsonLdScript(eventJsonLd(event, url, now));

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
      // The home page's canonical URL and site data are replaced by the event's.
      // The canonical keeps the origin the page was built for (PUBLIC_SITE_URL).
      .on('link[rel="canonical"]', {
        element(el) {
          const base = el.getAttribute('href') ?? c.req.url;
          el.setAttribute('href', new URL(eventPath(event.id), base).toString());
        },
      })
      .on('script[type="application/ld+json"]', {
        element(el) {
          el.remove();
        },
      })
      .on('noscript', {
        element(el) {
          el.setInnerContent(eventNoscriptHtml(event, when), { html: true });
        },
      })
      .on('head', {
        element(el) {
          el.append(meta + jsonLd, { html: true });
        },
      })
      .transform(page);
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'public, max-age=60');
    return new Response(res.body, { status: 200, headers });
  });
}
