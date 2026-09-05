import { describe, it, expect } from 'vitest';
import { validateSubmission } from '../../src/slack/validate';
import type { StateValues } from '../../src/slack/types';

const today = '2026-09-04';
const text = (v: string | null) => ({ type: 'plain_text_input', value: v });
const pick = (value: string) => ({ type: 'external_select', selected_option: { text: { type: 'plain_text' as const, text: value }, value } });
const none = { type: 'external_select', selected_option: null };
const date = (d: string | null) => ({ type: 'datepicker', selected_date: d });
const values = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, { [k]: x }])) as StateValues;

describe('validateSubmission', () => {
  it('lead requires a company and a due date not in the past', () => {
    expect(validateSubmission('crm_lead', values({ company: none, task_due: date(null) }), today)).toEqual({ company: 'Pick a company, or type a name or domain and choose "Create new"' });
    expect(validateSubmission('crm_lead', values({ company: pick('id:c-1'), task_due: date('2026-09-01') }), today)).toEqual({ task_due: 'Due date is in the past' });
    expect(validateSubmission('crm_lead', values({ company: pick('id:c-1'), task_due: date('2026-09-04') }), today)).toEqual({});
  });

  it('hunt requires at least one company line', () => {
    expect(validateSubmission('crm_hunt', values({ companies: text('  \n ') }), today)).toEqual({ companies: 'Enter at least one company, one per line' });
    expect(validateSubmission('crm_hunt', values({ companies: text('Ensora') }), today)).toEqual({});
  });

  it('hunt caps the list at 15 companies', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => `Company ${i}`).join('\n');
    const fifteen = Array.from({ length: 15 }, (_, i) => `Company ${i}`).join('\n');
    expect(validateSubmission('crm_hunt', values({ companies: text(sixteen) }), today)).toEqual({ companies: 'Enter at most 15 companies per submission' });
    expect(validateSubmission('crm_hunt', values({ companies: text(fifteen) }), today)).toEqual({});
  });

  it('deal requires a deal and at least one change', () => {
    expect(validateSubmission('crm_deal', values({ deal: none }), today)).toEqual({ deal: 'Pick a deal' });
    expect(validateSubmission('crm_deal', values({ deal: pick('id:d-1'), stage: { type: 'static_select', selected_option: null }, value: text(null), person_name: text(null), person_email: text(null), note: text(null) }), today))
      .toEqual({ stage: 'Change at least one thing: stage, value, person or note' });
    expect(validateSubmission('crm_deal', values({ deal: pick('id:d-1'), value: text('100') }), today)).toEqual({});
  });

  it('task and note require a record and text', () => {
    expect(validateSubmission('crm_task', values({ record: none, task_title: text(null) }), today)).toEqual({ record: 'Pick a company or person', task_title: 'Enter the task' });
    expect(validateSubmission('crm_note', values({ record: pick('companies:c-1'), note: text('') }), today)).toEqual({ note: 'Enter the note' });
    expect(validateSubmission('crm_note', values({ record: pick('companies:c-1'), note: text('hi') }), today)).toEqual({});
  });

  it('unknown callback ids produce a generic error', () => {
    expect(validateSubmission('crm_other', {}, today)).toEqual({ _form: 'Unknown form' });
  });
});
