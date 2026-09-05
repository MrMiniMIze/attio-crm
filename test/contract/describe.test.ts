import { describe, it, expect } from 'vitest';
import { describeDocument } from '../../src/contract/describe';

const source = { kind: 'modal' as const, requester: 'U1', permalink: null, received_at: 't', raw: '{}' };
const company = { record_id: null, name: 'Cozeva', domain: 'cozeva.com' };
const owner = { member_id: 'm-1', email: 'maggie@example.com' };

describe('describeDocument', () => {
  it('renders one bullet per action', () => {
    const md = describeDocument({ source, needs_review: [], actions: [
      { type: 'upsert_company', company, confidence: 1 },
      { type: 'upsert_person', person: { record_id: null, first_name: 'Jane', last_name: 'Doe', email: 'jane@cozeva.com' }, company, confidence: 1 },
      { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'Lead', value: 4200, owner, confidence: 1 },
      { type: 'create_task', title: 'Follow up', company, person: null, due: '2026-09-05', assignee: owner, confidence: 1 },
      { type: 'add_note', company, person: null, text: 'Warm intro', confidence: 1 },
    ] });
    expect(md.split('\n')).toEqual([
      '- Company: Cozeva (cozeva.com)',
      '- Person: Jane Doe <jane@cozeva.com> at Cozeva',
      '- Deal: Cozeva → Lead, value 4200, owner maggie@example.com',
      '- Task: Follow up, due 2026-09-05, assigned to maggie@example.com',
      '- Note: Warm intro',
    ]);
  });
  it('collapses newlines so every action stays on one bullet', () => {
    const md = describeDocument({ source, needs_review: [], actions: [
      { type: 'add_note', company, person: null, text: 'line one\nline two\n', confidence: 1 },
    ] });
    expect(md).toBe('- Note: line one line two');
  });
});
