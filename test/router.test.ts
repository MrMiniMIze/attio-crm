import { describe, it, expect } from 'vitest';
import { createRouter } from '../src/router';
import { createMemoryStore } from '../src/store/store';
import type { Env } from '../src/env';

async function signed(path: string, body: string, secret = 's', ts = String(Math.floor(Date.now() / 1000))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const sig = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://x${path}`, {
    method: 'POST', body,
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-slack-signature': sig, 'x-slack-request-timestamp': ts },
  });
}

const env = {
  SLACK_SIGNING_SECRET: 's',
  SLACK_BOT_TOKEN: 'xoxb',
  ATTIO_TOKEN: 'a',
  ALLOWED_USERS: 'U1',
  SUMMARY_CHANNEL: 'C1',
  DEFAULT_OWNER_EMAIL: 'maggie@example.com',
  TASK_AUDIENCE: 'https://x/tasks/write',
  QUEUE_INVOKER: 'crm-queue@p.iam.gserviceaccount.com',
} as Env;

const router = () => createRouter(env, { store: createMemoryStore() });

describe('router', () => {
  it('answers GET /health with ok', async () => {
    const res = await router()(new Request('https://x/health'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('answers GET /healthz too, for Cloud Scheduler', async () => {
    const res = await router()(new Request('https://x/healthz'));
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown paths', async () => {
    const res = await router()(new Request('https://x/nope'));
    expect(res.status).toBe(404);
  });
});

describe('slack routes', () => {
  it('rejects an unsigned command', async () => {
    const req = new Request('https://x/slack/command', { method: 'POST', body: 'command=%2Fcrm&text=&user_id=U1' });
    expect((await router()(req)).status).toBe(401);
  });

  it('rejects a command signed with the wrong secret', async () => {
    const res = await router()(await signed('/slack/command', 'command=%2Fcrm&text=&user_id=U1', 'wrong'));
    expect(res.status).toBe(401);
  });

  it('answers ssl_check pings', async () => {
    const res = await router()(await signed('/slack/command', 'ssl_check=1&token=x'));
    expect(res.status).toBe(200);
  });

  it('routes a signed command from a non-allowlisted user to the refusal', async () => {
    const res = await router()(await signed('/slack/command', 'command=%2Fcrm&text=&user_id=U9&trigger_id=T&channel_id=D&response_url=https%3A%2F%2Fh'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ response_type: 'ephemeral', text: 'This command is limited to the sales team.' });
  });

  it('rejects an interaction without a payload field', async () => {
    expect((await router()(await signed('/slack/interact', 'nothing=here'))).status).toBe(400);
  });

  it('routes a signed block_suggestion (empty query) to an empty option list', async () => {
    const body = 'payload=' + encodeURIComponent(JSON.stringify({ type: 'block_suggestion', action_id: 'deal', value: 'c' }));
    const res = await router()(await signed('/slack/interact', body));
    expect(await res.json()).toEqual({ options: [] });
  });
});

describe('/tasks/write', () => {
  const post = (headers: Record<string, string> = {}) =>
    new Request('https://x/tasks/write', {
      method: 'POST', body: '{}', headers: { 'content-type': 'application/json', ...headers },
    });

  it('rejects a request with no Authorization header', async () => {
    expect((await router()(post())).status).toBe(401);
  });

  it('rejects a bearer token that is not a verifiable Google identity', async () => {
    const res = await router()(post({ authorization: 'Bearer not-a-real-token' }));
    expect(res.status).toBe(401);
  });

  it('rejects a non-Bearer Authorization header', async () => {
    expect((await router()(post({ authorization: 'Basic abc123' }))).status).toBe(401);
  });
});
