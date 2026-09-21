import { describe, it, expect } from 'vitest';
import { createSlackApi, SlackError } from '../../src/slack/api.ts';
import { scriptedFetch } from '../helpers/fetch-mock.ts';

const view = { type: 'modal' as const, callback_id: 'x', title: { type: 'plain_text' as const, text: 'T' }, blocks: [] };

describe('createSlackApi', () => {
  it('posts JSON with the bot token and returns the view id', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { ok: true, view: { id: 'V1' } } }]);
    const api = createSlackApi({ botToken: 'xoxb-1', fetchFn });
    expect(await api.viewsOpen('trig', view)).toEqual({ view_id: 'V1' });
    expect(calls[0]?.url).toBe('https://slack.com/api/views.open');
    expect(calls[0]?.headers['authorization']).toBe('Bearer xoxb-1');
    expect(calls[0]?.body).toEqual({ trigger_id: 'trig', view });
  });

  it('throws SlackError when ok is false', async () => {
    const { fetchFn } = scriptedFetch([{ status: 200, json: { ok: false, error: 'invalid_auth' } }]);
    const api = createSlackApi({ botToken: 'x', fetchFn });
    const err = await api.viewsUpdate('V1', view).catch((e) => e);
    expect(err).toBeInstanceOf(SlackError);
    expect((err as SlackError).error).toBe('invalid_auth');
  });

  it('chatPostMessage returns channel and ts; chatGetPermalink returns the link', async () => {
    const { fetchFn } = scriptedFetch([
      { status: 200, json: { ok: true, channel: 'C1', ts: '1.2' } },
      { status: 200, json: { ok: true, permalink: 'https://slack/p1' } },
    ]);
    const api = createSlackApi({ botToken: 'x', fetchFn });
    expect(await api.chatPostMessage('C1', 'hi', [])).toEqual({ channel: 'C1', ts: '1.2' });
    expect(await api.chatGetPermalink('C1', '1.2')).toBe('https://slack/p1');
  });

  it('usersInfo prefers real_name and reads profile email', async () => {
    const { fetchFn } = scriptedFetch([{ status: 200, json: { ok: true, user: { name: 'sagar', real_name: 'Sagar S', profile: { email: 's@example.com' } } } }]);
    const api = createSlackApi({ botToken: 'x', fetchFn });
    expect(await api.usersInfo('U1')).toEqual({ name: 'Sagar S', email: 's@example.com' });
  });

  it('respond posts an ephemeral payload to the response_url without auth', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, text: 'ok' }]);
    const api = createSlackApi({ botToken: 'x', fetchFn });
    await api.respond('https://hooks.slack.com/r/1', 'Done');
    expect(calls[0]?.url).toBe('https://hooks.slack.com/r/1');
    expect(calls[0]?.body).toEqual({ response_type: 'ephemeral', text: 'Done' });
    expect(calls[0]?.headers['authorization']).toBeUndefined();
  });
});
