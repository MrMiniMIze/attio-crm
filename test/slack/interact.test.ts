import { describe, it, expect } from 'vitest';
import { handleInteraction } from '../../src/slack/interact.ts';
import { fakeSlack } from '../helpers/fake-slack.ts';
import { fakeAttio } from '../helpers/fake-attio.ts';
import { createMemoryStore } from '../../src/store/store.ts';
import { createInlineQueue } from '../../src/platform/queue.ts';
import { runQueuedSubmission } from '../../src/pipeline.ts';
import type { StateValues } from '../../src/slack/types.ts';

const config = { allowedUsers: new Set(['U1']), summaryChannel: 'C1', defaultOwnerEmail: 'maggie@example.com', timezone: 'America/Los_Angeles' };
const maggie = { member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' };
const meta = JSON.stringify({ channel_id: 'D1', requester: 'U1', submission_id: null, response_url: 'https://hooks/r' });

function setup() {
  const slack = fakeSlack();
  const attio = fakeAttio({ members: [maggie], searchHits: { coz: [{ record_id: 'd-1', object: 'deals', text: 'Cozeva', domains: [], emails: [] }] } });
  const store = createMemoryStore();
  const base = { slack: slack.api, attio: attio.client, store, config, newId: () => 'sub-1' };
  // Same wiring the router uses locally: the write runs inline instead of
  // travelling through Cloud Tasks.
  const queue = createInlineQueue((job) => runQueuedSubmission(job, base));
  return { slack, attio, store, deps: { ...base, queue } };
}
const text = (v: string | null) => ({ type: 'plain_text_input', value: v });
const pick = (value: string, label: string) => ({ type: 'external_select', selected_option: { text: { type: 'plain_text' as const, text: label }, value } });
const sel = (value: string) => ({ type: 'static_select', selected_option: { text: { type: 'plain_text' as const, text: value }, value } });
const values = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { [k]: x }])) as StateValues;

describe('handleInteraction', () => {
  it('block_suggestion returns options', async () => {
    const { deps } = setup();
    const res = await handleInteraction({ type: 'block_suggestion', action_id: 'deal', value: 'coz' }, deps);
    expect(await res.json()).toEqual({ options: [{ text: { type: 'plain_text', text: 'Cozeva' }, value: 'id:d-1' }] });
  });

  it('crm_choose_hunt swaps the chooser for the hunt form', async () => {
    const { deps, slack } = setup();
    const res = await handleInteraction({ type: 'block_actions', user: { id: 'U1', name: 'sagar' }, view: { id: 'V1', private_metadata: meta }, actions: [{ action_id: 'crm_choose_hunt', value: 'hunt' }] }, deps);
    expect(res.status).toBe(200);
    expect(slack.calls[0]!.method).toBe('viewsUpdate');
    const [viewId, view] = slack.calls[0]!.args as [string, any];
    expect(viewId).toBe('V1');
    expect(view.callback_id).toBe('crm_hunt');
    expect(view.private_metadata).toBe(meta);
  });

  it('edit_submission opens the stored form prefilled with the submission id in metadata', async () => {
    const { deps, slack, store } = setup();
    await store.putSubmission({
      submission_id: 'sub-1', form_kind: 'note', requester: 'U1', created_at: 't',
      document: { source: { kind: 'modal', requester: 'U1', permalink: null, received_at: 't', raw: '{}' }, actions: [], needs_review: [] },
      report: null, card: { channel: 'C1', ts: '1' }, prefill: { record: { value: 'companies:c-1', label: 'Cozeva (company)' }, note: { value: 'hello' } },
    });
    await handleInteraction({ type: 'block_actions', user: { id: 'U1', name: 'sagar' }, trigger_id: 'T2', channel: { id: 'C1' }, response_url: 'https://hooks/e',
      actions: [{ action_id: 'crm_edit_submission', value: 'sub-1' }] }, deps);
    const [triggerId, view] = slack.calls[0]!.args as [string, any];
    expect(slack.calls[0]!.method).toBe('viewsOpen');
    expect(triggerId).toBe('T2');
    expect(view.callback_id).toBe('crm_note');
    expect(view.blocks.find((b: any) => b.block_id === 'note').element.initial_value).toBe('hello');
    expect(JSON.parse(view.private_metadata)).toMatchObject({ submission_id: 'sub-1', channel_id: 'C1', response_url: 'https://hooks/e' });
  });

  it('edit_submission reports the failure via response_url when opening the form throws', async () => {
    const { deps, slack, store } = setup();
    await store.putSubmission({
      submission_id: 'sub-1', form_kind: 'note', requester: 'U1', created_at: 't',
      document: { source: { kind: 'modal', requester: 'U1', permalink: null, received_at: 't', raw: '{}' }, actions: [], needs_review: [] },
      report: null, card: { channel: 'C1', ts: '1' }, prefill: { record: { value: 'companies:c-1', label: 'Cozeva (company)' }, note: { value: 'hello' } },
    });
    slack.api.viewsOpen = async () => { throw new Error('expired_trigger_id'); };
    await handleInteraction({ type: 'block_actions', user: { id: 'U1', name: 'sagar' }, trigger_id: 'T2', channel: { id: 'C1' }, response_url: 'https://hooks/e',
      actions: [{ action_id: 'crm_edit_submission', value: 'sub-1' }] }, deps);
    expect(slack.calls[slack.calls.length - 1]).toEqual({ method: 'respond', args: ['https://hooks/e', 'Could not open the form: expired_trigger_id'] });
  });

  it('edit_submission by a non-allowlisted user is refused via response_url', async () => {
    const { deps, slack } = setup();
    await handleInteraction({ type: 'block_actions', user: { id: 'U9', name: 'x' }, trigger_id: 'T', channel: { id: 'C1' }, response_url: 'https://hooks/e', actions: [{ action_id: 'crm_edit_submission', value: 'sub-1' }] }, deps);
    expect(slack.calls).toEqual([{ method: 'respond', args: ['https://hooks/e', 'This command is limited to the sales team.'] }]);
  });

  it('view_submission with validation errors returns response_action errors', async () => {
    const { deps } = setup();
    const res = await handleInteraction({ type: 'view_submission', user: { id: 'U1', name: 'sagar' },
      view: { id: 'V1', callback_id: 'crm_note', private_metadata: meta, state: { values: values({ record: { type: 'external_select', selected_option: null }, note: text('') }) } } }, deps);
    expect(await res.json()).toEqual({ response_action: 'errors', errors: { record: 'Pick a company or person', note: 'Enter the note' } });
  });

  it('valid view_submission acknowledges immediately and runs the pipeline in the background', async () => {
    const { deps, slack } = setup();
    const res = await handleInteraction({ type: 'view_submission', user: { id: 'U1', name: 'sagar' },
      view: { id: 'V1', callback_id: 'crm_note', private_metadata: meta, state: { values: values({ record: pick('companies:c-1', 'Cozeva (company)'), note: text('hello') }) } } }, deps);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(slack.calls.map((c) => c.method)).toEqual(['usersInfo', 'chatPostMessage', 'chatGetPermalink', 'chatUpdate', 'respond']);
  });

  it('view_submission from a non-allowlisted user shows a notice instead of writing', async () => {
    const { deps, slack } = setup();
    const res = await handleInteraction({ type: 'view_submission', user: { id: 'U9', name: 'x' },
      view: { id: 'V1', callback_id: 'crm_note', private_metadata: meta, state: { values: values({ record: pick('companies:c-1', 'Cozeva (company)'), note: text('hello') }) } } }, deps);
    const body = await res.json() as any;
    expect(body.response_action).toBe('update');
    expect(JSON.stringify(body.view)).toContain('limited to the sales team');
    expect(slack.calls).toEqual([]);
  });
});
