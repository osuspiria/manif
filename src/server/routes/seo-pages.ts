/**
 * Pages for search engines: /manifestacoes/:slug/ serves the static district
 * page with its upcoming events filled in, and /sitemap.xml lists the pages
 * worth indexing. The district index (/manifestacoes/) gets the event count
 * of every district.
 */
import { Hono } from 'hono';
import { districtBySlug, districtPath } from '../../config/districts';
import { itemListJsonLd, jsonLdScript } from '../../shared/seo';
import type { Clock } from '../clock';
import type { Env } from '../env';
import { districtCountHtml, districtEventsHtml, eventPath, sitemapXml } from '../html/seo-html';
import { d1Db } from '../repos/db';
import { eventsRepo } from '../repos/events-repo';
import { createEventsService } from '../services/events-service';
import { createSeoService } from '../services/seo-service';

const DISTRICT_HREF = /^\/manifestacoes\/([a-z-]+)\/$/;

/** Adds the number of upcoming events to every district link; dims the empty ones. */
function withDistrictCounts(rewriter: HTMLRewriter, counts: Record<string, number>) {
  return rewriter.on('.district-links a', {
    element(el) {
      const slug = DISTRICT_HREF.exec(el.getAttribute('href') ?? '')?.[1];
      if (!slug) return;
      const n = counts[slug] ?? 0;
      el.append(districtCountHtml(n), { html: true });
      if (n === 0) el.setAttribute('class', 'district-link-empty');
    },
  });
}

function cached(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(res.body, { status: 200, headers });
}

export function seoPagesRoutes(clock: Clock) {
  const seo = (env: Env) => createSeoService(createEventsService(eventsRepo(d1Db(env.DB))));

  return new Hono<{ Bindings: Env }>()
    .get('/manifestacoes/', async (c) => {
      const [page, counts] = await Promise.all([
        c.env.ASSETS.fetch(new URL('/manifestacoes/', c.req.url)),
        seo(c.env).districtCounts(clock()),
      ]);
      return cached(withDistrictCounts(new HTMLRewriter(), counts).transform(page));
    })
    .get('/manifestacoes/:slug/', async (c) => {
      const district = districtBySlug(c.req.param('slug'));
      if (!district) {
        const notFound = await c.env.ASSETS.fetch(new URL('/404.html', c.req.url));
        return new Response(notFound.body, { status: 404, headers: notFound.headers });
      }

      const [page, results, counts] = await Promise.all([
        c.env.ASSETS.fetch(new URL(districtPath(district), c.req.url)),
        seo(c.env).districtEvents(district, clock()),
        seo(c.env).districtCounts(clock()),
      ]);
      const urls = results.map((r) => new URL(eventPath(r.event.id), c.req.url).toString());
      const res = withDistrictCounts(new HTMLRewriter(), counts)
        .on('#district-events', {
          element(el) {
            el.setInnerContent(districtEventsHtml(results, district.where), { html: true });
          },
        })
        .on('head', {
          element(el) {
            if (urls.length > 0) el.append(jsonLdScript(itemListJsonLd(urls)), { html: true });
          },
        })
        .transform(page);
      return cached(res);
    })
    .get('/sitemap.xml', async (c) => {
      const paths = await seo(c.env).sitemapPaths(clock());
      const urls = paths.map((p) => new URL(p, c.req.url).toString());
      return c.body(sitemapXml(urls), 200, {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      });
    });
}
