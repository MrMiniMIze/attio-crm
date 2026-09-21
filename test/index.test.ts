import { describe, it, expect } from 'vitest';
import worker from '../src/index.ts';
import type { Env } from '../src/env.ts';
import { fakeKv } from './helpers/fake-kv.ts';

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
  KV: {} as KVNamespace,
  SLACK_SIGNING_SECRET: 's',
  SLACK_BOT_TOKEN: 'xoxb',
  ATTIO_TOKEN: 'a',
  ALLOWED_USERS: 'U1',
  SUMMARY_CHANNEL: 'C1',
  DEFAULT_OWNER_EMAIL: 'maggie@example.com',
} as Env;

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

describe('worker routing', () => {
  it('answers GET /health with ok', async () => {
    const res = await worker.fetch(new Request('https://x/health'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('returns 404 for unknown paths', async () => {
    const res = await worker.fetch(new Request('https://x/nope'), env, ctx);
    expect(res.status).toBe(404);
  });
});

describe('slack routes', () => {
  const envWithKv = { ...env, KV: fakeKv() };

  it('rejects an unsigned command', async () => {
    const req = new Request('https://x/slack/command', { method: 'POST', body: 'command=%2Fcrm&text=&user_id=U1' });
    const res = await worker.fetch(req, envWithKv, ctx);
    expect(res.status).toBe(401);
  });

  it('rejects a command signed with the wrong secret', async () => {
    const res = await worker.fetch(await signed('/slack/command', 'command=%2Fcrm&text=&user_id=U1', 'wrong'), envWithKv, ctx);
    expect(res.status).toBe(401);
  });

  it('answers ssl_check pings', async () => {
    const res = await worker.fetch(await signed('/slack/command', 'ssl_check=1&token=x'), envWithKv, ctx);
    expect(res.status).toBe(200);
  });

  it('routes a signed command from a non-allowlisted user to the refusal', async () => {
    const res = await worker.fetch(await signed('/slack/command', 'command=%2Fcrm&text=&user_id=U9&trigger_id=T&channel_id=D&response_url=https%3A%2F%2Fh'), envWithKv, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ response_type: 'ephemeral', text: 'This command is limited to the sales team.' });
  });

  it('rejects an interaction without a payload field', async () => {
    const res = await worker.fetch(await signed('/slack/interact', 'nothing=here'), envWithKv, ctx);
    expect(res.status).toBe(400);
  });

  it('routes a signed block_suggestion (empty query) to an empty option list', async () => {
    const body = 'payload=' + encodeURIComponent(JSON.stringify({ type: 'block_suggestion', action_id: 'deal', value: 'c' }));
    const res = await worker.fetch(await signed('/slack/interact', body), envWithKv, ctx);
    expect(await res.json()).toEqual({ options: [] });
  });
});
