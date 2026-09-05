import type { StateValues } from '../slack/types';
import { formKindFromCallback } from '../slack/views';
import type { AttioMember } from '../attio/client';
import {
  parseActionDocument, type Action, type ActionDocument, type ActorRef, type CompanyRef, type PersonRef,
} from '../contract/action-document';

export interface ModalSource { requester: string; received_at: string; permalink: string | null }
export interface MapperContext { members: AttioMember[]; defaultOwnerEmail: string }
export interface SubmittedView { callback_id: string; state: { values: StateValues }; private_metadata: string }

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export function isDomain(s: string): boolean {
  return DOMAIN_RE.test(s.trim());
}

export function splitName(full: string): { first_name: string | null; last_name: string | null } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0] ?? null, last_name: null };
  return { first_name: parts[0] ?? null, last_name: parts.slice(1).join(' ') };
}

function newCompany(typed: string): CompanyRef {
  const t = typed.trim();
  return isDomain(t)
    ? { record_id: null, name: null, domain: t.toLowerCase() }
    : { record_id: null, name: t, domain: null };
}

export function parseCompanyPick(value: string, label: string): CompanyRef {
  if (value.startsWith('new:')) return newCompany(value.slice(4));
  const id = value.replace(/^id:/, '');
  const [name, domainPart] = label.split(' · ');
  const domain = domainPart && isDomain(domainPart) ? domainPart : null;
  return { record_id: id, name: name?.trim() || null, domain };
}

export function parseRecordPick(value: string, label: string): { company: CompanyRef | null; person: PersonRef | null } {
  const [object, id] = value.split(':');
  const name = label.replace(/\s\((company|person)\)$/, '').trim();
  if (object === 'people' && id) {
    return { company: null, person: { record_id: id, ...splitName(name), email: null } };
  }
  if (object === 'companies' && id) {
    return { company: { record_id: id, name: name || null, domain: null }, person: null };
  }
  throw new Error(`bad record pick: ${value}`);
}

class Values {
  constructor(private readonly values: StateValues) {}
  private raw(block: string) { return this.values[block]?.[block]; }
  text(block: string): string | null {
    const v = this.raw(block)?.value;
    const t = typeof v === 'string' ? v.trim() : '';
    return t ? t : null;
  }
  number(block: string): number | null {
    const t = this.text(block);
    if (t === null) return null;
    const n = Number(t.replace(/[,$\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  date(block: string): string | null { return this.raw(block)?.selected_date ?? null; }
  pick(block: string): { value: string; label: string } | null {
    const o = this.raw(block)?.selected_option;
    return o ? { value: o.value, label: o.text.text } : null;
  }
}

function actor(email: string | null, ctx: MapperContext): ActorRef {
  const e = email ?? ctx.defaultOwnerEmail;
  const member = ctx.members.find((m) => m.email.toLowerCase() === e.toLowerCase());
  return { member_id: member?.member_id ?? null, email: e };
}

function personFrom(v: Values): PersonRef | null {
  const name = v.text('person_name');
  const email = v.text('person_email');
  if (!name && !email) return null;
  const parts = name ? splitName(name) : { first_name: null, last_name: null };
  return { record_id: null, ...parts, email };
}

export function fromModalSubmission(view: SubmittedView, source: ModalSource, ctx: MapperContext): ActionDocument {
  const kind = formKindFromCallback(view.callback_id);
  if (!kind) throw new Error(`unknown form: ${view.callback_id}`);
  const v = new Values(view.state.values);
  const actions: Action[] = [];

  switch (kind) {
    case 'lead': {
      const pick = v.pick('company');
      if (!pick) throw new Error('company is required');
      const company = parseCompanyPick(pick.value, pick.label);
      const person = personFrom(v);
      const owner = actor(v.pick('owner')?.value ?? null, ctx);
      actions.push({ type: 'upsert_company', company, confidence: 1 });
      if (person) actions.push({ type: 'upsert_person', person, company, confidence: 1 });
      actions.push({
        type: 'set_deal_stage', deal_record_id: null, company, person,
        stage: v.pick('stage')?.value ?? null, value: null, owner, confidence: 1,
      });
      const task = v.text('task_title');
      if (task) actions.push({ type: 'create_task', title: task, company, person: null, due: v.date('task_due'), assignee: owner, confidence: 1 });
      const note = v.text('note');
      if (note) actions.push({ type: 'add_note', company, person: null, text: note, confidence: 1 });
      break;
    }
    case 'hunt': {
      const lines = (v.text('companies') ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const owner = actor(v.pick('owner')?.value ?? null, ctx);
      const stage = v.pick('stage')?.value ?? null;
      const note = v.text('note');
      const companies = lines.map(newCompany);
      for (const company of companies) actions.push({ type: 'upsert_company', company, confidence: 1 });
      for (const company of companies) actions.push({ type: 'set_deal_stage', deal_record_id: null, company, person: null, stage, value: null, owner, confidence: 1 });
      if (note) for (const company of companies) actions.push({ type: 'add_note', company, person: null, text: note, confidence: 1 });
      break;
    }
    case 'deal': {
      const pick = v.pick('deal');
      if (!pick) throw new Error('deal is required');
      const company: CompanyRef = { record_id: null, name: pick.label.trim() || null, domain: null };
      const person = personFrom(v);
      actions.push({
        type: 'set_deal_stage', deal_record_id: pick.value.replace(/^id:/, ''), company, person,
        stage: v.pick('stage')?.value ?? null, value: v.number('value'),
        owner: { member_id: null, email: null }, confidence: 1,
      });
      const note = v.text('note');
      if (note) actions.push({ type: 'add_note', company: null, person: null, text: note, confidence: 1 });
      break;
    }
    case 'task': {
      const pick = v.pick('record');
      if (!pick) throw new Error('record is required');
      const { company, person } = parseRecordPick(pick.value, pick.label);
      actions.push({
        type: 'create_task', title: v.text('task_title') ?? '', company, person,
        due: v.date('task_due'), assignee: actor(v.pick('assignee')?.value ?? null, ctx), confidence: 1,
      });
      break;
    }
    case 'note': {
      const pick = v.pick('record');
      if (!pick) throw new Error('record is required');
      const { company, person } = parseRecordPick(pick.value, pick.label);
      actions.push({ type: 'add_note', company, person, text: v.text('note') ?? '', confidence: 1 });
      break;
    }
  }

  return parseActionDocument({
    source: { kind: 'modal', requester: source.requester, permalink: source.permalink, received_at: source.received_at, raw: JSON.stringify(view.state.values) },
    actions,
    needs_review: [],
  });
}
