import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { FEATURES } from '../../src/config/app';

// Switched off at launch (src/config/app.ts › FEATURES).
test.skip(!FEATURES.signatures, 'signatures are switched off');

/**
 * Signatures (SPEC §5) with the fake mailer: the e2e server runs with
 * DEV_MAILBOX=on, so confirmation emails can be read at /api/dev/mailbox.
 */

interface Mail {
  to: string;
  subject: string;
  text: string;
}

async function mailbox(request: APIRequestContext, to: string, count = 1): Promise<Mail[]> {
  let messages: Mail[] = [];
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(to)}`);
        messages = ((await res.json()) as { messages: Mail[] }).messages;
        return messages.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(count);
  return messages;
}

function links(text: string) {
  return {
    confirm: /(https?:\/\/\S+\/api\/signatures\/confirm\?token=[\w-]+)/.exec(text)?.[1] ?? '',
    withdraw: /(https?:\/\/\S+\/apoio\/retirar\/#t=[\w-]+)/.exec(text)?.[1] ?? '',
  };
}

// Letters and digits mixed: a long run of digits would look like a phone number
// (rejected in public fields).
const unique = (info: { project: { name: string } }) =>
  `${info.project.name}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Each test signs from its own (fake) client address, so the 10/h limit never trips. */
async function ownClientAddress(page: Page) {
  const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
  await page.route('**/api/signatures', (route) =>
    route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } }),
  );
}

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `test-results/screens/${project}-${name}.png`, fullPage: true });
}

test.describe('Assinar o apelo', () => {
  test('individual: sign, confirm by email, appear in the list, withdraw', async ({
    page,
    request,
  }, info) => {
    await ownClientAddress(page);
    const id = unique(info);
    const email = `pessoa-${id}@exemplo.invalid`;
    const lastName = `Teste ${id}`;

    await page.goto('/apoio/');
    await expect(page.getByTestId('signature-stats')).toBeVisible();
    const form = page.locator('form.form-individual');
    await form.getByLabel('Nome próprio', { exact: true }).fill('Pessoa');
    await form.getByLabel('Apelido', { exact: true }).fill(lastName);
    await form.getByLabel('Email', { exact: true }).fill(email);
    await form.getByLabel('Concelho', { exact: true }).selectOption({ label: 'Porto' });
    await form
      .getByLabel('Atividade / profissão / organização (opcional)', { exact: true })
      .fill('Testadora');
    await form.getByLabel(/meu nome ou pseudónimo, concelho e atividade sejam publicados/).check();
    await form.getByLabel(/consentimento explícito/).check();
    await shot(page, '20-apoio-formulario', info.project.name);
    await form.getByRole('button', { name: 'Assinar' }).click();

    await expect(page).toHaveURL(/\/apoio\/confirma-email\/$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Verifica o teu email' })).toBeVisible();
    await shot(page, '21-apoio-verifica-email', info.project.name);

    const [mail] = await mailbox(request, email);
    const { confirm, withdraw } = links(mail?.text ?? '');
    expect(confirm).not.toBe('');
    expect(withdraw).not.toBe('');

    // Not listed before confirmation.
    const before = (await (await request.get('/api/signatures/public')).json()) as {
      individuals: { name: string }[];
    };
    expect(before.individuals.some((i) => i.name.includes(lastName))).toBe(false);

    await page.goto(confirm);
    await expect(page).toHaveURL(/\/apoio\/obrigado\/$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/assinatura está confirmada/);
    await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/\?text=.*%2Fapoio%2F$/,
    );
    await shot(page, '22-apoio-obrigado', info.project.name);

    await page.goto('/apoio/');
    // The list is an island hydrated when visible.
    await page.getByRole('heading', { name: 'Quem já assinou' }).scrollIntoViewIfNeeded();
    const person = page.locator('.sig-people li', { hasText: lastName });
    await expect(person).toContainText('Testadora · Porto');
    await expect(page.locator('.sig-list')).not.toContainText(email);

    await page.goto(withdraw);
    await expect(page).toHaveURL(/\/apoio\/retirar\/$/); // token removed from the address bar
    await page.getByRole('button', { name: 'Retirar a minha assinatura' }).click();
    await expect(page.getByRole('status')).toHaveText(/foi retirada/);
    await shot(page, '23-apoio-retirada', info.project.name);

    await page.goto('/apoio/');
    await page.getByRole('heading', { name: 'Quem já assinou' }).scrollIntoViewIfNeeded();
    await expect(page.locator('.sig-people')).toBeVisible();
    await expect(page.locator('.sig-people li', { hasText: lastName })).toHaveCount(0);
  });

  test('organisation: confirmed, but listed only after moderation', async ({
    page,
    request,
  }, info) => {
    await ownClientAddress(page);
    const id = unique(info);
    const email = `geral-${id}@exemplo.invalid`;
    const name = `Coletivo de Teste ${id}`;

    await page.goto('/apoio/');
    await page.getByText('Por uma organização').click();
    const form = page.locator('form.form-organization');
    await expect(form).toBeVisible();
    await expect(page.locator('form.form-individual')).toBeHidden();
    await form.getByLabel('Nome da organização', { exact: true }).fill(name);
    await form.getByText('Coletivo', { exact: true }).click();
    await form.getByLabel('Concelho (sede)', { exact: true }).selectOption({ label: 'Lagoa' });
    await form
      .getByLabel('Nome da pessoa responsável', { exact: true })
      .fill('Pessoa Responsável de Teste');
    await form.getByLabel('Email de contacto', { exact: true }).fill(email);
    await form.getByLabel(/legitimidade/).check();
    await expect(form.getByLabel('Publicar o nome da organização.', { exact: true })).toBeChecked();
    await form.getByLabel(/consentimento explícito/).check();
    await shot(page, '24-apoio-organizacao', info.project.name);
    await form.getByRole('button', { name: 'Assinar pela organização' }).click();
    await expect(page).toHaveURL(/\/apoio\/confirma-email\/$/, { timeout: 30_000 });

    const [mail] = await mailbox(request, email);
    expect(mail?.text).toContain(`em nome de "${name}"`);
    await page.goto(links(mail?.text ?? '').confirm);
    await expect(page).toHaveURL(/\/apoio\/obrigado\/$/);

    const list = (await (await request.get('/api/signatures/public')).json()) as {
      organizations: { name: string }[];
    };
    expect(list.organizations.some((o) => o.name === name)).toBe(false);
  });

  test('validation errors are shown next to the fields, focus on the first', async ({
    page,
  }, info) => {
    await page.goto('/apoio/');
    const form = page.locator('form.form-individual');
    await form.getByLabel('Email', { exact: true }).fill('nao-e-um-email');
    await form.getByRole('button', { name: 'Assinar' }).click();

    await expect(form.getByRole('alert')).toHaveText('Corrige os campos assinalados.', {
      timeout: 30_000,
    });
    const first = form.getByLabel('Nome próprio', { exact: true });
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    await expect(first).toHaveAttribute('aria-describedby', 'ind-firstName-error');
    await expect(form.locator('#ind-firstName-error')).toHaveText(
      'Indica o nome próprio e o apelido, ou um pseudónimo.',
    );
    await expect(form.locator('#ind-email-error')).toHaveText('Email inválido.');
    await expect(form.getByLabel('Email', { exact: true })).toHaveAttribute(
      'aria-describedby',
      'ind-email-hint ind-email-error',
    );
    await expect(form.locator('#ind-municipality-error')).toHaveText('Campo obrigatório.');
    await expect(form.locator('#ind-consent-error')).toHaveText('Campo obrigatório.');
    await shot(page, '25-apoio-erros', info.project.name);

    // Fixing a field and resubmitting clears its error.
    await form.getByLabel('Pseudónimo', { exact: true }).fill('Gaivota');
    await form.getByRole('button', { name: 'Assinar' }).click();
    await expect(form.locator('#ind-firstName-error')).toBeHidden();
    await expect(form.getByLabel('Email', { exact: true })).toBeFocused();
  });

  test('signing again with the same email: neutral answer, a new email', async ({
    page,
    request,
  }, info) => {
    await ownClientAddress(page);
    const email = `repetido-${unique(info)}@exemplo.invalid`;
    for (let i = 0; i < 2; i++) {
      await page.goto('/apoio/');
      const form = page.locator('form.form-individual');
      await form.getByLabel('Pseudónimo', { exact: true }).fill(`Repetido ${i}`);
      await form.getByLabel('Email', { exact: true }).fill(email);
      await form.getByLabel('Concelho', { exact: true }).selectOption({ label: 'Funchal' });
      await form.getByLabel(/consentimento explícito/).check();
      await form.getByRole('button', { name: 'Assinar' }).click();
      await expect(page).toHaveURL(/\/apoio\/confirma-email\/$/, { timeout: 30_000 });
    }
    const mails = await mailbox(request, email, 2);
    expect(mails).toHaveLength(2);
    expect(links(mails[0]?.text ?? '').confirm).not.toBe(links(mails[1]?.text ?? '').confirm);
  });
});

test.describe('Assinar sem JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the form posts normally; the server answers with an HTML page', async ({ page }, info) => {
    await page.goto('/apoio/');
    const form = page.locator('form.form-individual');
    // Required by HTML (email, concelho, consent), but no name: the server reports it.
    await form.getByLabel('Email', { exact: true }).fill(`sem-js-${unique(info)}@exemplo.invalid`);
    await form.getByLabel('Concelho', { exact: true }).selectOption({ label: 'Braga' });
    await form.getByLabel(/consentimento explícito/).check();
    await form.getByRole('button', { name: 'Assinar' }).click();

    await expect(
      page.getByRole('heading', { name: 'Não foi possível enviar a assinatura' }),
    ).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveText([
      /Nome próprio: Indica o nome próprio e o apelido/,
      /Apelido: Indica o nome próprio e o apelido/,
    ]);
    await shot(page, '26-apoio-sem-js-erros', info.project.name);

    // The form again, now complete: without JavaScript there is no Turnstile
    // token, and the page says so.
    await page.goBack();
    await form.getByLabel('Pseudónimo', { exact: true }).fill('Sem JavaScript');
    await form.getByLabel('Email', { exact: true }).fill(`sem-js-${unique(info)}@exemplo.invalid`);
    await form.getByLabel('Concelho', { exact: true }).selectOption({ label: 'Braga' });
    await form.getByLabel(/consentimento explícito/).check();
    await form.getByRole('button', { name: 'Assinar' }).click();
    await expect(page.getByRole('alert')).toHaveText(/Precisa de JavaScript/);
  });
});
