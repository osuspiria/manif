/** Outgoing email port. The real provider (Resend, decision D4) arrives in phase 5. */
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
