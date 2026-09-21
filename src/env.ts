export interface Env {
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  ATTIO_TOKEN: string;
  ALLOWED_USERS: string;
  SUMMARY_CHANNEL: string;
  DEFAULT_OWNER_EMAIL: string;
  TIMEZONE?: string;

  // Set by Cloud Run. Absent locally, where the inline queue and the
  // in-memory store stand in for them.
  QUEUE_PARENT?: string;
  TASK_URL?: string;
  TASK_AUDIENCE?: string;
  QUEUE_INVOKER?: string;
}

/** Read the process environment into an Env. Throws only on genuinely
 *  missing configuration, via parseConfig. */
export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    SLACK_SIGNING_SECRET: source.SLACK_SIGNING_SECRET ?? '',
    SLACK_BOT_TOKEN: source.SLACK_BOT_TOKEN ?? '',
    ATTIO_TOKEN: source.ATTIO_TOKEN ?? '',
    ALLOWED_USERS: source.ALLOWED_USERS ?? '',
    SUMMARY_CHANNEL: source.SUMMARY_CHANNEL ?? '',
    DEFAULT_OWNER_EMAIL: source.DEFAULT_OWNER_EMAIL ?? '',
    TIMEZONE: source.TIMEZONE,
    QUEUE_PARENT: source.QUEUE_PARENT,
    TASK_URL: source.TASK_URL,
    TASK_AUDIENCE: source.TASK_AUDIENCE,
    QUEUE_INVOKER: source.QUEUE_INVOKER,
  };
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
    if (!env[key]) throw new Error(`Missing required setting ${key}`);
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
