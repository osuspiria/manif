import { expect, type Locator, type Page } from '@playwright/test';

/**
 * "Enviar evento". Other tests (and the other viewport) leave events at the map
 * centre on the same dates, so the possible-duplicates notice may come first
 * (decisions #80): then send anyway.
 */
export async function sendEvent(flow: Locator) {
  await flow.getByRole('button', { name: 'Enviar evento' }).click();
  const anyway = flow.getByRole('button', { name: 'Enviar na mesma' });
  const sending = flow
    .getByRole('button', { name: 'A enviar…' })
    .or(flow.locator('.edit-link-box'))
    .or(flow.locator('.form-error:not(:empty)'));
  await expect(anyway.or(sending).first()).toBeVisible();
  if (await anyway.isVisible()) await anyway.click();
}

/**
 * "Onde": the map opens at country zoom, too far out to take its centre as the
 * place. "Usar a minha localização" (a fixed test position, on land in the
 * mainland: Coimbra) zooms in to street level.
 */
export async function pickPlace(page: Page, flow: Locator) {
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({ latitude: 40.2033, longitude: -8.4103 });
  await flow.getByRole('button', { name: 'Usar a minha localização' }).click();
  // Coimbra is not the municipality at the centre of the mainland: the map has moved.
  await expect(flow.locator('.detected strong')).toHaveText('Coimbra · Coimbra', {
    timeout: 20_000,
  });
  await expect(flow.getByText('Aproxima o mapa até veres as ruas')).toHaveCount(0, {
    timeout: 20_000,
  });
}
