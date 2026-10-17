/** All UI strings, in European Portuguese (pt-PT). */
export const pt = {
  site: {
    title: 'Mobilização',
    tagline: 'Mapa de mobilizações e apelo de apoio',
  },
  nav: {
    map: 'Mapa',
    support: 'Apoiar',
    privacy: 'Privacidade',
  },
  home: {
    heading: 'Junta-te à mobilização',
    mapCta: 'Ver o mapa de eventos',
    supportCta: 'Assinar o apelo',
  },
  map: {
    heading: 'Mapa de eventos',
    placeholder: 'O mapa chega na próxima fase.',
  },
  eventTypes: {
    demonstration: 'Manifestação / desfile',
    rally: 'Concentração / vigília',
    action: 'Ação num local',
    assembly: 'Assembleia / reunião aberta',
    other: 'Outro',
  },
  when: {
    upcoming: 'Próximos',
    today: 'Hoje',
    tomorrow: 'Amanhã',
    weekend: 'Fim de semana',
    next7: '7 dias',
    pickDay: 'Escolher dia',
    clear: 'Limpar',
  },
  /** Short weekday labels, ISO order (Monday first). */
  weekdaysShort: ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'],
  tz: {
    azoresSuffix: '(hora dos Açores)',
  },
  errors: {
    notFound: 'Página não encontrada.',
  },
} as const;

export type Strings = typeof pt;
