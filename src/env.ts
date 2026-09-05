export interface Env {
  KV: KVNamespace;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  ATTIO_TOKEN: string;
  ALLOWED_USERS: string;
  SUMMARY_CHANNEL: string;
  DEFAULT_OWNER_EMAIL: string;
  TIMEZONE?: string;
}

export interface Config {
  allowedUsers: Set<string>;
  summaryChannel: string;
  defaultOwnerEmail: string;
  timezone: string;
}

const REQUIRED: (keyof Env)[] = [
  'SLACK_SIGNING_SECRET',
  'SLACK_BOT_TOKEN',
  'ATTIO_TOKEN',
  'SUMMARY_CHANNEL',
  'DEFAULT_OWNER_EMAIL',
];

export function parseConfig(env: Env): Config {
  for (const key of REQUIRED) {
    if (!env[key]) throw new Error(`Missing required binding ${key}`);
  }
  const allowedUsers = new Set(
    (env.ALLOWED_USERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return {
    allowedUsers,
    summaryChannel: env.SUMMARY_CHANNEL,
    defaultOwnerEmail: env.DEFAULT_OWNER_EMAIL,
    timezone: env.TIMEZONE || 'America/Los_Angeles',
  };
}
