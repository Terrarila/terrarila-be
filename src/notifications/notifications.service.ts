import { Inject, Injectable, Logger } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { CONFIG } from '../common/config.js';
import type { AppConfig } from '../common/config.js';
import { DatabaseService } from '../database/database.service.js';
import type { SqlClient } from '../database/database.service.js';
import { MailDeliveryError, NOTIFICATION_MAILER } from './mailgun.js';
import type { NotificationMailer } from './mailgun.js';
import { designRequestMessage, orderMessage } from './notification-message.js';
import type { DesignRequestEmailData, OrderEmailData } from './notification-message.js';

export type NotificationKind = 'order' | 'design_request';
type Filter = { kind: NotificationKind; entityId: string };
type Job = {
  id: string;
  kind: NotificationKind;
  order_id: string | null;
  design_request_id: string | null;
  attempts: number;
  lease_token: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(NOTIFICATION_MAILER) private readonly mailer: NotificationMailer,
  ) {}

  // Called inside the same transaction as the new business record. No historical backfill.
  async enqueue(client: SqlClient, kind: NotificationKind, entityId: string) {
    if (!this.config.mailgun) return;
    await client.query(
      `INSERT INTO email_notifications(kind,order_id,design_request_id) VALUES($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [kind, kind === 'order' ? entityId : null, kind === 'design_request' ? entityId : null],
    );
  }

  // Must only be called after COMMIT. Email failures never turn a saved order into an HTTP error.
  async afterCommit(kind: NotificationKind, entityId: string) {
    if (!this.config.mailgun) return;
    const task = this.drain({ kind, entityId }, 1).catch(() => {
      Logger.warn(
        'Email dispatch deferred; run notifications:send or scheduled maintenance',
        'Notifications',
      );
    });
    if (this.config.vercel) {
      try {
        waitUntil(task);
        return;
      } catch {
        // Non-Vercel runners without a request context still await the bounded send.
      }
    }
    await task;
  }

  private async message(job: Job) {
    const adminUrl = this.config.mailgun!.adminUrl;
    if (job.kind === 'order') {
      const row = (
        await this.db.query<OrderEmailData>(
          'SELECT id,number,status,snapshot,contact FROM orders WHERE id=$1',
          [job.order_id],
        )
      ).rows[0];
      if (row) return orderMessage(row, adminUrl);
    } else {
      const row = (
        await this.db.query<DesignRequestEmailData>(
          'SELECT tracking_code AS number,selection,contact FROM design_requests WHERE id=$1',
          [job.design_request_id],
        )
      ).rows[0];
      if (row) return designRequestMessage(row, adminUrl);
    }
    throw new MailDeliveryError('source_missing', false);
  }

  async drain(filter?: Filter, limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 20)
      throw new Error('Notification limit must be 1..20');
    const result = { enabled: Boolean(this.config.mailgun), accepted: 0, retried: 0, failed: 0 };
    if (!this.config.mailgun) return result;
    // Recover expired leases after a crash, but never send beyond the attempt limit.
    await this.db.query(`UPDATE email_notifications SET status='failed',last_error='lease_expired',
      lease_token=NULL,lease_until=NULL WHERE status='sending' AND lease_until<now() AND attempts>=5`);
    for (let index = 0; index < limit; index++) {
      const job = (
        await this.db.query<Job>(
          `WITH candidate AS (
          SELECT id FROM email_notifications WHERE attempts<5
          AND ((status='pending' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<now()))
          AND ($1::text IS NULL OR kind=$1) AND ($2::uuid IS NULL OR COALESCE(order_id,design_request_id)=$2)
          ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
        ) UPDATE email_notifications n SET status='sending',attempts=n.attempts+1,
          lease_until=now()+interval '5 minutes',lease_token=gen_random_uuid()
          FROM candidate WHERE n.id=candidate.id RETURNING n.*`,
          [filter?.kind ?? null, filter?.entityId ?? null],
        )
      ).rows[0];
      if (!job) break;
      try {
        const providerId = await this.mailer.send(await this.message(job));
        await this.db.query(
          `UPDATE email_notifications SET status='accepted',accepted_at=now(),provider_message_id=$3,
           last_error=NULL,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2`,
          [job.id, job.lease_token, providerId],
        );
        result.accepted++;
      } catch (error) {
        const failure =
          error instanceof MailDeliveryError
            ? error
            : new MailDeliveryError('internal_error', true);
        const retry = failure.retryable && job.attempts < 5;
        await this.db.query(
          `UPDATE email_notifications SET status=$3,last_error=$4,
           next_attempt_at=now()+($5::int * interval '1 second'),lease_token=NULL,lease_until=NULL
           WHERE id=$1 AND lease_token=$2`,
          [
            job.id,
            job.lease_token,
            retry ? 'pending' : 'failed',
            failure.reason,
            Math.min(3600, 60 * 5 ** (job.attempts - 1)),
          ],
        );
        if (retry) result.retried++;
        else result.failed++;
        Logger.warn(
          { event: 'email_notification_attempt_failed', id: job.id, reason: failure.reason, retry },
          'Notifications',
        );
      }
    }
    return result;
  }

  async status() {
    return (
      await this.db.query<{ status: string; count: number }>(
        'SELECT status,count(*)::int AS count FROM email_notifications GROUP BY status ORDER BY status',
      )
    ).rows;
  }
}
