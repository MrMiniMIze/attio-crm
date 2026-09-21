import { describe, it, expect } from 'vitest';
import { dropRepeatedTasksAndNotes } from '../../src/input/edit-diff.ts';
import type { ActionDocument } from '../../src/contract/action-document.ts';

const source = { kind: 'modal' as const, requester: 'U1', permalink: null, received_at: 't', raw: '{}' };
const company = { record_id: null, name: null, domain: 'cozeva.com' };
const owner = { member_id: 'm-1', email: 'maggie@example.com' };
const task = { type: 'create_task' as const, title: 'Follow up', company, person: null, due: '2026-09-05', assignee: owner, confidence: 1 };
const note = { type: 'add_note' as const, company, person: null, text: 'Warm intro', confidence: 1 };
const deal = { type: 'set_deal_stage' as const, deal_record_id: null, company, person: null, stage: 'Lead', value: null, owner, confidence: 1 };
const doc = (actions: ActionDocument['actions']): ActionDocument => ({ source, actions, needs_review: [] });

describe('dropRepeatedTasksAndNotes', () => {
  it('keeps deals, drops identical tasks and notes, keeps changed ones', () => {
    const prev = doc([deal, task, note]);
    const next = doc([deal, { ...task, confidence: 0.9 }, { ...note, text: 'Warm intro, met at HLTH' }]);
    expect(dropRepeatedTasksAndNotes(prev, next).actions).toEqual([deal, { ...note, text: 'Warm intro, met at HLTH' }]);
  });
  it('keeps a note or task whose only difference is a nested ref', () => {
    const otherCompany = { record_id: null, name: null, domain: 'otherco.com' };
    const prev = doc([note, task]);
    const next = doc([{ ...note, company: otherCompany }, { ...task, assignee: { member_id: 'm-2', email: 'sam@example.com' } }]);
    expect(dropRepeatedTasksAndNotes(prev, next).actions).toEqual(next.actions);
  });
});
