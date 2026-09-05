const FIVE_MINUTES = 60 * 5;

export interface VerifyInput {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  body: string;
  nowSeconds?: number;
}

export async function verifySlackSignature(input: VerifyInput): Promise<boolean> {
  const { signingSecret, timestamp, signature, body } = input;
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > FIVE_MINUTES) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${body}`));
  const expected = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, signature);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
