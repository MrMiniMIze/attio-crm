import { describe, it, expect } from 'vitest';
import { createMemoryStore, type SubmissionRecord } from '../../src/store/store';

const rec: SubmissionRecord = {
  submission_id: 'sub-1', form_kind: 'lead', requester: 'U1', created_at: '2026-09-04T23:45:00.000Z',
  document: { source: { kind: 'modal', requester: 'U1', permalink: null, received_at: '2026-09-04T23:45:00.000Z', raw: '{}' }, actions: [], needs_review: [] },
  report: null, card: null, prefill: {},
};

describe('createMemoryStore', () => {
  it('isDuplicate is false the first time and true afterwards', async () => {
    const store = createMemoryStore();
    expect(await store.isDuplicate('V123')).toBe(false);
    expect(await store.isDuplicate('V123')).toBe(true);
  });

  it('round-trips submissions', async () => {
    const store = createMemoryStore();
    expect(await store.getSubmission('sub-1')).toBeNull();
    await store.putSubmission(rec);
    expect(await store.getSubmission('sub-1')).toEqual(rec);
  });

  it('round-trips cache values', async () => {
    const store = createMemoryStore();
    await store.putCache('stages', ['Lead', 'Won'], 3600);
    expect(await store.getCache<string[]>('stages')).toEqual(['Lead', 'Won']);
    expect(await store.getCache('missing')).toBeNull();
  });
});
