import type { FormKind, Prefill } from '../slack/types.ts';
import { isDomain } from './from-modal.ts';

export interface ParsedCommand { kind: FormKind | 'chooser'; prefill: Prefill }

/** Seam for alternative input parsers (for example an LLM-backed one): text in, form kind + prefill out. A parser never writes to Attio; the prefilled form is the confirmation step. */
export interface Parser { parse(text: string, today: string): ParsedCommand }
export const ruleParser: Parser = { parse: parseCommandText };

const KINDS: FormKind[] = ['lead', 'hunt', 'deal', 'task', 'note'];

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function newCompanyPrefill(text: string) {
  return { value: `new:${text.slice(0, 140)}`, label: `Create new: "${text}"` };
}

export function parseCommandText(text: string, today: string): ParsedCommand {
  const trimmed = text.trim();
  if (!trimmed) return { kind: 'chooser', prefill: {} };
  const [first = '', ...restParts] = trimmed.split(/\s+/);
  const kind = first.toLowerCase() as FormKind;
  if (!KINDS.includes(kind)) return { kind: 'chooser', prefill: {} };
  const rest = restParts.join(' ').trim();
  const prefill: Prefill = {};

  switch (kind) {
    case 'lead': {
      if (!rest) break;
      const at = rest.indexOf('@');
      if (at >= 0) {
        const person = rest.slice(0, at).trim();
        const company = rest.slice(at + 1).trim();
        if (person) prefill.person_name = { value: person };
        if (company) prefill.company = newCompanyPrefill(company);
      } else if (isDomain(rest)) {
        prefill.company = newCompanyPrefill(rest);
      } else {
        prefill.person_name = { value: rest };
      }
      break;
    }
    case 'hunt': {
      const lines = rest.split(',').map((s) => s.trim()).filter(Boolean);
      if (lines.length) prefill.companies = { value: lines.join('\n') };
      break;
    }
    case 'deal':
      break;
    case 'task': {
      const m = rest.match(/^(.*?)\s+due\s+(tomorrow|today|\d{4}-\d{2}-\d{2})\s*$/i);
      const title = (m ? m[1] : rest)?.trim() ?? '';
      if (title) prefill.task_title = { value: title };
      if (m) {
        const due = m[2]!.toLowerCase();
        prefill.task_due = { value: due === 'tomorrow' ? addDays(today, 1) : due === 'today' ? today : due };
      }
      break;
    }
    case 'note':
      if (rest) prefill.note = { value: rest };
      break;
  }
  return { kind, prefill };
}
