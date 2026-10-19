/**
 * Districts and autonomous regions, as named in data/geo/municipalities.json
 * (the `district` of an event), with the URL slug of their page
 * (/manifestacoes/<slug>/). Slugs never change once published.
 */
export interface District {
  slug: string;
  /** Exactly as stored in events.district. */
  name: string;
  /** Short name for lists. */
  short: string;
  /** With its preposition, for sentences: 'em Lisboa', 'nos Açores'. */
  where: string;
}

export const DISTRICTS: readonly District[] = [
  { slug: 'aveiro', name: 'Aveiro', short: 'Aveiro', where: 'em Aveiro' },
  { slug: 'beja', name: 'Beja', short: 'Beja', where: 'em Beja' },
  { slug: 'braga', name: 'Braga', short: 'Braga', where: 'em Braga' },
  { slug: 'braganca', name: 'Bragança', short: 'Bragança', where: 'em Bragança' },
  {
    slug: 'castelo-branco',
    name: 'Castelo Branco',
    short: 'Castelo Branco',
    where: 'em Castelo Branco',
  },
  { slug: 'coimbra', name: 'Coimbra', short: 'Coimbra', where: 'em Coimbra' },
  { slug: 'evora', name: 'Évora', short: 'Évora', where: 'em Évora' },
  { slug: 'faro', name: 'Faro', short: 'Faro', where: 'em Faro' },
  { slug: 'guarda', name: 'Guarda', short: 'Guarda', where: 'na Guarda' },
  { slug: 'leiria', name: 'Leiria', short: 'Leiria', where: 'em Leiria' },
  { slug: 'lisboa', name: 'Lisboa', short: 'Lisboa', where: 'em Lisboa' },
  { slug: 'portalegre', name: 'Portalegre', short: 'Portalegre', where: 'em Portalegre' },
  { slug: 'porto', name: 'Porto', short: 'Porto', where: 'no Porto' },
  { slug: 'santarem', name: 'Santarém', short: 'Santarém', where: 'em Santarém' },
  { slug: 'setubal', name: 'Setúbal', short: 'Setúbal', where: 'em Setúbal' },
  {
    slug: 'viana-do-castelo',
    name: 'Viana do Castelo',
    short: 'Viana do Castelo',
    where: 'em Viana do Castelo',
  },
  { slug: 'vila-real', name: 'Vila Real', short: 'Vila Real', where: 'em Vila Real' },
  { slug: 'viseu', name: 'Viseu', short: 'Viseu', where: 'em Viseu' },
  { slug: 'acores', name: 'Região Autónoma dos Açores', short: 'Açores', where: 'nos Açores' },
  { slug: 'madeira', name: 'Região Autónoma da Madeira', short: 'Madeira', where: 'na Madeira' },
];

export function districtBySlug(slug: string): District | undefined {
  return DISTRICTS.find((d) => d.slug === slug);
}

export function districtPath(d: District): string {
  return `/manifestacoes/${d.slug}/`;
}
