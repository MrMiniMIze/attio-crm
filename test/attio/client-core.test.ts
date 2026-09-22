import { describe, it, expect } from 'vitest';
import { createAttioClient, AttioError } from '../../src/attio/client.ts';
import { recordName, dealStage } from '../../src/attio/records.ts';
import { scriptedFetch } from '../helpers/fetch-mock.ts';

const rawCompany = {
  id: { workspace_id: 'w', object_id: 'o', record_id: 'c-1' },
  created_at: '2026-09-04T20:00:00.000Z',
  web_url: 'https://app.attio.com/acme/company/c-1',
  values: { name: [{ value: 'Cozeva', attribute_type: 'text' }], domains: [{ domain: 'cozeva.com' }] },
};

describe('createAttioClient core', () => {
  it('sends bearer auth and JSON, and normalises the record', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 200, json: { data: rawCompany } }]);
    const attio = createAttioClient({ token: 'tok', fetchFn });
    const rec = await attio.getRecord('companies', 'c-1');
    expect(calls[0]?.url).toBe('https://api.attio.com/v2/objects/companies/records/c-1');
    expect(calls[0]?.headers['authorization']).toBe('Bearer tok');
    expect(rec).toEqual({
      record_id: 'c-1', object: 'companies', web_url: rawCompany.web_url,
      created_at: rawCompany.created_at, values: rawCompany.values,
    });
    expect(recordName(rec)).toBe('Cozeva');
  });

  it('retries on 429 using Retry-After and then succeeds', async () => {
    const { fetchFn, calls } = scriptedFetch([
      { status: 429, text: 'slow down', headers: { 'retry-after': '2' } },
      { status: 200, json: { data: rawCompany } },
    ]);
    const sleeps: number[] = [];
    const attio = createAttioClient({ token: 'tok', fetchFn, sleep: async (ms) => { sleeps.push(ms); } });
    await attio.getRecord('companies', 'c-1');
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it('throws AttioError with status and body after 3 failed attempts', async () => {
    const { fetchFn } = scriptedFetch([
      { status: 429, text: 'a' }, { status: 429, text: 'b' }, { status: 429, text: 'c' },
    ]);
    const attio = createAttioClient({ token: 'tok', fetchFn, sleep: async () => {} });
    await expect(attio.getRecord('companies', 'c-1')).rejects.toBeInstanceOf(AttioError);
  });

  it('throws AttioError immediately on 4xx other than 429', async () => {
    const { fetchFn, calls } = scriptedFetch([{ status: 404, text: '{"message":"nope"}' }]);
    const attio = createAttioClient({ token: 'tok', fetchFn, sleep: async () => {} });
    const err = await attio.getRecord('companies', 'missing').catch((e) => e);
    expect(err).toBeInstanceOf(AttioError);
    expect((err as AttioError).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('dealStage reads the status title', () => {
    const deal = { record_id: 'd', object: 'deals' as const, web_url: '', created_at: '',
      values: { stage: [{ status: { title: 'In Progress' } }] } };
    expect(dealStage(deal)).toBe('In Progress');
  });
});
