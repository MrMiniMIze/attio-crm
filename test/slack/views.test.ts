import { describe, it, expect } from 'vitest';
import {
  buildChooserView, buildFormView, buildSummaryBlocks, encodeMetadata, decodeMetadata,
  formKindFromCallback, truncate, type FormContext,
} from '../../src/slack/views';
import type { WriteReport } from '../../src/contract/write-report';

const meta = { channel_id: 'C1', requester: 'U1', submission_id: null, response_url: 'https://hooks/x' };
const ctx: FormContext = {
  stages: ['Lead', 'In Progress', 'Won 🎉', 'Lost'],
  members: [{ email: 'maggie@example.com', name: 'Maggie Q' }, { email: 'sagar@example.com', name: 'Sagar' }],
  defaultOwnerEmail: 'maggie@example.com',
  metadata: meta,
};

const blockIds = (v: { blocks: { block_id?: string }[] }) => v.blocks.map((b) => b.block_id).filter(Boolean);
const find = (v: { blocks: any[] }, id: string) => v.blocks.find((b) => b.block_id === id);

describe('views', () => {
  it('metadata round-trips', () => {
    expect(decodeMetadata(encodeMetadata(meta))).toEqual(meta);
  });

  it('chooser has five buttons with choose_* action ids', () => {
    const v = buildChooserView(meta);
    expect(v.callback_id).toBe('crm_chooser');
    const actions = v.blocks.find((b) => b.type === 'actions') as any;
    expect(actions.elements.map((e: any) => e.action_id)).toEqual(['choose_lead', 'choose_hunt', 'choose_deal', 'choose_task', 'choose_note']);
  });

  it('lead form has the expected blocks and defaults', () => {
    const v = buildFormView('lead', ctx);
    expect(v.callback_id).toBe('crm_lead');
    expect(blockIds(v)).toEqual(['company', 'person_name', 'person_email', 'stage', 'owner', 'note', 'task_title', 'task_due']);
    const company = find(v, 'company');
    expect(company.element.type).toBe('external_select');
    expect(company.element.action_id).toBe('company');
    expect(company.element.min_query_length).toBe(2);
    const stage = find(v, 'stage');
    expect(stage.element.initial_option.value).toBe('Lead');
    expect(stage.element.options).toHaveLength(4);
    const owner = find(v, 'owner');
    expect(owner.element.initial_option.value).toBe('maggie@example.com');
    expect(find(v, 'person_name').optional).toBe(true);
    expect(v.private_metadata).toBe(encodeMetadata(meta));
  });

  it('hunt, deal, task, note forms have their blocks', () => {
    expect(blockIds(buildFormView('hunt', ctx))).toEqual(['companies', 'stage', 'owner', 'note']);
    expect(blockIds(buildFormView('deal', ctx))).toEqual(['deal', 'stage', 'value', 'person_name', 'person_email', 'note']);
    expect(blockIds(buildFormView('task', ctx))).toEqual(['record', 'task_title', 'task_due', 'assignee']);
    expect(blockIds(buildFormView('note', ctx))).toEqual(['record', 'note']);
    expect(find(buildFormView('deal', ctx), 'stage').optional).toBe(true);
    expect(find(buildFormView('deal', ctx), 'stage').element.initial_option).toBeUndefined();
  });

  it('prefill sets initial values for text, select, date and external select', () => {
    const v = buildFormView('lead', ctx, {
      company: { value: 'id:c-1', label: 'Cozeva · cozeva.com' },
      person_name: { value: 'Jane Doe' },
      stage: { value: 'In Progress' },
      task_due: { value: '2026-09-05' },
    });
    expect(find(v, 'company').element.initial_option).toEqual({ text: { type: 'plain_text', text: 'Cozeva · cozeva.com' }, value: 'id:c-1' });
    expect(find(v, 'person_name').element.initial_value).toBe('Jane Doe');
    expect(find(v, 'stage').element.initial_option.value).toBe('In Progress');
    expect(find(v, 'task_due').element.initial_date).toBe('2026-09-05');
  });

  it('formKindFromCallback maps ids', () => {
    expect(formKindFromCallback('crm_hunt')).toBe('hunt');
    expect(formKindFromCallback('nope')).toBeNull();
  });

  it('summary blocks list items with outcome marks and an Edit button', () => {
    const report: WriteReport = {
      ok: false,
      touched: [],
      items: [
        { kind: 'company', label: 'Cozeva (cozeva.com)', outcome: 'existing', url: 'https://app.attio.com/x/c-1', detail: null, record_id: 'c-1', object: 'companies' },
        { kind: 'deal', label: 'Deal Cozeva', outcome: 'created', url: 'https://app.attio.com/x/d-1', detail: 'stage Lead, owner Maggie', record_id: 'd-1', object: 'deals' },
        { kind: 'task', label: 'Follow up', outcome: 'failed', url: null, detail: 'Attio 400: bad deadline', record_id: null, object: null },
      ],
    };
    const blocks = buildSummaryBlocks({ requesterName: 'Sagar', whenIso: '2026-09-04T23:45:00.000Z', report, submissionId: 'sub-1' });
    const text = JSON.stringify(blocks);
    expect(text).toContain('Sagar via /crm');
    expect(text).toContain('✔ <https://app.attio.com/x/d-1|Deal Cozeva>: created, stage Lead, owner Maggie');
    expect(text).toContain('✖ Follow up: failed (Attio 400: bad deadline)');
    const actions = blocks.find((b) => b.type === 'actions') as any;
    expect(actions.elements[0]).toMatchObject({ action_id: 'edit_submission', value: 'sub-1' });
  });

  it('truncate respects Slack limits', () => {
    expect(truncate('a'.repeat(100), 75)).toHaveLength(75);
    expect(truncate('short', 75)).toBe('short');
  });
});
