import type { StateValues } from './types';

const get = (values: StateValues, block: string) => values[block]?.[block];
const text = (values: StateValues, block: string) => (get(values, block)?.value ?? '').trim();
const picked = (values: StateValues, block: string) => !!get(values, block)?.selected_option;
const date = (values: StateValues, block: string) => get(values, block)?.selected_date ?? null;

export function validateSubmission(callbackId: string, values: StateValues, today: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const due = date(values, 'task_due');
  if (due && due < today) errors.task_due = 'Due date is in the past';

  switch (callbackId) {
    case 'crm_lead':
      if (!picked(values, 'company')) errors.company = 'Pick a company, or type a name or domain and choose "Create new"';
      break;
    case 'crm_hunt': {
      const lines = text(values, 'companies').split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) errors.companies = 'Enter at least one company, one per line';
      else if (lines.length > 15) errors.companies = 'Enter at most 15 companies per submission';
      break;
    }
    case 'crm_deal': {
      if (!picked(values, 'deal')) errors.deal = 'Pick a deal';
      else {
        const changed = picked(values, 'stage') || text(values, 'value') || text(values, 'person_name') || text(values, 'person_email') || text(values, 'note');
        if (!changed) errors.stage = 'Change at least one thing: stage, value, person or note';
      }
      break;
    }
    case 'crm_task':
      if (!picked(values, 'record')) errors.record = 'Pick a company or person';
      if (!text(values, 'task_title')) errors.task_title = 'Enter the task';
      break;
    case 'crm_note':
      if (!picked(values, 'record')) errors.record = 'Pick a company or person';
      if (!text(values, 'note')) errors.note = 'Enter the note';
      break;
    default:
      errors._form = 'Unknown form';
  }
  return errors;
}
