import { describe, it, expect } from 'vitest';
import { loadFormContext, loadStages } from '../../src/slack/form-context.ts';
import { fakeAttio } from '../helpers/fake-attio.ts';
import { fakeKv } from '../helpers/fake-kv.ts';
import { createStore } from '../../src/store/kv.ts';

const config = { allowedUsers: new Set(['U1']), summaryChannel: 'C1', defaultOwnerEmail: 'maggie@example.com', timezone: 'America/Los_Angeles' };
const meta = { channel_id: 'D1', requester: 'U1', submission_id: null, response_url: null };

describe('form context', () => {
  it('loads stages and members from Attio and caches them', async () => {
    const { client, calls } = fakeAttio({
      stages: [{ status_id: 's1', title: 'Lead', is_archived: false }, { status_id: 's2', title: 'Old', is_archived: true }],
      members: [{ member_id: 'm-1', email: 'maggie@example.com', first_name: 'Maggie', last_name: 'Q' }],
    });
    const store = createStore(fakeKv());
    const deps = { attio: client, store, config };
    const ctx = await loadFormContext(deps, meta);
    expect(ctx.stages).toEqual(['Lead']);
    expect(ctx.members).toEqual([{ email: 'maggie@example.com', name: 'Maggie Q' }]);
    expect(ctx.defaultOwnerEmail).toBe('maggie@example.com');
    expect(ctx.metadata).toEqual(meta);
    await loadStages(deps);
    expect(calls.filter((c) => c.method === 'listStageOptions')).toHaveLength(1);
  });
});
