import { describe, it, expect } from 'vitest';
import { handleCommand } from '../../src/slack/command.ts';
import { fakeSlack } from '../helpers/fake-slack.ts';
import { fakeAttio } from '../helpers/fake-attio.ts';
import { fakeKv } from '../helpers/fake-kv.ts';
import { fakeCtx } from '../helpers/fake-ctx.ts';
import { createStore } from '../../src/store/kv.ts';

const config = { allowedUsers: new Set(['U1']), summaryChannel: 'C1', defaultOwnerEmail: 'maggie@example.com', timezone: 'America/Los_Angeles' };
const form = (text: string, user_id = 'U1') => ({ command: '/crm', text, user_id, trigger_id: 'T1', channel_id: 'D1', response_url: 'https://hooks/r' });

function deps() {
  const slack = fakeSlack();
  const attio = fakeAttio({ members: [{ member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' }] });
  return { slack, attio, deps: { slack: slack.api, attio: attio.client, store: createStore(fakeKv()), config } };
}

describe('handleCommand', () => {
  it('refuses users outside the allowlist', async () => {
    const { deps: d, slack } = deps();
    const { ctx, flush } = fakeCtx();
    const res = await handleCommand(form('', 'U9'), d, ctx);
    await flush();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ response_type: 'ephemeral', text: 'This command is limited to the sales team.' });
    expect(slack.calls).toEqual([]);
  });

  it('opens the chooser for a bare /crm', async () => {
    const { deps: d, slack } = deps();
    const { ctx, flush } = fakeCtx();
    const res = await handleCommand(form(''), d, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    await flush();
    expect(slack.calls[0]?.method).toBe('viewsOpen');
    const [triggerId, view] = slack.calls[0]!.args as [string, any];
    expect(triggerId).toBe('T1');
    expect(view.callback_id).toBe('crm_chooser');
    expect(JSON.parse(view.private_metadata)).toEqual({ channel_id: 'D1', requester: 'U1', submission_id: null, response_url: 'https://hooks/r' });
  });

  it('opens a prefilled form for /crm lead Jane @ cozeva.com', async () => {
    const { deps: d, slack } = deps();
    const { ctx, flush } = fakeCtx();
    await handleCommand(form('lead Jane Doe @ cozeva.com'), d, ctx);
    await flush();
    const view = (slack.calls[0]!.args as [string, any])[1];
    expect(view.callback_id).toBe('crm_lead');
    const company = view.blocks.find((b: any) => b.block_id === 'company');
    expect(company.element.initial_option.value).toBe('new:cozeva.com');
    expect(view.blocks.find((b: any) => b.block_id === 'person_name').element.initial_value).toBe('Jane Doe');
  });

  it('reports failures through the response_url', async () => {
    const { deps: d, slack } = deps();
    slack.api.viewsOpen = async () => { throw new Error('expired_trigger_id'); };
    const { ctx, flush } = fakeCtx();
    await handleCommand(form('note hi'), d, ctx);
    await flush();
    expect(slack.calls.at(-1)).toEqual({ method: 'respond', args: ['https://hooks/r', 'Could not open the form: expired_trigger_id'] });
  });
});
