import type { Block, View } from './types.ts';

export interface SlackApi {
  viewsOpen(triggerId: string, view: View): Promise<{ view_id: string }>;
  viewsUpdate(viewId: string, view: View): Promise<void>;
  chatPostMessage(channel: string, text: string, blocks: Block[]): Promise<{ channel: string; ts: string }>;
  chatUpdate(channel: string, ts: string, text: string, blocks: Block[]): Promise<void>;
  chatGetPermalink(channel: string, ts: string): Promise<string | null>;
  usersInfo(userId: string): Promise<{ name: string; email: string | null }>;
  respond(responseUrl: string, text: string): Promise<void>;
}

export class SlackError extends Error {
  method: string;
  error: string;
  constructor(method: string, error: string) {
    super(`Slack ${method} failed: ${error}`);
    this.name = 'SlackError';
    this.method = method;
    this.error = error;
  }
}

export function createSlackApi(opts: { botToken: string; fetchFn?: typeof fetch }): SlackApi {
  const fetchFn = opts.fetchFn ?? fetch;

  async function call<T = any>(method: string, body: unknown): Promise<T> {
    const res = await fetchFn(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.botToken}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }));
    if (!json.ok) throw new SlackError(method, json.error ?? `http_${res.status}`);
    return json as T;
  }

  return {
    async viewsOpen(triggerId, view) {
      const res = await call('views.open', { trigger_id: triggerId, view });
      return { view_id: res.view.id };
    },
    async viewsUpdate(viewId, view) {
      await call('views.update', { view_id: viewId, view });
    },
    async chatPostMessage(channel, text, blocks) {
      const res = await call('chat.postMessage', { channel, text, blocks });
      return { channel: res.channel, ts: res.ts };
    },
    async chatUpdate(channel, ts, text, blocks) {
      await call('chat.update', { channel, ts, text, blocks });
    },
    async chatGetPermalink(channel, ts) {
      try {
        const res = await call('chat.getPermalink', { channel, message_ts: ts });
        return res.permalink ?? null;
      } catch { return null; }
    },
    async usersInfo(userId) {
      const res = await call('users.info', { user: userId });
      const u = res.user ?? {};
      return { name: u.real_name || u.profile?.real_name || u.name || userId, email: u.profile?.email ?? null };
    },
    async respond(responseUrl, text) {
      await fetchFn(responseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response_type: 'ephemeral', text }),
      });
    },
  };
}
