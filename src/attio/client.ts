import type { AttioObject } from '../contract/write-report';

export interface AttioRecord {
  record_id: string;
  object: AttioObject;
  values: Record<string, any[]>;
  web_url: string;
  created_at: string;
}

export interface AttioSearchHit {
  record_id: string;
  object: AttioObject;
  text: string;
  domains: string[];
  emails: string[];
}

export interface AttioStatus { status_id: string; title: string; is_archived: boolean }
export interface AttioMember { member_id: string; email: string; first_name: string; last_name: string }
export interface PersonName { first_name: string | null; last_name: string | null }

export interface CreateDealInput {
  name: string; stage: string; ownerEmail: string; companyId: string; peopleIds: string[]; value: number | null;
}
export interface UpdateDealInput { stage?: string | null; value?: number | null; addPeopleIds?: string[] }
export interface CreateTaskInput {
  content: string; deadlineAt: string | null; linked: { object: AttioObject; record_id: string }[]; assigneeMemberId: string;
}
export interface CreateNoteInput { parentObject: AttioObject; parentRecordId: string; title: string; markdown: string }

export interface AttioClient {
  search(objects: AttioObject[], query: string, limit?: number): Promise<AttioSearchHit[]>;
  getRecord(object: AttioObject, recordId: string): Promise<AttioRecord>;
  assertCompany(domain: string, name: string | null): Promise<AttioRecord>;
  createCompany(name: string): Promise<AttioRecord>;
  findCompaniesByName(name: string): Promise<AttioSearchHit[]>;
  assertPerson(email: string, name: PersonName, companyId: string | null): Promise<AttioRecord>;
  createPerson(name: PersonName, companyId: string | null): Promise<AttioRecord>;
  findPeopleByName(fullName: string): Promise<AttioSearchHit[]>;
  queryDealsForCompany(companyId: string): Promise<AttioRecord[]>;
  createDeal(input: CreateDealInput): Promise<AttioRecord>;
  updateDeal(dealId: string, input: UpdateDealInput): Promise<AttioRecord>;
  createTask(input: CreateTaskInput): Promise<{ task_id: string }>;
  createNote(input: CreateNoteInput): Promise<{ note_id: string }>;
  listStageOptions(): Promise<AttioStatus[]>;
  listMembers(): Promise<AttioMember[]>;
}

export class AttioError extends Error {
  constructor(public status: number, public body: string, message?: string) {
    super(message ?? `Attio ${status}: ${body.slice(0, 200)}`);
    this.name = 'AttioError';
  }
}

export interface AttioClientOptions {
  token: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

const MAX_ATTEMPTS = 3;

export function toRecord(object: AttioObject, raw: any): AttioRecord {
  return {
    record_id: raw.id.record_id,
    object,
    values: raw.values ?? {},
    web_url: raw.web_url ?? '',
    created_at: raw.created_at ?? '',
  };
}

export function createAttioClient(opts: AttioClientOptions): AttioClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const baseUrl = opts.baseUrl ?? 'https://api.attio.com/v2';

  async function request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    let lastErr: AttioError | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetchFn(`${baseUrl}${path}`, {
        method,
        headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      const text = await res.text();
      lastErr = new AttioError(res.status, text);
      if (res.status !== 429) throw lastErr;
      const retryAfter = Number(res.headers.get('retry-after') ?? '1');
      if (attempt < MAX_ATTEMPTS) await sleep((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000);
    }
    throw lastErr ?? new AttioError(0, 'unknown');
  }

  const asString = (x: any): string => (typeof x === 'string' ? x : x?.domain ?? x?.email_address ?? '');

  function personValues(name: PersonName, companyId: string | null): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    if (name.first_name || name.last_name) {
      values.name = [{
        first_name: name.first_name ?? '',
        last_name: name.last_name ?? '',
        full_name: [name.first_name, name.last_name].filter(Boolean).join(' '),
      }];
    }
    if (companyId) values.company = [{ target_object: 'companies', target_record_id: companyId }];
    return values;
  }

  const exact = (hits: AttioSearchHit[], name: string) =>
    hits.filter((h) => h.text.trim().toLowerCase() === name.trim().toLowerCase());

  const client: AttioClient = {
    async search(objects, query, limit = 20) {
      const res = await request('POST', '/objects/records/search', {
        query, objects, limit, request_as: { type: 'workspace' },
      });
      return (res.data ?? []).map((d: any): AttioSearchHit => ({
        record_id: d.id.record_id,
        object: d.object_slug,
        text: d.record_text ?? '',
        domains: (d.domains ?? []).map(asString).filter(Boolean),
        emails: (d.email_addresses ?? []).map(asString).filter(Boolean),
      }));
    },

    async getRecord(object, recordId) {
      const res = await request('GET', `/objects/${object}/records/${recordId}`);
      return toRecord(object, res.data);
    },

    async assertCompany(domain, name) {
      const values: Record<string, unknown> = { domains: [{ domain }] };
      if (name) values.name = name;
      const res = await request('PUT', '/objects/companies/records?matching_attribute=domains', { data: { values } });
      return toRecord('companies', res.data);
    },

    async createCompany(name) {
      const res = await request('POST', '/objects/companies/records', { data: { values: { name } } });
      return toRecord('companies', res.data);
    },

    async findCompaniesByName(name) {
      return exact(await client.search(['companies'], name, 25), name);
    },

    async assertPerson(email, name, companyId) {
      const values = { email_addresses: [{ email_address: email }], ...personValues(name, companyId) };
      const res = await request('PUT', '/objects/people/records?matching_attribute=email_addresses', { data: { values } });
      return toRecord('people', res.data);
    },

    async createPerson(name, companyId) {
      const res = await request('POST', '/objects/people/records', { data: { values: personValues(name, companyId) } });
      return toRecord('people', res.data);
    },

    async findPeopleByName(fullName) {
      return exact(await client.search(['people'], fullName, 25), fullName);
    },

    async queryDealsForCompany(companyId) {
      const res = await request('POST', '/objects/deals/records/query', {
        filter: { associated_company: { target_object: 'companies', target_record_id: companyId } },
        limit: 50,
      });
      return (res.data ?? []).map((d: any) => toRecord('deals', d));
    },

    async createDeal(input) {
      const values: Record<string, unknown> = {
        name: input.name,
        stage: input.stage,
        owner: input.ownerEmail,
        associated_company: [{ target_object: 'companies', target_record_id: input.companyId }],
        associated_people: input.peopleIds.map((id) => ({ target_object: 'people', target_record_id: id })),
      };
      if (input.value !== null) values.value = input.value;
      const res = await request('POST', '/objects/deals/records', { data: { values } });
      return toRecord('deals', res.data);
    },

    async updateDeal(dealId, input) {
      const values: Record<string, unknown> = {};
      if (input.stage) values.stage = input.stage;
      if (input.value !== undefined && input.value !== null) values.value = input.value;
      if (input.addPeopleIds && input.addPeopleIds.length > 0) {
        values.associated_people = input.addPeopleIds.map((id) => ({ target_object: 'people', target_record_id: id }));
      }
      const res = await request('PATCH', `/objects/deals/records/${dealId}`, { data: { values } });
      return toRecord('deals', res.data);
    },

    async createTask(input) {
      const res = await request('POST', '/tasks', { data: {
        content: input.content,
        format: 'plaintext',
        deadline_at: input.deadlineAt,
        is_completed: false,
        linked_records: input.linked.map((l) => ({ target_object: l.object, target_record_id: l.record_id })),
        assignees: [{ referenced_actor_type: 'workspace-member', referenced_actor_id: input.assigneeMemberId }],
      } });
      return { task_id: res.data.id.task_id };
    },

    async createNote(input) {
      const res = await request('POST', '/notes', { data: {
        parent_object: input.parentObject,
        parent_record_id: input.parentRecordId,
        title: input.title,
        format: 'markdown',
        content: input.markdown,
      } });
      return { note_id: res.data.id.note_id };
    },

    async listStageOptions() {
      const res = await request('GET', '/objects/deals/attributes/stage/statuses');
      return (res.data ?? []).map((s: any): AttioStatus => ({ status_id: s.id.status_id, title: s.title, is_archived: !!s.is_archived }));
    },

    async listMembers() {
      const res = await request('GET', '/workspace_members');
      return (res.data ?? []).map((m: any): AttioMember => ({
        member_id: m.id.workspace_member_id, email: m.email_address ?? '', first_name: m.first_name ?? '', last_name: m.last_name ?? '',
      }));
    },
  };
  return client;
}
