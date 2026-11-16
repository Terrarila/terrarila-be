import { Inject, Injectable } from '@nestjs/common';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';

export const NOTIFICATION_MAILER = Symbol('NOTIFICATION_MAILER');
export type MailMessage = { subject: string; text: string };
export interface NotificationMailer {
  send(message: MailMessage): Promise<string>;
}
// Only safe, machine-readable reasons are persisted/logged, never provider bodies or credentials.
export class MailDeliveryError extends Error {
  constructor(
    readonly reason: string,
    readonly retryable: boolean,
  ) {
    super(reason);
  }
}

@Injectable()
export class MailgunMailer implements NotificationMailer {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async send(message: MailMessage): Promise<string> {
    const mail = this.config.mailgun;
    if (!mail) throw new MailDeliveryError('disabled', false);
    const origin = {
      US: 'https://api.mailgun.net',
      EU: 'https://api.eu.mailgun.net',
      AU: 'https://api.au.mailgun.net',
    }[mail.region];
    const body = new FormData();
    body.set('from', `Petite Terre <${mail.from}>`);
    body.set('to', mail.to);
    body.set('subject', message.subject);
    body.set('text', message.text);
    body.set('o:tracking', 'no');
    let response: Response;
    try {
      response = await fetch(`${origin}/v3/${encodeURIComponent(mail.domain)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`api:${mail.apiKey}`).toString('base64')}` },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      throw new MailDeliveryError('network_or_timeout', true);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new MailDeliveryError(
        `http_${response.status}`,
        [408, 420, 429].includes(response.status) || response.status >= 500,
      );
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new MailDeliveryError('invalid_response', true);
    }
    if (
      !data ||
      typeof data !== 'object' ||
      !('id' in data) ||
      typeof data.id !== 'string' ||
      !data.id.trim() ||
      data.id.length > 500
    )
      throw new MailDeliveryError('invalid_response', true);
    // Accepted by Mailgun; this is not proof of inbox delivery.
    return data.id;
  }
}
