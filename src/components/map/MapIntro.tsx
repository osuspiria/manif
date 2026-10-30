import { pt } from '../../i18n/pt';

interface Props {
  /** While the filters or an event are open on a phone: hidden only visually, so the page keeps its h1. */
  hidden?: boolean;
  /** Static copy painted before the app mounts: no h1 or ids, the app renders those. */
  shell?: boolean;
}

/** Short description of the platform above the top bar. */
export function MapIntro({ hidden = false, shell = false }: Props) {
  const Title = shell ? 'p' : 'h1';
  return (
    <section
      class={hidden ? 'visually-hidden' : 'map-intro'}
      aria-labelledby={shell ? undefined : 'intro-title'}
    >
      <div class="map-intro-head">
        <span class="map-intro-mark" aria-hidden="true" />
        <Title id={shell ? undefined : 'intro-title'} class="map-intro-title">
          {pt.site.title}
        </Title>
        {/* Accessible name: the full "Manifestações por distrito". */}
        <a href="/manifestacoes/" class="map-intro-link">
          <span class="map-intro-link-lead">{pt.seo.districtsLinkLead} </span>
          {pt.seo.districtsLinkShort}
        </a>
      </div>
      {/* On a phone only for screen readers and search engines: the map gets the room. */}
      <p class="map-intro-text">{pt.map.description}</p>
    </section>
  );
}
