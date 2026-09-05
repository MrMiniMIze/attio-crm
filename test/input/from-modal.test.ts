import { describe, it, expect } from 'vitest';
import { fromModalSubmission, splitName, parseCompanyPick, isDomain, type MapperContext } from '../../src/input/from-modal';
import type { StateValues } from '../../src/slack/types';

const ctx: MapperContext = {
  members: [{ member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' }],
  defaultOwnerEmail: 'maggie@example.com',
};
const source = { requester: 'U1', received_at: '2026-09-04T23:45:00.000Z', permalink: null };

const text = (v: string | null) => ({ type: 'plain_text_input', value: v });
const pick = (value: string, label: string) => ({ type: 'external_select', selected_option: { text: { type: 'plain_text' as const, text: label }, value } });
const sel = (value: string) => ({ type: 'static_select', selected_option: { text: { type: 'plain_text' as const, text: value }, value } });
const date = (d: string | null) => ({ type: 'datepicker', selected_date: d });
const view = (callback_id: string, values: Record<string, unknown>) => ({
  callback_id, private_metadata: '{}',
  state: { values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { [k]: v }])) as StateValues },
});

describe('helpers', () => {
  it('splitName', () => {
    expect(splitName('Jane Doe')).toEqual({ first_name: 'Jane', last_name: 'Doe' });
    expect(splitName('Cher')).toEqual({ first_name: 'Cher', last_name: null });
    expect(splitName('Jean Paul Van Damme')).toEqual({ first_name: 'Jean', last_name: 'Paul Van Damme' });
  });
  it('isDomain', () => {
    expect(isDomain('cozeva.com')).toBe(true);
    expect(isDomain('sub.cozeva.co.uk')).toBe(true);
    expect(isDomain('Cozeva')).toBe(false);
    expect(isDomain('acme health')).toBe(false);
  });
  it('parseCompanyPick', () => {
    expect(parseCompanyPick('id:c-1', 'Cozeva · cozeva.com')).toEqual({ record_id: 'c-1', name: 'Cozeva', domain: 'cozeva.com' });
    expect(parseCompanyPick('id:c-1', 'Cozeva · no domain')).toEqual({ record_id: 'c-1', name: 'Cozeva', domain: null });
    expect(parseCompanyPick('new:ensora.io', 'Create new: "ensora.io"')).toEqual({ record_id: null, name: null, domain: 'ensora.io' });
    expect(parseCompanyPick('new:Ensora', 'Create new: "Ensora"')).toEqual({ record_id: null, name: 'Ensora', domain: null });
  });
});

describe('fromModalSubmission', () => {
  it('lead form with everything filled produces company, person, deal, task, note in order', () => {
    const doc = fromModalSubmission(view('crm_lead', {
      company: pick('new:cozeva.com', 'Create new: "cozeva.com"'),
      person_name: text('Jane Doe'), person_email: text('jane@cozeva.com'),
      stage: sel('Lead'), owner: sel('maggie@example.com'),
      note: text('Warm intro'), task_title: text('Follow up directly'), task_due: date('2026-09-05'),
    }), source, ctx);
    const company = { record_id: null, name: null, domain: 'cozeva.com' };
    const owner = { member_id: 'm-1', email: 'maggie@example.com' };
    expect(doc.source).toEqual({ kind: 'modal', requester: 'U1', permalink: null, received_at: source.received_at, raw: expect.any(String) });
    expect(doc.actions).toEqual([
      { type: 'upsert_company', company, confidence: 1 },
      { type: 'upsert_person', person: { record_id: null, first_name: 'Jane', last_name: 'Doe', email: 'jane@cozeva.com' }, company, confidence: 1 },
      { type: 'set_deal_stage', deal_record_id: null, company, person: { record_id: null, first_name: 'Jane', last_name: 'Doe', email: 'jane@cozeva.com' }, stage: 'Lead', value: null, owner, confidence: 1 },
      { type: 'create_task', title: 'Follow up directly', company, person: null, due: '2026-09-05', assignee: owner, confidence: 1 },
      { type: 'add_note', company, person: null, text: 'Warm intro', confidence: 1 },
    ]);
    expect(doc.needs_review).toEqual([]);
  });

  it('lead form with only a picked company produces company + deal', () => {
    const doc = fromModalSubmission(view('crm_lead', {
      company: pick('id:c-1', 'Cozeva · cozeva.com'), person_name: text(null), person_email: text(null),
      stage: sel('Lead'), owner: sel('maggie@example.com'), note: text(null), task_title: text(null), task_due: date(null),
    }), source, ctx);
    expect(doc.actions.map((a) => a.type)).toEqual(['upsert_company', 'set_deal_stage']);
  });

  it('hunt form makes a company and deal per non-empty line, note per company', () => {
    const doc = fromModalSubmission(view('crm_hunt', {
      companies: text('Ensora\nacme.com\n\n  '), stage: sel('Lead'), owner: sel('maggie@example.com'), note: text('From board meeting'),
    }), source, ctx);
    expect(doc.actions.map((a) => a.type)).toEqual(['upsert_company', 'upsert_company', 'set_deal_stage', 'set_deal_stage', 'add_note', 'add_note']);
    expect((doc.actions[0] as any).company).toEqual({ record_id: null, name: 'Ensora', domain: null });
    expect((doc.actions[1] as any).company).toEqual({ record_id: null, name: null, domain: 'acme.com' });
  });

  it('deal form updates an existing deal with a null stage when none picked', () => {
    const doc = fromModalSubmission(view('crm_deal', {
      deal: pick('id:d-1', 'Cozeva'), stage: { type: 'static_select', selected_option: null }, value: text('4200'),
      person_name: text(null), person_email: text(null), note: text(null),
    }), source, ctx);
    expect(doc.actions).toEqual([{
      type: 'set_deal_stage', deal_record_id: 'd-1', company: { record_id: null, name: 'Cozeva', domain: null },
      person: null, stage: null, value: 4200, owner: { member_id: null, email: null }, confidence: 1,
    }]);
  });

  it('task form links to a person record and resolves the assignee member id', () => {
    const doc = fromModalSubmission(view('crm_task', {
      record: pick('people:p-1', 'Jane Doe (person)'), task_title: text('Call Jane'), task_due: date(null), assignee: sel('maggie@example.com'),
    }), source, ctx);
    expect(doc.actions).toEqual([{
      type: 'create_task', title: 'Call Jane', company: null,
      person: { record_id: 'p-1', first_name: 'Jane', last_name: 'Doe', email: null },
      due: null, assignee: { member_id: 'm-1', email: 'maggie@example.com' }, confidence: 1,
    }]);
  });

  it('note form attaches to a company', () => {
    const doc = fromModalSubmission(view('crm_note', {
      record: pick('companies:c-1', 'Cozeva (company)'), note: text('Met at conference'),
    }), source, ctx);
    expect(doc.actions).toEqual([{ type: 'add_note', company: { record_id: 'c-1', name: 'Cozeva', domain: null }, person: null, text: 'Met at conference', confidence: 1 }]);
  });

  it('rejects unknown callback ids', () => {
    expect(() => fromModalSubmission(view('crm_other', {}), source, ctx)).toThrow(/unknown form/);
  });
});
