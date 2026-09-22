import { parseConfig, type Env } from './env.ts';
import { verifySlackSignature } from './slack/verify.ts';
import { handleCommand, type CommandForm } from './slack/command.ts';
import { handleInteraction } from './slack/interact.ts';
import { createAttioClient } from './attio/client.ts';
import { createSlackApi } from './slack/api.ts';
import { verifyQueueToken } from './platform/oidc.ts';
import { createInlineQueue, type Queue } from './platform/queue.ts';
import { runQueuedSubmission, type QueuedSubmission } from './pipeline.ts';
import type { Store } from './store/store.ts';

export interface RouterOptions {
  store: Store;
  /** Omit for local development and tests: the writes then run inline,
   *  before the response, instead of travelling through Cloud Tasks. */
  queue?: Queue;
}

/** Everything here speaks the web Request/Response types, so the same router
 *  runs behind the Node server, under `vitest`, and anywhere else that can
 *  hand it a Request. */
export function createRouter(env: Env, opts: RouterOptions) {
  const config = parseConfig(env);
  const attio = createAttioClient({ token: env.ATTIO_TOKEN });
  const slack = createSlackApi({ botToken: env.SLACK_BOT_TOKEN });
  const base = { config, attio, slack, store: opts.store };

  const queue = opts.queue ?? createInlineQueue((job) => runQueuedSubmission(job, base));
  const deps = { ...base, queue };

  async function verified(request: Request): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
    const body = await request.text();
    const ok = await verifySlackSignature({
      signingSecret: env.SLACK_SIGNING_SECRET,
      timestamp: request.headers.get('x-slack-request-timestamp'),
      signature: request.headers.get('x-slack-signature'),
      body,
    });
    return ok ? { ok: true, body } : { ok: false, response: new Response('bad signature', { status: 401 }) };
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) {
      // Deliberately touches nothing: Cloud Scheduler pings this every few
      // minutes to keep an instance warm, and it should stay that cheap.
      return new Response('ok', { status: 200 });
    }

    if (request.method === 'POST' && url.pathname === '/slack/command') {
      const v = await verified(request);
      if (!v.ok) return v.response;
      const params = new URLSearchParams(v.body);
      if (params.get('ssl_check') === '1') return new Response('', { status: 200 });
      const form: CommandForm = {
        command: params.get('command') ?? '', text: params.get('text') ?? '', user_id: params.get('user_id') ?? '',
        trigger_id: params.get('trigger_id') ?? '', channel_id: params.get('channel_id') ?? '', response_url: params.get('response_url') ?? '',
      };
      return handleCommand(form, deps);
    }

    if (request.method === 'POST' && url.pathname === '/slack/interact') {
      const v = await verified(request);
      if (!v.ok) return v.response;
      const raw = new URLSearchParams(v.body).get('payload');
      if (!raw) return new Response('missing payload', { status: 400 });
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { return new Response('bad payload', { status: 400 }); }
      return handleInteraction(payload, deps);
    }

    // Cloud Tasks delivering a submission back to us. No Slack signature
    // exists on this request, so the OIDC token is the only thing standing
    // between the open internet and a write to Attio.
    if (request.method === 'POST' && url.pathname === '/tasks/write') {
      const ok = await verifyQueueToken(
        request.headers.get('authorization'),
        env.TASK_AUDIENCE ?? '',
        env.QUEUE_INVOKER ?? '',
      );
      if (!ok) return new Response('unauthorized', { status: 401 });

      let job: QueuedSubmission;
      try { job = (await request.json()) as QueuedSubmission; }
      catch { return new Response('bad job', { status: 400 }); }

      try {
        await runQueuedSubmission(job, base);
      } catch (err) {
        // A throw out of here is infrastructure, not business logic: the
        // pipeline reports per-action failures on the summary card itself.
        // 5xx sends the task back to the queue; 2xx would retire it.
        console.error('write failed', err);
        return new Response('retry', { status: 500 });
      }
      return new Response('', { status: 204 });
    }

    return new Response('not found', { status: 404 });
  };
}
