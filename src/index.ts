import { parseConfig, type Env } from './env.ts';
import { verifySlackSignature } from './slack/verify.ts';
import { handleCommand, type CommandForm } from './slack/command.ts';
import { handleInteraction } from './slack/interact.ts';
import { createAttioClient } from './attio/client.ts';
import { createSlackApi } from './slack/api.ts';
import { createStore } from './store/kv.ts';

function deps(env: Env) {
  return {
    config: parseConfig(env),
    attio: createAttioClient({ token: env.ATTIO_TOKEN }),
    slack: createSlackApi({ botToken: env.SLACK_BOT_TOKEN }),
    store: createStore(env.KV),
  };
}

async function verified(request: Request, env: Env): Promise<{ ok: true; body: string } | { ok: false; response: Response }> {
  const body = await request.text();
  const ok = await verifySlackSignature({
    signingSecret: env.SLACK_SIGNING_SECRET,
    timestamp: request.headers.get('x-slack-request-timestamp'),
    signature: request.headers.get('x-slack-signature'),
    body,
  });
  return ok ? { ok: true, body } : { ok: false, response: new Response('bad signature', { status: 401 }) };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') return new Response('ok', { status: 200 });

    if (request.method === 'POST' && url.pathname === '/slack/command') {
      const v = await verified(request, env);
      if (!v.ok) return v.response;
      const params = new URLSearchParams(v.body);
      if (params.get('ssl_check') === '1') return new Response('', { status: 200 });
      const form: CommandForm = {
        command: params.get('command') ?? '', text: params.get('text') ?? '', user_id: params.get('user_id') ?? '',
        trigger_id: params.get('trigger_id') ?? '', channel_id: params.get('channel_id') ?? '', response_url: params.get('response_url') ?? '',
      };
      return handleCommand(form, deps(env), ctx);
    }

    if (request.method === 'POST' && url.pathname === '/slack/interact') {
      const v = await verified(request, env);
      if (!v.ok) return v.response;
      const raw = new URLSearchParams(v.body).get('payload');
      if (!raw) return new Response('missing payload', { status: 400 });
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { return new Response('bad payload', { status: 400 }); }
      return handleInteraction(payload, deps(env), ctx);
    }

    return new Response('not found', { status: 404 });
  },
};
