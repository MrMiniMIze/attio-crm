import { describe, it, expect } from 'vitest';
import { parseConfig, type Env } from '../src/env';

const base = {
  KV: {} as KVNamespace,
  SLACK_SIGNING_SECRET: 's',
  SLACK_BOT_TOKEN: 'xoxb',
  ATTIO_TOKEN: 'a',
  ALLOWED_USERS: 'U1, U2 ,',
  SUMMARY_CHANNEL: 'C1',
  DEFAULT_OWNER_EMAIL: 'maggie@example.com',
} as Env;

describe('parseConfig', () => {
  it('splits and trims ALLOWED_USERS and defaults the timezone', () => {
    const cfg = parseConfig(base);
    expect([...cfg.allowedUsers]).toEqual(['U1', 'U2']);
    expect(cfg.summaryChannel).toBe('C1');
    expect(cfg.defaultOwnerEmail).toBe('maggie@example.com');
    expect(cfg.timezone).toBe('America/Los_Angeles');
  });

  it('honours an explicit TIMEZONE', () => {
    expect(parseConfig({ ...base, TIMEZONE: 'Europe/London' }).timezone).toBe('Europe/London');
  });

  it('throws when a required secret is missing', () => {
    expect(() => parseConfig({ ...base, ATTIO_TOKEN: '' })).toThrow(/ATTIO_TOKEN/);
  });
});
