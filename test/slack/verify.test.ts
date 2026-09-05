import { describe, it, expect } from 'vitest';
import { verifySlackSignature } from '../../src/slack/verify';

async function sign(secret: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  return 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('verifySlackSignature', () => {
  const secret = '8f742231b10e8888abcd99yyyzzz85a5';
  const body = 'token=x&command=%2Fcrm&text=lead';
  const now = 1_700_000_000;

  it('accepts a valid signature', async () => {
    const ts = String(now - 10);
    const signature = await sign(secret, ts, body);
    expect(await verifySlackSignature({ signingSecret: secret, timestamp: ts, signature, body, nowSeconds: now })).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const ts = String(now - 10);
    const signature = await sign(secret, ts, body);
    expect(await verifySlackSignature({ signingSecret: secret, timestamp: ts, signature, body: body + '&x=1', nowSeconds: now })).toBe(false);
  });

  it('rejects a stale timestamp', async () => {
    const ts = String(now - 600);
    const signature = await sign(secret, ts, body);
    expect(await verifySlackSignature({ signingSecret: secret, timestamp: ts, signature, body, nowSeconds: now })).toBe(false);
  });

  it('rejects missing headers', async () => {
    expect(await verifySlackSignature({ signingSecret: secret, timestamp: null, signature: null, body, nowSeconds: now })).toBe(false);
  });
});
