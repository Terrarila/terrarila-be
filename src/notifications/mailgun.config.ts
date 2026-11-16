import { isEmail, isFQDN } from 'class-validator';

export type MailgunConfig = {
  apiKey: string;
  domain: string;
  region: 'US' | 'EU' | 'AU';
  from: string;
  to: string;
  adminUrl: string | null;
};

export function loadMailgunConfig(env: NodeJS.ProcessEnv): MailgunConfig | null {
  if (env.MAILGUN_ENABLED !== undefined && !['true', 'false'].includes(env.MAILGUN_ENABLED))
    throw new Error('MAILGUN_ENABLED must be true or false');
  if (env.MAILGUN_ENABLED !== 'true') return null;
  const domain = env.MAILGUN_DOMAIN?.trim().toLowerCase() ?? '';
  if (!isFQDN(domain)) throw new Error('MAILGUN_DOMAIN must be a domain name');
  const apiKey = env.MAILGUN_API_KEY?.trim() ?? '';
  if (!apiKey || /\s/.test(apiKey)) throw new Error('MAILGUN_API_KEY is required');
  const region = env.MAILGUN_REGION;
  if (region !== 'US' && region !== 'EU' && region !== 'AU')
    throw new Error('MAILGUN_REGION must be US, EU or AU');
  const from = env.MAILGUN_FROM?.trim() ?? '';
  const to = env.MAILGUN_NOTIFY_TO?.trim() ?? '';
  for (const [key, value] of [
    ['MAILGUN_FROM', from],
    ['MAILGUN_NOTIFY_TO', to],
  ])
    if (!value || /[\r\n]/.test(value) || !isEmail(value))
      throw new Error(`${key} must be a single email address`);
  let adminUrl: string | null = null;
  if (env.ADMIN_APP_URL) {
    const url = new URL(env.ADMIN_APP_URL);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.origin !== env.ADMIN_APP_URL
    )
      throw new Error('ADMIN_APP_URL must be an HTTPS origin without a trailing slash');
    adminUrl = url.origin;
  }
  return { apiKey, domain, region, from, to, adminUrl };
}
