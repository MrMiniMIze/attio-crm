import { describe, it, expect } from 'vitest';
import { executeDocument, type WriterOptions } from '../../src/attio/writer';
import { fakeAttio, rec } from '../helpers/fake-attio';
import type { ActionDocument } from '../../src/contract/action-document';

const maggie = { member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' };
const opts: WriterOptions = {
  defaultOwnerEmail: 'maggie@example.com', timezone: 'America/Los_Angeles', members: [maggie],
  sourceNote: { title: 'From Sagar via Slack 2026-09-04', markdown: 'Please add Jane' },
  now: () => new Date('2026-09-04T23:45:10.000Z'),
};
const source = { kind: 'modal' as const, requester: 'U1', permalink: null, received_at: '2026-09-04T23:45:00.000Z', raw: '{}' };
const company = { record_id: null, name: null, domain: 'cozeva.com' };
const owner = { member_id: 'm-1', email: 'maggie@example.com' };
const jane = { record_id: null, first_name: 'Jane', last_name: 'Doe', email: 'jane@cozeva.com' };
const doc = (actions: ActionDocument['actions']): ActionDocument => ({ source, actions, needs_review: [] });
const names = (calls: { method: string }[]) => calls.map((c) => c.method);

describe('executeDocument', () => {
  it('creates company, person, deal, task, note and source notes for a new lead', async () => {
    const { client, calls } = fakeAttio({ now: opts.now });
    const report = await executeDocument(doc([
      { type: 'upsert_company', company, confidence: 1 },
      { type: 'upsert_person', person: jane, company, confidence: 1 },
      { type: 'set_deal_stage', deal_record_id: null, company, person: jane, stage: 'Lead', value: null, owner, confidence: 1 },
      { type: 'create_task', title: 'Follow up', company, person: null, due: '2026-09-05', assignee: owner, confidence: 1 },
      { type: 'add_note', company, person: null, text: 'Warm intro', confidence: 1 },
    ]), client, opts);

    expect(names(calls)).toEqual([
      'assertCompany', 'assertPerson', 'queryDealsForCompany', 'createDeal', 'createTask', 'createNote',
      'createNote', 'createNote', 'createNote', // source notes: company, person, deal
    ]);
    const createDeal = calls.find((c) => c.method === 'createDeal')!.args[0] as any;
    expect(createDeal).toMatchObject({ name: 'cozeva.com', stage: 'Lead', ownerEmail: 'maggie@example.com', peopleIds: ['p-new-2'] });
    const createTask = calls.find((c) => c.method === 'createTask')!.args[0] as any;
    expect(createTask).toMatchObject({ content: 'Follow up', deadlineAt: '2026-09-06T00:00:00.000Z', assigneeMemberId: 'm-1' });
    expect(createTask.linked).toEqual([{ object: 'companies', record_id: 'c-new-1' }]);
    expect(report.ok).toBe(true);
    expect(report.items.map((i) => [i.kind, i.outcome])).toEqual([
      ['company', 'created'], ['person', 'created'], ['deal', 'created'], ['task', 'created'], ['note', 'created'], ['note', 'created'],
    ]);
    expect(report.items[5]).toMatchObject({ label: 'Source note', detail: 'attached to 3 records' });
    expect(report.touched.map((t) => t.record_id).sort()).toEqual(['c-new-1', 'd-new-3', 'p-new-2']);
  });

  it('updates the single open deal instead of creating a second one', async () => {
    const cozeva = rec('companies', 'c-1', { name: [{ value: 'Cozeva' }], domains: [{ domain: 'cozeva.com' }] });
    const openDeal = rec('deals', 'd-1', { name: [{ value: 'Cozeva' }], stage: [{ status: { title: 'Lead' } }], associated_company: [{ target_object: 'companies', target_record_id: 'c-1' }] });
    const wonDeal = rec('deals', 'd-0', { name: [{ value: 'Cozeva old' }], stage: [{ status: { title: 'Won 🎉' } }], associated_company: [{ target_object: 'companies', target_record_id: 'c-1' }] });
    const { client, calls } = fakeAttio({ companies: [cozeva], deals: [openDeal, wonDeal] });
    const report = await executeDocument(doc([
      { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'In Progress', value: 4200, owner, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(names(calls)).toEqual(['assertCompany', 'queryDealsForCompany', 'updateDeal']);
    expect(calls[2]!.args).toEqual(['d-1', { stage: null, value: 4200, addPeopleIds: [] }]);
    expect(report.items.map((i) => [i.kind, i.outcome])).toEqual([['company', 'existing'], ['deal', 'updated']]);
    expect(report.items[1]).toMatchObject({ outcome: 'updated', detail: 'value 4200, kept stage Lead' });
  });

  it('keeps the existing open deal\'s stage instead of regressing it from a lead-style form', async () => {
    const cozeva = rec('companies', 'c-1', { name: [{ value: 'Cozeva' }], domains: [{ domain: 'cozeva.com' }] });
    const openDeal = rec('deals', 'd-1', { name: [{ value: 'Cozeva' }], stage: [{ status: { title: 'In Progress' } }], associated_company: [{ target_object: 'companies', target_record_id: 'c-1' }] });
    const { client, calls } = fakeAttio({ companies: [cozeva], deals: [openDeal] });
    const report = await executeDocument(doc([
      { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'Lead', value: null, owner, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(names(calls)).toEqual(['assertCompany', 'queryDealsForCompany', 'updateDeal']);
    expect(calls[2]!.args).toEqual(['d-1', { stage: null, value: null, addPeopleIds: [] }]);
    expect(report.items[1]).toMatchObject({ kind: 'deal', outcome: 'updated', detail: 'kept stage In Progress' });
  });

  it('skips when two open deals exist', async () => {
    const cozeva = rec('companies', 'c-1', { name: [{ value: 'Cozeva' }], domains: [{ domain: 'cozeva.com' }] });
    const d = (id: string) => rec('deals', id, { stage: [{ status: { title: 'Lead' } }], associated_company: [{ target_object: 'companies', target_record_id: 'c-1' }] });
    const { client } = fakeAttio({ companies: [cozeva], deals: [d('d-1'), d('d-2')] });
    const report = await executeDocument(doc([
      { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'Lead', value: null, owner, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(report.items[1]).toMatchObject({ kind: 'deal', outcome: 'skipped', detail: expect.stringContaining('2 open deals') });
    expect(report.ok).toBe(true);
  });

  it('skips an ambiguous company name and the deal that depends on it', async () => {
    const acme = { record_id: null, name: 'Acme', domain: null };
    const { client, calls } = fakeAttio({ searchHits: { acme: [
      { record_id: 'c-1', object: 'companies', text: 'Acme', domains: [], emails: [] },
      { record_id: 'c-2', object: 'companies', text: 'ACME', domains: [], emails: [] },
    ] } });
    const report = await executeDocument(doc([
      { type: 'upsert_company', company: acme, confidence: 1 },
      { type: 'set_deal_stage', deal_record_id: null, company: acme, person: null, stage: 'Lead', value: null, owner, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(names(calls)).toEqual(['findCompaniesByName']);
    expect(report.items).toEqual([
      expect.objectContaining({ kind: 'company', outcome: 'skipped', detail: 'ambiguous: 2 companies named "Acme"' }),
      expect.objectContaining({ kind: 'deal', outcome: 'skipped', detail: 'company not resolved' }),
    ]);
  });

  it('creates a company by name when the search has no exact match', async () => {
    const { client, calls } = fakeAttio({ searchHits: { ensora: [{ record_id: 'c-9', object: 'companies', text: 'Ensora Health', domains: [], emails: [] }] } });
    await executeDocument(doc([{ type: 'upsert_company', company: { record_id: null, name: 'Ensora', domain: null }, confidence: 1 }]), client, { ...opts, sourceNote: null });
    expect(names(calls)).toEqual(['findCompaniesByName', 'createCompany']);
  });

  it('updates an existing deal directly and attaches a ref-less note to it', async () => {
    const deal = rec('deals', 'd-1', { name: [{ value: 'Cozeva' }], stage: [{ status: { title: 'Lead' } }] });
    const { client, calls } = fakeAttio({ deals: [deal] });
    const report = await executeDocument(doc([
      { type: 'set_deal_stage', deal_record_id: 'd-1', company: { record_id: null, name: 'Cozeva', domain: null }, person: null, stage: null, value: 9000, owner: { member_id: null, email: null }, confidence: 1 },
      { type: 'add_note', company: null, person: null, text: 'Budget confirmed', confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(names(calls)).toEqual(['getRecord', 'updateDeal', 'createNote']);
    expect(calls[2]!.args[0]).toMatchObject({ parentObject: 'deals', parentRecordId: 'd-1', markdown: 'Budget confirmed' });
    expect(report.items.map((i) => i.outcome)).toEqual(['updated', 'created']);
  });

  it('links a person added via Update deal to the deal\'s existing company', async () => {
    const cozeva = rec('companies', 'c-1', { name: [{ value: 'Cozeva' }], domains: [{ domain: 'cozeva.com' }] });
    const deal = rec('deals', 'd-1', { name: [{ value: 'Cozeva' }], stage: [{ status: { title: 'Lead' } }], associated_company: [{ target_object: 'companies', target_record_id: 'c-1' }] });
    const { client, calls } = fakeAttio({ companies: [cozeva], deals: [deal] });
    await executeDocument(doc([
      { type: 'set_deal_stage', deal_record_id: 'd-1', company: { record_id: null, name: 'Cozeva', domain: null }, person: jane, stage: null, value: null, owner: { member_id: null, email: null }, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    const assertPersonCall = calls.find((c) => c.method === 'assertPerson')!;
    expect(assertPersonCall.args[2]).toBe('c-1');
    const updateDealCall = calls.find((c) => c.method === 'updateDeal')!;
    expect((updateDealCall.args[1] as any).addPeopleIds).toEqual(['p-new-1']);
  });

  it('fails the task when no assignee member can be resolved but keeps going', async () => {
    const { client } = fakeAttio({ now: opts.now });
    const report = await executeDocument(doc([
      { type: 'create_task', title: 'Call', company: null, person: null, due: null, assignee: { member_id: null, email: 'nobody@example.com' }, confidence: 1 },
      { type: 'upsert_company', company, confidence: 1 },
    ]), client, { ...opts, members: [], sourceNote: null });
    expect(report.items[0]).toMatchObject({ kind: 'task', outcome: 'failed', detail: expect.stringContaining('assignee') });
    expect(report.items[1]).toMatchObject({ kind: 'company', outcome: 'created' });
    expect(report.ok).toBe(false);
  });

  it('turns an Attio error into a failed item', async () => {
    const { client } = fakeAttio({ now: opts.now, failOn: (m) => (m === 'createDeal' ? new Error('Attio 400: bad stage') : null) });
    const report = await executeDocument(doc([
      { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'Nope', value: null, owner, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(report.items[1]).toMatchObject({ kind: 'deal', outcome: 'failed', detail: 'Attio 400: bad stage' });
    expect(report.ok).toBe(false);
  });

  it('memoises a failed company resolution so dependents skip instead of retrying', async () => {
    const { client, calls } = fakeAttio({ failOn: (m) => (m === 'assertCompany' ? new Error('Attio 401: bad token') : null) });
    const report = await executeDocument(doc([
      { type: 'upsert_company', company, confidence: 1 },
      { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'Lead', value: null, owner, confidence: 1 },
      { type: 'create_task', title: 'Follow up', company, person: null, due: null, assignee: owner, confidence: 1 },
    ]), client, { ...opts, sourceNote: null });
    expect(names(calls).filter((m) => m === 'assertCompany')).toHaveLength(1);
    expect(report.items[0]).toMatchObject({ kind: 'company', outcome: 'failed', detail: 'Attio 401: bad token' });
    expect(report.items[1]).toMatchObject({ kind: 'deal', outcome: 'skipped', detail: 'company not resolved' });
    expect(report.ok).toBe(false);
  });
});
