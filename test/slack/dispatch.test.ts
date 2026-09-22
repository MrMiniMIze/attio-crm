import { describe, it, expect } from 'vitest';
import { isCrmPayload } from '../../src/slack/dispatch.ts';

describe('isCrmPayload', () => {
  it('claims a submission of one of our modals', () => {
    expect(isCrmPayload({ type: 'view_submission', view: { callback_id: 'crm_lead' } })).toBe(true);
  });

  it('claims the Edit button, which arrives on a message with no view', () => {
    expect(isCrmPayload({ type: 'block_actions', actions: [{ action_id: 'crm_edit_submission' }] })).toBe(true);
  });

  it('claims a picker lookup from inside one of our modals', () => {
    expect(isCrmPayload({ type: 'block_suggestion', action_id: 'company', view: { callback_id: 'crm_lead' } })).toBe(true);
  });

  it('leaves another feature alone even when its ids look similar', () => {
    expect(isCrmPayload({ type: 'view_submission', view: { callback_id: 'crmson_report' } })).toBe(false);
    expect(isCrmPayload({ type: 'block_actions', actions: [{ action_id: 'approve' }] })).toBe(false);
  });

  it('is safe on junk', () => {
    expect(isCrmPayload(null)).toBe(false);
    expect(isCrmPayload('nope')).toBe(false);
    expect(isCrmPayload({})).toBe(false);
  });
});
