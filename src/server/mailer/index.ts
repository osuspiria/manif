/** Outgoing email port (decision D4: Resend). */
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** In-memory mailer for dev and tests. */
export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }

  last(): MailMessage | undefined {
    return this.sent.at(-1);
  }
}

/** Drops messages (no provider configured). Never logs addresses or content. */
export class NullMailer implements Mailer {
  send(): Promise<void> {
    return Promise.resolve();
  }
}

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async send(m: MailMessage): Promise<void> {
    const res = await this.fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [m.to],
        subject: m.subject,
        text: m.text,
        html: m.html,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
  }
}

/**
 * Local development and e2e only (DEV_MAILBOX=on): keeps the last messages per
 * address in KV for an hour, readable at /api/dev/mailbox from localhost.
 */
export class KvDevMailbox implements Mailer {
  constructor(private readonly kv: KVNamespace) {}

  static key(to: string): string {
    return `dev-mailbox:${to.toLowerCase()}`;
  }

  async send(m: MailMessage): Promise<void> {
    const key = KvDevMailbox.key(m.to);
    const previous: MailMessage[] = (await this.kv.get(key, 'json')) ?? [];
    await this.kv.put(key, JSON.stringify([...previous, m].slice(-10)), { expirationTtl: 3600 });
  }

  async read(to: string): Promise<MailMessage[]> {
    return (await this.kv.get(KvDevMailbox.key(to), 'json')) ?? [];
  }
}
