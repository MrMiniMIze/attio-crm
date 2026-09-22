import { describe, it, expect } from 'vitest';
import { processSubmission, type PipelineDeps } from '../src/pipeline.ts';
import { fakeSlack } from './helpers/fake-slack.ts';
import { fakeAttio } from './helpers/fake-attio.ts';
import { createMemoryStore } from '../src/store/store.ts';
import type { StateValues } from '../src/slack/types.ts';

const config = { allowedUsers: new Set(['U1']), summaryChannel: 'C1', defaultOwnerEmail: 'maggie@example.com', timezone: 'America/Los_Angeles' };
const maggie = { member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' };
const now = () => new Date('2026-09-04T23:45:00.000Z');

const text = (v: string | null) => ({ type: 'plain_text_input', value: v });
const pick = (value: string, label: string) => ({ type: 'external_select', selected_option: { text: { type: 'plain_text' as const, text: label }, value } });
const sel = (value: string) => ({ type: 'static_select', selected_option: { text: { type: 'plain_text' as const, text: value }, value } });
const date = (d: string | null) => ({ type: 'datepicker', selected_date: d });
const values = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { [k]: x }])) as StateValues;

const leadValues = values({
  company: pick('new:cozeva.com', 'Create new: "cozeva.com"'), person_name: text('Jane Doe'), person_email: text('jane@cozeva.com'),
  stage: sel('Lead'), owner: sel('maggie@example.com'), note: text(null), task_title: text('Follow up'), task_due: date('2026-09-05'),
});
const metadata = { channel_id: 'D1', requester: 'U1', submission_id: null, response_url: 'https://hooks/r' };

function setup() {
  const slack = fakeSlack();
  const attio = fakeAttio({ members: [maggie], now });
  const store = createMemoryStore();
  let n = 0;
  const deps: PipelineDeps = { slack: slack.api, attio: attio.client, store, config, now, newId: () => `sub-${++n}` };
  return { slack, attio, store, deps };
}

describe('processSubmission', () => {
  it('posts a card, writes to Attio, updates the card, stores the submission and responds', async () => {
    const { slack, attio, store, deps } = setup();
    await processSubmission({ view: { id: 'V1', callback_id: 'crm_lead', private_metadata: '{}', state: { values: leadValues } }, user: { id: 'U1', name: 'Sagar' }, metadata }, deps);

    expect(slack.calls.map((c) => c.method)).toEqual(['chatPostMessage', 'chatGetPermalink', 'chatUpdate', 'respond']);
    expect(slack.calls[0]!.args[0]).toBe('C1');
    const sourceNotes = attio.calls.filter((c) => c.method === 'createNote' && (c.args[0] as any).title.startsWith('From Sagar via Slack 2026-09-04'));
    expect(sourceNotes).toHaveLength(3);
    expect((sourceNotes[0]!.args[0] as any).markdown).toContain('- Person: Jane Doe <jane@cozeva.com>');
    expect((sourceNotes[0]!.args[0] as any).markdown).toContain('https://slack.test/p/1725.1');
    const update = slack.calls[2]!.args as [string, string, string, any[]];
    expect(update[0]).toBe('C1'); expect(update[1]).toBe('1725.1');
    expect(JSON.stringify(update[3])).toContain('crm_edit_submission');

    const stored = await store.getSubmission('sub-1');
    expect(stored?.form_kind).toBe('lead');
    expect(stored?.card).toEqual({ channel: 'C1', ts: '1725.1' });
    expect(stored?.prefill.person_name).toEqual({ value: 'Jane Doe' });
    expect(stored?.report?.ok).toBe(true);
    expect(slack.calls[3]!.args[1]).toMatch(/^Added to Attio: 5 steps done/);
  });

  it('ignores a duplicate view id', async () => {
    const { slack, deps } = setup();
    const input = { view: { id: 'V1', callback_id: 'crm_lead', private_metadata: '{}', state: { values: leadValues } }, user: { id: 'U1', name: 'Sagar' }, metadata };
    await processSubmission(input, deps);
    await processSubmission(input, deps);
    expect(slack.calls.filter((c) => c.method === 'chatPostMessage')).toHaveLength(1);
  });

  it('an edit reuses the card and drops the repeated task', async () => {
    const { slack, attio, deps } = setup();
    await processSubmission({ view: { id: 'V1', callback_id: 'crm_lead', private_metadata: '{}', state: { values: leadValues } }, user: { id: 'U1', name: 'Sagar' }, metadata }, deps);
    const tasksBefore = attio.calls.filter((c) => c.method === 'createTask').length;
    await processSubmission({
      view: { id: 'V2', callback_id: 'crm_lead', private_metadata: '{}', state: { values: { ...leadValues, person_name: { person_name: text('Jane A. Doe') } } } },
      user: { id: 'U1', name: 'Sagar' }, metadata: { ...metadata, submission_id: 'sub-1' },
    }, deps);
    expect(slack.calls.filter((c) => c.method === 'chatPostMessage')).toHaveLength(1);
    expect(attio.calls.filter((c) => c.method === 'createTask').length).toBe(tasksBefore);
    expect(slack.calls.filter((c) => c.method === 'chatUpdate')).toHaveLength(2);
  });

  it('reports an unexpected failure on the card and via response_url without throwing', async () => {
    const { slack, deps } = setup();
    deps.attio.listMembers = async () => { throw new Error('attio down'); };
    await processSubmission({ view: { id: 'V1', callback_id: 'crm_lead', private_metadata: '{}', state: { values: leadValues } }, user: { id: 'U1', name: 'Sagar' }, metadata }, deps);
    expect(slack.calls.at(-1)).toEqual({ method: 'respond', args: ['https://hooks/r', 'Something went wrong: attio down. Nothing may have been written; please check Attio.'] });
  });

  it('a second edit with the same values does not re-create the task', async () => {
    const { attio, deps } = setup();
    const submit = (id: string, submissionId: string | null) => processSubmission({
      view: { id, callback_id: 'crm_lead', private_metadata: '{}', state: { values: leadValues } },
      user: { id: 'U1', name: 'Sagar' }, metadata: { ...metadata, submission_id: submissionId },
    }, deps);
    await submit('V1', null);
    await submit('V2', 'sub-1');
    await submit('V3', 'sub-1');
    expect(attio.calls.filter((c) => c.method === 'createTask')).toHaveLength(1);
  });

  it('a failure after the writes leaves the summary card intact and reports a bookkeeping failure', async () => {
    const { slack, deps } = setup();
    deps.store.putSubmission = async () => { throw new Error('kv quota'); };
    await processSubmission({ view: { id: 'V1', callback_id: 'crm_lead', private_metadata: '{}', state: { values: leadValues } }, user: { id: 'U1', name: 'Sagar' }, metadata }, deps);
    const updates = slack.calls.filter((c) => c.method === 'chatUpdate');
    expect(updates).toHaveLength(1);
    expect(JSON.stringify(updates[0]!.args[3])).toContain('crm_edit_submission');
    expect(slack.calls.at(-1)!.args[1]).toMatch(/^Attio was updated, but a follow-up step failed: kv quota/);
  });
});
