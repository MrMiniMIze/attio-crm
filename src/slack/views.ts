import type { Block, FormKind, PlainText, Prefill, SlackOption, View } from './types';
import type { WriteReport, WriteItem } from '../contract/write-report';

export interface ViewMetadata {
  channel_id: string;
  requester: string;
  submission_id: string | null;
  response_url: string | null;
}

export interface FormContext {
  stages: string[];
  members: { email: string; name: string }[];
  defaultOwnerEmail: string;
  metadata: ViewMetadata;
}

export const CALLBACK_IDS: Record<FormKind, string> = {
  lead: 'crm_lead', hunt: 'crm_hunt', deal: 'crm_deal', task: 'crm_task', note: 'crm_note',
};

export function formKindFromCallback(callbackId: string): FormKind | null {
  const entry = (Object.entries(CALLBACK_IDS) as [FormKind, string][]).find(([, id]) => id === callbackId);
  return entry ? entry[0] : null;
}

export function encodeMetadata(m: ViewMetadata): string {
  return JSON.stringify(m);
}

export function decodeMetadata(s: string): ViewMetadata {
  let parsed: any;
  try { parsed = JSON.parse(s || '{}'); } catch { parsed = {}; }
  return {
    channel_id: parsed.channel_id ?? '',
    requester: parsed.requester ?? '',
    submission_id: parsed.submission_id ?? null,
    response_url: parsed.response_url ?? null,
  };
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

const plain = (text: string): PlainText => ({ type: 'plain_text', text: truncate(text, 75) });
const option = (text: string, value: string): SlackOption => ({ text: plain(text), value: truncate(value, 150) });

type Field = {
  id: string; label: string; optional?: boolean;
  element:
    | { kind: 'text'; multiline?: boolean; placeholder?: string }
    | { kind: 'email' }
    | { kind: 'number' }
    | { kind: 'date' }
    | { kind: 'select'; options: SlackOption[]; initial?: string | null }
    | { kind: 'external'; placeholder: string };
};

function inputBlock(f: Field, prefill?: Prefill): Block {
  const pre = prefill?.[f.id];
  let element: Record<string, unknown>;
  switch (f.element.kind) {
    case 'text':
      element = { type: 'plain_text_input', action_id: f.id, multiline: !!f.element.multiline };
      if (f.element.placeholder) element.placeholder = plain(f.element.placeholder);
      if (pre) element.initial_value = pre.value;
      break;
    case 'email':
      element = { type: 'email_text_input', action_id: f.id };
      if (pre) element.initial_value = pre.value;
      break;
    case 'number':
      element = { type: 'number_input', action_id: f.id, is_decimal_allowed: true, min_value: '0' };
      if (pre) element.initial_value = pre.value;
      break;
    case 'date':
      element = { type: 'datepicker', action_id: f.id };
      if (pre) element.initial_date = pre.value;
      break;
    case 'select': {
      element = { type: 'static_select', action_id: f.id, options: f.element.options };
      const initialValue = pre?.value ?? f.element.initial ?? null;
      const initial = initialValue ? f.element.options.find((o) => o.value === initialValue) : undefined;
      if (initial) element.initial_option = initial;
      break;
    }
    case 'external':
      element = { type: 'external_select', action_id: f.id, min_query_length: 2, placeholder: plain(f.element.placeholder) };
      if (pre) element.initial_option = option(pre.label ?? pre.value, pre.value);
      break;
  }
  return { type: 'input', block_id: f.id, optional: !!f.optional, label: plain(f.label), element };
}

function stageField(ctx: FormContext, optional: boolean): Field {
  const options = ctx.stages.map((s) => option(s, s));
  const initial = optional ? null : (ctx.stages.includes('Lead') ? 'Lead' : ctx.stages[0] ?? null);
  return { id: 'stage', label: optional ? 'New stage' : 'Stage', optional, element: { kind: 'select', options, initial } };
}

function memberField(id: string, label: string, ctx: FormContext): Field {
  const options = ctx.members.map((m) => option(m.name, m.email));
  return { id, label, element: { kind: 'select', options, initial: ctx.defaultOwnerEmail } };
}

const FORM_TITLES: Record<FormKind, string> = {
  lead: 'Add lead', hunt: 'Add companies to hunt', deal: 'Update deal', task: 'Add task', note: 'Add note',
};

function fields(kind: FormKind, ctx: FormContext): Field[] {
  switch (kind) {
    case 'lead':
      return [
        { id: 'company', label: 'Company', element: { kind: 'external', placeholder: 'Search companies, or type a new name or domain' } },
        { id: 'person_name', label: 'Person name', optional: true, element: { kind: 'text', placeholder: 'Jane Doe' } },
        { id: 'person_email', label: 'Person email', optional: true, element: { kind: 'email' } },
        stageField(ctx, false),
        memberField('owner', 'Deal owner', ctx),
        { id: 'note', label: 'Note', optional: true, element: { kind: 'text', multiline: true } },
        { id: 'task_title', label: 'Follow-up task', optional: true, element: { kind: 'text', placeholder: 'Follow up directly' } },
        { id: 'task_due', label: 'Due date', optional: true, element: { kind: 'date' } },
      ];
    case 'hunt':
      return [
        { id: 'companies', label: 'Companies (one name or domain per line)', element: { kind: 'text', multiline: true } },
        stageField(ctx, false),
        memberField('owner', 'Deal owner', ctx),
        { id: 'note', label: 'Note', optional: true, element: { kind: 'text', multiline: true } },
      ];
    case 'deal':
      return [
        { id: 'deal', label: 'Deal', element: { kind: 'external', placeholder: 'Search deals' } },
        stageField(ctx, true),
        { id: 'value', label: 'Value', optional: true, element: { kind: 'number' } },
        { id: 'person_name', label: 'Add person (name)', optional: true, element: { kind: 'text' } },
        { id: 'person_email', label: 'Add person (email)', optional: true, element: { kind: 'email' } },
        { id: 'note', label: 'Note', optional: true, element: { kind: 'text', multiline: true } },
      ];
    case 'task':
      return [
        { id: 'record', label: 'Company or person', element: { kind: 'external', placeholder: 'Search companies and people' } },
        { id: 'task_title', label: 'Task', element: { kind: 'text' } },
        { id: 'task_due', label: 'Due date', optional: true, element: { kind: 'date' } },
        memberField('assignee', 'Assignee', ctx),
      ];
    case 'note':
      return [
        { id: 'record', label: 'Company or person', element: { kind: 'external', placeholder: 'Search companies and people' } },
        { id: 'note', label: 'Note', element: { kind: 'text', multiline: true } },
      ];
  }
}

export function buildChooserView(meta: ViewMetadata): View {
  const button = (kind: FormKind) => ({
    type: 'button', action_id: `choose_${kind}`, text: plain(FORM_TITLES[kind]), value: kind,
  });
  return {
    type: 'modal',
    callback_id: 'crm_chooser',
    title: plain('Attio'),
    close: plain('Cancel'),
    private_metadata: encodeMetadata(meta),
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: 'What do you want to do?' } },
      { type: 'actions', block_id: 'chooser', elements: (['lead', 'hunt', 'deal', 'task', 'note'] as FormKind[]).map(button) },
    ],
  };
}

export function buildFormView(kind: FormKind, ctx: FormContext, prefill?: Prefill): View {
  return {
    type: 'modal',
    callback_id: CALLBACK_IDS[kind],
    title: plain(FORM_TITLES[kind]),
    submit: plain(ctx.metadata.submission_id ? 'Save changes' : 'Add to Attio'),
    close: plain('Cancel'),
    private_metadata: encodeMetadata(ctx.metadata),
    blocks: fields(kind, ctx).map((f) => inputBlock(f, prefill)),
  };
}

const MARK: Record<WriteItem['outcome'], string> = {
  created: '✔', updated: '✔', existing: '✔', skipped: '•', failed: '✖',
};

function itemLine(item: WriteItem): string {
  const name = item.url ? `<${item.url}|${item.label}>` : item.label;
  const tail = item.outcome === 'failed'
    ? `failed (${item.detail ?? 'unknown error'})`
    : item.detail ? `${item.outcome}, ${item.detail}` : item.outcome;
  return `${MARK[item.outcome]} ${name}: ${tail}`;
}

export function summaryText(report: WriteReport): string {
  return report.items.map((i) => `${i.label}: ${i.outcome}`).join('; ');
}

export function buildSummaryBlocks(input: { requesterName: string; whenIso: string; report: WriteReport; submissionId: string }): Block[] {
  const when = input.whenIso.replace('T', ' ').slice(0, 16);
  const header = `*${input.requesterName} via /crm* · ${when} UTC${input.report.ok ? '' : ' · some steps failed'}`;
  const lines = input.report.items.map(itemLine).join('\n');
  return [
    { type: 'section', text: { type: 'mrkdwn', text: header } },
    { type: 'section', text: { type: 'mrkdwn', text: truncate(lines || '_nothing to do_', 2900) } },
    { type: 'actions', block_id: 'summary_actions', elements: [
      { type: 'button', action_id: 'edit_submission', text: plain('Edit'), value: input.submissionId },
    ] },
  ];
}
