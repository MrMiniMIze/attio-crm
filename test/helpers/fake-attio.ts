import type { AttioClient, AttioMember, AttioRecord, AttioSearchHit, AttioStatus } from '../../src/attio/client.ts';
import type { AttioObject } from '../../src/contract/write-report.ts';

export function rec(object: AttioObject, record_id: string, values: Record<string, any[]> = {}, created_at = '2026-01-01T00:00:00.000Z'): AttioRecord {
  return { record_id, object, values, web_url: `https://app.attio.com/t/${object}/${record_id}`, created_at };
}

export interface FakeSeed {
  companies?: AttioRecord[];
  people?: AttioRecord[];
  deals?: AttioRecord[];
  searchHits?: Record<string, AttioSearchHit[]>;   // keyed by lower-cased query
  members?: AttioMember[];
  stages?: AttioStatus[];
  failOn?: (method: string) => Error | null;
  now?: () => Date;
}

export function fakeAttio(seed: FakeSeed = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const companies = [...(seed.companies ?? [])];
  const people = [...(seed.people ?? [])];
  const deals = [...(seed.deals ?? [])];
  let counter = 0;
  const now = () => (seed.now ? seed.now() : new Date()).toISOString();

  function log(method: string, ...args: unknown[]) {
    calls.push({ method, args });
    const err = seed.failOn?.(method);
    if (err) throw err;
  }
  const exact = (hits: AttioSearchHit[], q: string) => hits.filter((h) => h.text.trim().toLowerCase() === q.trim().toLowerCase());
  const hitsFor = (q: string) => seed.searchHits?.[q.toLowerCase()] ?? [];

  const client: AttioClient = {
    async search(objects, query) { log('search', objects, query); return hitsFor(query).filter((h) => objects.includes(h.object)); },
    async getRecord(object, id) {
      log('getRecord', object, id);
      const pool = object === 'companies' ? companies : object === 'people' ? people : deals;
      const found = pool.find((r) => r.record_id === id);
      if (!found) throw new Error(`fake: no ${object} ${id}`);
      return found;
    },
    async assertCompany(domain, name) {
      log('assertCompany', domain, name);
      const found = companies.find((c) => (c.values.domains ?? []).some((d: any) => d.domain === domain));
      if (found) return found;
      const created = rec('companies', `c-new-${++counter}`, { name: [{ value: name ?? domain }], domains: [{ domain }] }, now());
      companies.push(created);
      return created;
    },
    async createCompany(name) {
      log('createCompany', name);
      const created = rec('companies', `c-new-${++counter}`, { name: [{ value: name }] }, now());
      companies.push(created);
      return created;
    },
    async findCompaniesByName(name) { log('findCompaniesByName', name); return exact(hitsFor(name).filter((h) => h.object === 'companies'), name); },
    async assertPerson(email, name, companyId) {
      log('assertPerson', email, name, companyId);
      const found = people.find((p) => (p.values.email_addresses ?? []).some((e: any) => e.email_address === email));
      if (found) return found;
      const created = rec('people', `p-new-${++counter}`, {
        name: [{ first_name: name.first_name, last_name: name.last_name, full_name: [name.first_name, name.last_name].filter(Boolean).join(' ') }],
        email_addresses: [{ email_address: email }],
      }, now());
      people.push(created);
      return created;
    },
    async createPerson(name, companyId) {
      log('createPerson', name, companyId);
      const created = rec('people', `p-new-${++counter}`, {
        name: [{ first_name: name.first_name, last_name: name.last_name, full_name: [name.first_name, name.last_name].filter(Boolean).join(' ') }],
      }, now());
      people.push(created);
      return created;
    },
    async findPeopleByName(fullName) { log('findPeopleByName', fullName); return exact(hitsFor(fullName).filter((h) => h.object === 'people'), fullName); },
    async queryDealsForCompany(companyId) {
      log('queryDealsForCompany', companyId);
      return deals.filter((d) => (d.values.associated_company ?? []).some((c: any) => c.target_record_id === companyId));
    },
    async createDeal(input) {
      log('createDeal', input);
      const created = rec('deals', `d-new-${++counter}`, {
        name: [{ value: input.name }], stage: [{ status: { title: input.stage } }],
        associated_company: [{ target_object: 'companies', target_record_id: input.companyId }],
      }, now());
      deals.push(created);
      return created;
    },
    async updateDeal(dealId, input) {
      log('updateDeal', dealId, input);
      const deal = deals.find((d) => d.record_id === dealId);
      if (!deal) throw new Error(`fake: no deal ${dealId}`);
      if (input.stage) deal.values.stage = [{ status: { title: input.stage } }];
      if (input.value !== undefined && input.value !== null) deal.values.value = [{ currency_value: input.value }];
      if (input.addPeopleIds?.length) deal.values.associated_people = [...(deal.values.associated_people ?? []), ...input.addPeopleIds.map((id) => ({ target_object: 'people', target_record_id: id }))];
      return deal;
    },
    async createTask(input) { log('createTask', input); return { task_id: `t-${++counter}` }; },
    async createNote(input) { log('createNote', input); return { note_id: `n-${++counter}` }; },
    async listStageOptions() { log('listStageOptions'); return seed.stages ?? [{ status_id: 's1', title: 'Lead', is_archived: false }]; },
    async listMembers() { log('listMembers'); return seed.members ?? []; },
  };
  return { client, calls };
}
