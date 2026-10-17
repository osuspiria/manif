import { AppRoot, MapIntro, pt } from 'mobilizacao-pt-ui';

export function Default() {
  return (
    <AppRoot page="map">
      <div style={{ width: 360, border: '1px solid #000' }}>
        <MapIntro />
      </div>
    </AppRoot>
  );
}

/** The phone header of the home page: intro, then the top bar with the filter summary and the Mapa/Lista toggle. */
export function WithTopBar() {
  return (
    <AppRoot page="map">
      <div style={{ width: 360, border: '1px solid #000', display: 'flex', flexDirection: 'column' }}>
        <MapIntro />
        <div className="topbar">
          <button type="button" className="summary-button">
            <span className="summary-label">
              <span className="summary-count">47 eventos</span>
              <span className="summary-when">{pt.when.upcoming}</span>
            </span>
          </button>
          <div className="segmented" role="group" aria-label={pt.map.viewToggle}>
            <button type="button" aria-pressed="true">
              {pt.map.viewMap}
            </button>
            <button type="button" aria-pressed="false">
              {pt.map.viewList}
            </button>
          </div>
        </div>
      </div>
    </AppRoot>
  );
}
