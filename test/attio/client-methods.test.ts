import { describe, it, expect } from 'vitest';
import { createAttioClient } from '../../src/attio/client.ts';
import { scriptedFetch } from '../helpers/fetch-mock.ts';

const raw = (record_id: string, values: Record<string, unknown[]>) => ({
  id: { workspace_id: 'w', object_id: 'o', record_id }, created_at: '2026-09-04T20:00:00.000Z',
  web_url: `https://app.attio.com/acme/x/${record_id}`, values,
});

describe('AttioClient methods', () => {
  it('search posts the query with workspace context and maps hits', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: [
      { id: { record_id: 'c-1' }, object_slug: 'companies', record_text: 'Cozeva', domains: ['cozeva.com'] },
      { id: { record_id: 'p-1' }, object_slug: 'people', record_text: 'Jane Doe', email_addresses: [{ email_address: 'j@cozeva.com' }] },
    ] } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const hits = await attio.search(['companies', 'people'], 'coz', 10);
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/records/search');
    expect(calls[0]?.body).toEqual({ query: 'coz', objects: ['companies', 'people'], limit: 10, request_as: { type: 'workspace' } });
    expect(hits).toEqual([
      { record_id: 'c-1', object: 'companies', text: 'Cozeva', domains: ['cozeva.com'], emails: [] },
      { record_id: 'p-1', object: 'people', text: 'Jane Doe', domains: [], emails: ['j@cozeva.com'] },
    ]);
  });

  it('assertCompany PUTs with matching_attribute=domains', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: raw('c-1', {}) } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const rec = await attio.assertCompany('cozeva.com', 'Cozeva');
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/companies/records?matching_attribute=domains');
    expect(calls[0]?.body).toEqual({ data: { values: { domains: [{ domain: 'cozeva.com' }], name: 'Cozeva' } } });
    expect(rec.record_id).toBe('c-1');
  });

  it('findCompaniesByName keeps only exact, case-insensitive matches', async () => {
    const { fetchFn } = scriptedFetch([{ status: 200, json: { data: [
      { id: { record_id: 'c-1' }, object_slug: 'companies', record_text: 'Acme' },
      { id: { record_id: 'c-2' }, object_slug: 'companies', record_text: 'Acme Health' },
    ] } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const hits = await attio.findCompaniesByName('acme');
    expect(hits.map((h) => h.record_id)).toEqual(['c-1']);
  });

  it('assertPerson sends email, name and company reference', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: raw('p-1', {}) } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    await attio.assertPerson('j@cozeva.com', { first_name: 'Jane', last_name: 'Doe' }, 'c-1');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/people/records?matching_attribute=email_addresses');
    expect(calls[0]?.body).toEqual({ data: { values: {
      email_addresses: [{ email_address: 'j@cozeva.com' }],
      name: [{ first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe' }],
      company: [{ target_object: 'companies', target_record_id: 'c-1' }],
    } } });
  });

  it('queryDealsForCompany filters on associated_company', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: [raw('d-1', { stage: [{ status: { title: 'Lead' } }] })] } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const deals = await attio.queryDealsForCompany('c-1');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/deals/records/query');
    expect(calls[0]?.body).toEqual({ filter: { associated_company: { target_object: 'companies', target_record_id: 'c-1' } }, limit: 50 });
    expect(deals[0]?.record_id).toBe('d-1');
    expect(deals[0]?.object).toBe('deals');
  });

  it('createDeal sends stage by title, owner by email and references by id', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: raw('d-1', {}) } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    await attio.createDeal({ name: 'Cozeva', stage: 'Lead', ownerEmail: 'maggie@example.com', companyId: 'c-1', peopleIds: ['p-1'], value: null });
    expect(calls[0]?.body).toEqual({ data: { values: {
      name: 'Cozeva', stage: 'Lead', owner: 'maggie@example.com',
      associated_company: [{ target_object: 'companies', target_record_id: 'c-1' }],
      associated_people: [{ target_object: 'people', target_record_id: 'p-1' }],
    } } });
  });

  it('updateDeal PATCHes only the provided fields', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: raw('d-1', {}) } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    await attio.updateDeal('d-1', { stage: 'In Progress', value: 4200 });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/deals/records/d-1');
    expect(calls[0]?.body).toEqual({ data: { values: { stage: 'In Progress', value: 4200 } } });
  });

  it('updateDeal sends associated_people references for addPeopleIds', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: raw('d-1', {}) } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    await attio.updateDeal('d-1', { addPeopleIds: ['p-1', 'p-2'] });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.body).toEqual({ data: { values: { associated_people: [
      { target_object: 'people', target_record_id: 'p-1' },
      { target_object: 'people', target_record_id: 'p-2' },
    ] } } });
  });

  it('createTask and createNote return ids', async () => {
    const { fetchFn, calls } = scriptedFetch([
      { status: 200, json: { data: { id: { task_id: 't-1' } } } },
      { status: 200, json: { data: { id: { note_id: 'n-1' } } } },
    ]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const task = await attio.createTask({ content: 'Follow up', deadlineAt: '2026-09-06T00:00:00.000Z', linked: [{ object: 'companies', record_id: 'c-1' }], assigneeMemberId: 'm-1' });
    expect(task).toEqual({ task_id: 't-1' });
    expect(calls[0]?.body).toEqual({ data: {
      content: 'Follow up', format: 'plaintext', deadline_at: '2026-09-06T00:00:00.000Z', is_completed: false,
      linked_records: [{ target_object: 'companies', target_record_id: 'c-1' }],
      assignees: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: 'm-1' }],
    } });
    const note = await attio.createNote({ parentObject: 'companies', parentRecordId: 'c-1', title: 'From Sagar', markdown: '**hi**' });
    expect(note).toEqual({ note_id: 'n-1' });
    expect(calls[1]?.body).toEqual({ data: { parent_object: 'companies', parent_record_id: 'c-1', title: 'From Sagar', format: 'markdown', content: '**hi**' } });
  });

  it('listStageOptions and listMembers map ids', async () => {
    const { fetchFn, calls } = scriptedFetch([
      { status: 200, json: { data: [{ id: { status_id: 's-1' }, title: 'Lead', is_archived: false }] } },
      { status: 200, json: { data: [{ id: { workspace_member_id: 'm-1' }, email_address: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' }] } },
    ]);
    const attio = createAttioClient({ token: 't', fetchFn });
    expect(await attio.listStageOptions()).toEqual([{ status_id: 's-1', title: 'Lead', is_archived: false }]);
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/deals/attributes/stage/statuses');
    expect(await attio.listMembers()).toEqual([{ member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' }]);
    expect(calls[1]?.url).toBe('https://api.attio.com/v2/workspace_members');
  });

  it('createCompany posts a name only', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: raw('c-9', {}) } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const rec = await attio.createCompany('Ensora');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/companies/records');
    expect(calls[0]?.body).toEqual({ data: { values: { name: 'Ensora' } } });
    expect(rec.record_id).toBe('c-9');
  });

  it('createPerson sends name and company without email, and omits company when null', async () => {
    const { fetchFn, calls } = scriptedFetch([
      { status: 200, json: { data: raw('p-9', {}) } },
      { status: 200, json: { data: raw('p-10', {}) } },
    ]);
    const attio = createAttioClient({ token: 't', fetchFn });
    await attio.createPerson({ first_name: 'Jane', last_name: 'Doe' }, 'c-1');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/people/records');
    expect(calls[0]?.body).toEqual({ data: { values: {
      name: [{ first_name: 'Jane', last_name: 'Doe', full_name: 'Jane Doe' }],
      company: [{ target_object: 'companies', target_record_id: 'c-1' }],
    } } });
    await attio.createPerson({ first_name: 'Cher', last_name: null }, null);
    expect(calls[1]?.body).toEqual({ data: { values: { name: [{ first_name: 'Cher', last_name: '', full_name: 'Cher' }] } } });
  });

  it('findPeopleByName searches people and keeps only exact, case-insensitive matches', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: [
      { id: { record_id: 'p-1' }, object_slug: 'people', record_text: 'Jane Doe' },
      { id: { record_id: 'p-2' }, object_slug: 'people', record_text: 'Jane Doerr' },
    ] } }]);
    const attio = createAttioClient({ token: 't', fetchFn });
    const hits = await attio.findPeopleByName('jane doe');
    expect(calls[0]?.body).toMatchObject({ objects: ['people'], query: 'jane doe' });
    expect(hits.map((h) => h.record_id)).toEqual(['p-1']);
  });
});
