export interface ScriptedResponse {
  status: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export function scriptedFetch(responses: ScriptedResponse[]) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const rawBody = typeof init?.body === 'string' ? init.body : null;
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k.toLowerCase()] = v; });
    calls.push({ url, method, body: rawBody ? JSON.parse(rawBody) : null, headers });
    const next = queue.shift();
    if (!next) throw new Error(`scriptedFetch: no response left for ${method} ${url}`);
    const body = next.text ?? (next.json === undefined ? '' : JSON.stringify(next.json));
    return new Response(body, { status: next.status, headers: { 'content-type': 'application/json', ...(next.headers ?? {}) } });
  };
  return { fetchFn, calls };
}
