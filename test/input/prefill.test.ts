import { describe, it, expect } from 'vitest';
import { prefillFromState } from '../../src/input/prefill';
import type { StateValues } from '../../src/slack/types';

describe('prefillFromState', () => {
  it('captures filled fields and skips empty ones', () => {
    const values: StateValues = {
      company: { company: { type: 'external_select', selected_option: { text: { type: 'plain_text', text: 'Cozeva · cozeva.com' }, value: 'id:c-1' } } },
      person_name: { person_name: { type: 'plain_text_input', value: 'Jane Doe' } },
      person_email: { person_email: { type: 'email_text_input', value: null } },
      stage: { stage: { type: 'static_select', selected_option: { text: { type: 'plain_text', text: 'Lead' }, value: 'Lead' } } },
      task_due: { task_due: { type: 'datepicker', selected_date: '2026-09-05' } },
      note: { note: { type: 'plain_text_input', value: '' } },
    };
    expect(prefillFromState(values)).toEqual({
      company: { value: 'id:c-1', label: 'Cozeva · cozeva.com' },
      person_name: { value: 'Jane Doe' },
      stage: { value: 'Lead', label: 'Lead' },
      task_due: { value: '2026-09-05' },
    });
  });
});
