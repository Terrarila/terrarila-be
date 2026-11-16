import 'reflect-metadata';
import { loadConfig } from '../src/common/config.js';
import { createPool, DatabaseService } from '../src/database/database.service.js';
import { MailgunMailer } from '../src/notifications/mailgun.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

const mode = process.argv[2];
if (mode !== 'status' && mode !== 'send') throw new Error('Usage: notifications.ts status|send');
const config = loadConfig();
const pool = createPool(config);
const notifications = new NotificationsService(
  new DatabaseService(pool),
  config,
  new MailgunMailer(config),
);
try {
  console.log(
    JSON.stringify(mode === 'status' ? await notifications.status() : await notifications.drain()),
  );
} catch {
  console.error('Notification operation failed. Check database/configuration and retry.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
