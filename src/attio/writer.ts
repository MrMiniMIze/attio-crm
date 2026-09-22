import type { AttioClient, AttioMember, AttioRecord } from './client.ts';
import { dealStage, recordName } from './records.ts';
import { deadlineIso } from '../util/dates.ts';
import type { Action, ActionDocument, ActorRef, CompanyRef, PersonRef } from '../contract/action-document.ts';
import type { AttioObject, WriteItem, WriteReport } from '../contract/write-report.ts';

export interface WriterOptions {
  defaultOwnerEmail: string;
  timezone: string;
  members: AttioMember[];
  sourceNote: { title: string; markdown: string } | null;
  closedStagePattern?: RegExp;
  now?: () => Date;
}

const RECENT_MS = 15_000;

class Run {
  items: WriteItem[] = [];
  touched = new Map<string, { object: AttioObject; record_id: string }>();
  private companies = new Map<string, AttioRecord | null>();
  private people = new Map<string, AttioRecord | null>();
  lastDeal: AttioRecord | null = null;
  private readonly closed: RegExp;
  private readonly now: () => Date;
  private readonly attio: AttioClient;
  private readonly opts: WriterOptions;

  constructor(attio: AttioClient, opts: WriterOptions) {
    this.attio = attio;
    this.opts = opts;
    this.closed = opts.closedStagePattern ?? /won|lost/i;
    this.now = opts.now ?? (() => new Date());
  }

  private touch(rec: AttioRecord) {
    this.touched.set(rec.record_id, { object: rec.object, record_id: rec.record_id });
  }

  private item(partial: Omit<WriteItem, 'url' | 'record_id' | 'object'> & { rec?: AttioRecord | null }): WriteItem {
    const { rec, ...rest } = partial;
    const item: WriteItem = { ...rest, url: rec?.web_url ?? null, record_id: rec?.record_id ?? null, object: rec?.object ?? null };
    this.items.push(item);
    return item;
  }

  private createdRecently(rec: AttioRecord): boolean {
    const t = Date.parse(rec.created_at);
    return Number.isFinite(t) && Math.abs(this.now().getTime() - t) < RECENT_MS;
  }

  private companyLabel(ref: CompanyRef, rec: AttioRecord | null): string {
    const name = (rec && recordName(rec)) ?? ref.name ?? ref.domain ?? 'company';
    return ref.domain && name !== ref.domain ? `${name} (${ref.domain})` : name;
  }

  async resolveCompany(ref: CompanyRef): Promise<AttioRecord | null> {
    const key = ref.record_id ? `id:${ref.record_id}` : ref.domain ? `domain:${ref.domain.toLowerCase()}` : ref.name ? `name:${ref.name.toLowerCase()}` : null;
    if (!key) return null;
    if (this.companies.has(key)) return this.companies.get(key) ?? null;

    let rec: AttioRecord | null = null;
    let outcome: WriteItem['outcome'] = 'existing';
    let detail: string | null = null;
    try {
      if (ref.record_id) {
        rec = await this.attio.getRecord('companies', ref.record_id);
      } else if (ref.domain) {
        rec = await this.attio.assertCompany(ref.domain.toLowerCase(), ref.name);
        outcome = this.createdRecently(rec) ? 'created' : 'existing';
      } else if (ref.name) {
        const hits = await this.attio.findCompaniesByName(ref.name);
        if (hits.length === 0) { rec = await this.attio.createCompany(ref.name); outcome = 'created'; }
        else if (hits.length === 1) { rec = await this.attio.getRecord('companies', hits[0]!.record_id); }
        else { outcome = 'skipped'; detail = `ambiguous: ${hits.length} companies named "${ref.name}"`; }
      }
    } catch (err) {
      this.companies.set(key, null);
      this.item({ kind: 'company', label: this.companyLabel(ref, null), outcome: 'failed', detail: err instanceof Error ? err.message : String(err) });
      return null;
    }
    this.companies.set(key, rec);
    this.item({ kind: 'company', label: this.companyLabel(ref, rec), outcome, detail, rec });
    if (rec) this.touch(rec);
    return rec;
  }

  async resolvePerson(ref: PersonRef, company: AttioRecord | null): Promise<AttioRecord | null> {
    const full = [ref.first_name, ref.last_name].filter(Boolean).join(' ');
    const key = ref.record_id ? `id:${ref.record_id}` : ref.email ? `email:${ref.email.toLowerCase()}` : full ? `name:${full.toLowerCase()}` : null;
    if (!key) return null;
    if (this.people.has(key)) return this.people.get(key) ?? null;

    let rec: AttioRecord | null = null;
    let outcome: WriteItem['outcome'] = 'existing';
    let detail: string | null = null;
    const name = { first_name: ref.first_name, last_name: ref.last_name };
    try {
      if (ref.record_id) {
        rec = await this.attio.getRecord('people', ref.record_id);
      } else if (ref.email) {
        rec = await this.attio.assertPerson(ref.email.toLowerCase(), name, company?.record_id ?? null);
        outcome = this.createdRecently(rec) ? 'created' : 'existing';
      } else {
        const hits = await this.attio.findPeopleByName(full);
        if (hits.length === 0) { rec = await this.attio.createPerson(name, company?.record_id ?? null); outcome = 'created'; }
        else if (hits.length === 1) { rec = await this.attio.getRecord('people', hits[0]!.record_id); }
        else { outcome = 'skipped'; detail = `ambiguous: ${hits.length} people named "${full}"`; }
      }
    } catch (err) {
      this.people.set(key, null);
      this.item({ kind: 'person', label: full || ref.email || 'person', outcome: 'failed', detail: err instanceof Error ? err.message : String(err) });
      return null;
    }
    this.people.set(key, rec);
    const label = (rec && recordName(rec)) ?? full ?? ref.email ?? 'person';
    this.item({ kind: 'person', label: label || ref.email || 'person', outcome, detail: detail ?? (company ? `linked to ${recordName(company) ?? 'company'}` : null), rec });
    if (rec) this.touch(rec);
    return rec;
  }

  private memberIdFor(actor: ActorRef): string | null {
    if (actor.member_id) return actor.member_id;
    const byEmail = (email: string | null) => (email ? this.opts.members.find((m) => m.email.toLowerCase() === email.toLowerCase())?.member_id ?? null : null);
    return byEmail(actor.email) ?? byEmail(this.opts.defaultOwnerEmail);
  }

  async setDealStage(a: Extract<Action, { type: 'set_deal_stage' }>) {
    const changes: string[] = [];
    if (a.stage) changes.push(`stage ${a.stage}`);
    if (a.value !== null) changes.push(`value ${a.value}`);

    if (a.deal_record_id) {
      const deal = await this.attio.getRecord('deals', a.deal_record_id);
      const companyId = a.person ? ((deal.values.associated_company?.[0]?.target_record_id as string | undefined) ?? null) : null;
      const dealCompany = a.person ? (companyId ? await this.attio.getRecord('companies', companyId) : null) : null;
      const person = a.person ? await this.resolvePerson(a.person, dealCompany) : null;
      await this.applyDealUpdate(deal.record_id, a, person, `Deal ${recordName(deal) ?? a.company.name ?? ''}`.trim(), changes);
      return;
    }

    const company = await this.resolveCompany(a.company);
    const label = `Deal ${this.companyLabel(a.company, company).replace(/ \(.*\)$/, '')}`;
    if (!company) { this.item({ kind: 'deal', label, outcome: 'skipped', detail: 'company not resolved' }); return; }
    const person = a.person ? await this.resolvePerson(a.person, company) : null;
    const open = (await this.attio.queryDealsForCompany(company.record_id)).filter((d) => !this.closed.test(dealStage(d) ?? ''));

    if (open.length > 1) {
      this.item({ kind: 'deal', label, outcome: 'skipped', detail: `${open.length} open deals, pick one with Update deal`, rec: company });
      return;
    }
    if (open.length === 1) {
      // Lead/hunt forms default their stage select; an "add" form never changes an existing deal's stage.
      const current = dealStage(open[0]!);
      const updateChanges = changes.filter((c) => !c.startsWith('stage '));
      updateChanges.push(`kept stage ${current ?? 'unchanged'}`);
      await this.applyDealUpdate(open[0]!.record_id, { ...a, stage: null }, person, label, updateChanges);
      return;
    }
    const ownerEmail = a.owner.email ?? this.opts.defaultOwnerEmail;
    const created = await this.attio.createDeal({
      name: recordName(company) ?? a.company.name ?? a.company.domain ?? 'Deal',
      stage: a.stage as string, // schema guarantees a non-null stage when deal_record_id is null
      ownerEmail,
      companyId: company.record_id,
      peopleIds: person ? [person.record_id] : [],
      value: a.value,
    });
    this.lastDeal = created; this.touch(created);
    this.item({ kind: 'deal', label, outcome: 'created', detail: `stage ${a.stage}, owner ${ownerEmail}`, rec: created });
  }

  private async applyDealUpdate(dealId: string, a: Extract<Action, { type: 'set_deal_stage' }>, person: AttioRecord | null, label: string, changes: string[]) {
    const updated = await this.attio.updateDeal(dealId, { stage: a.stage, value: a.value, addPeopleIds: person ? [person.record_id] : [] });
    if (person) changes.push(`added ${recordName(person) ?? 'person'}`);
    this.lastDeal = updated;
    this.touch(updated);
    this.item({ kind: 'deal', label, outcome: 'updated', detail: changes.join(', ') || null, rec: updated });
  }

  async createTask(a: Extract<Action, { type: 'create_task' }>) {
    const company = a.company ? await this.resolveCompany(a.company) : null;
    const person = a.person ? await this.resolvePerson(a.person, company) : null;
    const assigneeMemberId = this.memberIdFor(a.assignee);
    if (!assigneeMemberId) { this.item({ kind: 'task', label: a.title, outcome: 'failed', detail: `no Attio member found for assignee ${a.assignee.email ?? ''}`.trim() }); return; }
    const linked = [company, person].filter((r): r is AttioRecord => !!r).map((r) => ({ object: r.object, record_id: r.record_id }));
    await this.attio.createTask({ content: a.title, deadlineAt: a.due ? deadlineIso(a.due, this.opts.timezone) : null, linked, assigneeMemberId });
    const who = a.assignee.email ?? this.opts.defaultOwnerEmail;
    this.item({ kind: 'task', label: a.title, outcome: 'created', detail: `${a.due ? `due ${a.due}, ` : ''}assigned to ${who}` });
  }

  async addNote(a: Extract<Action, { type: 'add_note' }>) {
    const company = a.company ? await this.resolveCompany(a.company) : null;
    const person = a.person ? await this.resolvePerson(a.person, company) : null;
    const parent = person ?? company ?? this.lastDeal;
    if (!parent) { this.item({ kind: 'note', label: 'Note', outcome: 'skipped', detail: 'no record to attach the note to' }); return; }
    await this.attio.createNote({ parentObject: parent.object, parentRecordId: parent.record_id, title: 'Note from Slack', markdown: a.text });
    this.touch(parent);
    this.item({ kind: 'note', label: `Note on ${recordName(parent) ?? parent.object}`, outcome: 'created', detail: null, rec: parent });
  }

  async sourceNotes() {
    if (!this.opts.sourceNote || this.touched.size === 0) return;
    let count = 0;
    for (const t of this.touched.values()) {
      await this.attio.createNote({ parentObject: t.object, parentRecordId: t.record_id, title: this.opts.sourceNote.title, markdown: this.opts.sourceNote.markdown });
      count++;
    }
    this.item({ kind: 'note', label: 'Source note', outcome: 'created', detail: `attached to ${count} record${count === 1 ? '' : 's'}` });
  }
}

const KIND_OF: Record<Action['type'], WriteItem['kind']> = {
  upsert_company: 'company', upsert_person: 'person', set_deal_stage: 'deal', create_task: 'task', add_note: 'note',
};

function labelOf(a: Action): string {
  switch (a.type) {
    case 'upsert_company': return a.company.name ?? a.company.domain ?? 'company';
    case 'upsert_person': return [a.person.first_name, a.person.last_name].filter(Boolean).join(' ') || a.person.email || 'person';
    case 'set_deal_stage': return `Deal ${a.company.name ?? a.company.domain ?? ''}`.trim();
    case 'create_task': return a.title;
    case 'add_note': return 'Note';
  }
}

export async function executeDocument(doc: ActionDocument, attio: AttioClient, opts: WriterOptions): Promise<WriteReport> {
  const run = new Run(attio, opts);
  for (const a of doc.actions) {
    try {
      switch (a.type) {
        case 'upsert_company': await run.resolveCompany(a.company); break;
        case 'upsert_person': { const c = a.company ? await run.resolveCompany(a.company) : null; await run.resolvePerson(a.person, c); break; }
        case 'set_deal_stage': await run.setDealStage(a); break;
        case 'create_task': await run.createTask(a); break;
        case 'add_note': await run.addNote(a); break;
      }
    } catch (err) {
      run.items.push({ kind: KIND_OF[a.type], label: labelOf(a), outcome: 'failed', detail: err instanceof Error ? err.message : String(err), url: null, record_id: null, object: null });
    }
  }
  try { await run.sourceNotes(); } catch (err) {
    run.items.push({ kind: 'note', label: 'Source note', outcome: 'failed', detail: err instanceof Error ? err.message : String(err), url: null, record_id: null, object: null });
  }
  return { items: run.items, touched: [...run.touched.values()], ok: !run.items.some((i) => i.outcome === 'failed') };
}
