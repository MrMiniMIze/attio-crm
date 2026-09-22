import { describe, it, expect } from 'vitest';
import { parseActionDocument } from '../../src/contract/action-document.ts';

const source = { kind: 'modal', requester: 'U1', permalink: null, received_at: '2026-09-04T23:45:00.000Z', raw: '{}' };
const company = { record_id: null, name: 'Cozeva', domain: 'cozeva.com' };
const owner = { member_id: null, email: 'maggie@example.com' };

describe('parseActionDocument', () => {
  it('accepts a full valid document', () => {
    const doc = parseActionDocument({
      source,
      actions: [
        { type: 'upsert_company', company, confidence: 1 },
        { type: 'upsert_person', person: { record_id: null, first_name: 'Jane', last_name: 'Doe', email: null }, company, confidence: 1 },
        { type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: 'Lead', value: null, owner, confidence: 1 },
        { type: 'create_task', title: 'Follow up', company, person: null, due: '2026-09-05', assignee: owner, confidence: 1 },
        { type: 'add_note', company, person: null, text: 'Portfolio company of Acme', confidence: 1 },
      ],
      needs_review: [],
    });
    expect(doc.actions).toHaveLength(5);
  });

  it('rejects an unknown action type', () => {
    expect(() => parseActionDocument({ source, actions: [{ type: 'delete_everything' }], needs_review: [] })).toThrow();
  });

  it('rejects a new deal without a stage', () => {
    expect(() => parseActionDocument({
      source,
      actions: [{ type: 'set_deal_stage', deal_record_id: null, company, person: null, stage: null, value: null, owner, confidence: 1 }],
      needs_review: [],
    })).toThrow(/stage/);
  });

  it('allows a null stage when updating an existing deal', () => {
    const doc = parseActionDocument({
      source,
      actions: [{ type: 'set_deal_stage', deal_record_id: 'd1', company, person: null, stage: null, value: 5000, owner, confidence: 1 }],
      needs_review: [],
    });
    expect(doc.actions[0]?.type).toBe('set_deal_stage');
  });

  it('rejects a malformed due date', () => {
    expect(() => parseActionDocument({
      source,
      actions: [{ type: 'create_task', title: 'x', company: null, person: null, due: 'tomorrow', assignee: owner, confidence: 1 }],
      needs_review: [],
    })).toThrow();
  });
});
