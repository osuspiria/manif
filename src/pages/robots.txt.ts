import type { APIRoute } from 'astro';

/**
 * robots.txt. The API stays crawlable: search engines render the map with
 * /api/events.geojson and /tiles. Admin and edit pages are noindex anyway.
 */
export const GET: APIRoute = ({ site }) => {
  const lines = [
    'User-agent: *',
    'Disallow: /admin/',
    'Disallow: /editar/',
    'Disallow: /api/admin/',
    'Disallow: /api/dev/',
  ];
  if (site) lines.push('', `Sitemap: ${new URL('/sitemap.xml', site).toString()}`);
  return new Response(`${lines.join('\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
