import { expect, type Locator } from '@playwright/test';

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
