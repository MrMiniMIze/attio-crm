import { createServer, type IncomingMessage } from 'node:http';
import { readEnv } from './env.ts';
import { createRouter } from './router.ts';
import { createFirestoreStore } from './store/firestore.ts';
import { createMemoryStore } from './store/store.ts';
import { createCloudTasksQueue } from './platform/cloud-tasks.ts';
import type { Queue } from './platform/queue.ts';

const env = readEnv();
const port = Number(process.env.PORT ?? 8080);

// On Cloud Run everything is configured; locally nothing is, and the router
// falls back to running writes inline against an in-memory store.
const onCloudRun = Boolean(env.QUEUE_PARENT && env.TASK_URL && env.QUEUE_INVOKER);

const store = onCloudRun ? createFirestoreStore(new (await import('@google-cloud/firestore')).Firestore()) : createMemoryStore();
const queue: Queue | undefined = onCloudRun
  ? createCloudTasksQueue({ parent: env.QUEUE_PARENT!, targetUrl: env.TASK_URL!, invoker: env.QUEUE_INVOKER! })
  : undefined;

const handle = createRouter(env, { store, queue });

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

createServer(async (req, res) => {
  try {
    const method = req.method ?? 'GET';
    const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
    const raw = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
    const body = raw ? new Uint8Array(raw) : undefined;
    const response = await handle(new Request(url, { method, headers: toHeaders(req), body }));
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => { out[key] = value; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error('unhandled', err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal error');
  }
  // Cloud Run requires 0.0.0.0; binding to localhost passes no health check
  // and the deploy hangs until it times out.
}).listen(port, '0.0.0.0', () => {
  console.log(`attio-crm listening on ${port} (${onCloudRun ? 'Cloud Run' : 'local, inline writes'})`);
});
