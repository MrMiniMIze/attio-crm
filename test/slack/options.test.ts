import { describe, it, expect } from 'vitest';
import { handleBlockSuggestion } from '../../src/slack/options.ts';
import { fakeAttio } from '../helpers/fake-attio.ts';

const hits = {
  coz: [
    { record_id: 'c-1', object: 'companies' as const, text: 'Cozeva', domains: ['cozeva.com'], emails: [] },
    { record_id: 'p-1', object: 'people' as const, text: 'Cozmo Kramer', domains: [], emails: ['k@x.com'] },
    { record_id: 'd-1', object: 'deals' as const, text: 'Cozeva', domains: [], emails: [] },
  ],
};

describe('handleBlockSuggestion', () => {
  it('company search returns matches plus a create-new option', async () => {
    const { client } = fakeAttio({ searchHits: hits });
    const { options } = await handleBlockSuggestion({ action_id: 'company', value: 'coz' }, client);
    expect(options).toEqual([
      { text: { type: 'plain_text', text: 'Cozeva · cozeva.com' }, value: 'id:c-1' },
      { text: { type: 'plain_text', text: 'Create new: "coz"' }, value: 'new:coz' },
    ]);
  });

  it('deal search returns deals only', async () => {
    const { client } = fakeAttio({ searchHits: hits });
    const { options } = await handleBlockSuggestion({ action_id: 'deal', value: 'coz' }, client);
    expect(options).toEqual([{ text: { type: 'plain_text', text: 'Cozeva' }, value: 'id:d-1' }]);
  });

  it('record search returns companies and people with type suffix', async () => {
    const { client } = fakeAttio({ searchHits: hits });
    const { options } = await handleBlockSuggestion({ action_id: 'record', value: 'coz' }, client);
    expect(options.map((o) => [o.text.text, o.value])).toEqual([
      ['Cozeva (company)', 'companies:c-1'],
      ['Cozmo Kramer (person)', 'people:p-1'],
    ]);
  });

  it('short queries return no options, and company keeps only create-new when Attio fails', async () => {
    const { client } = fakeAttio({ failOn: (m) => (m === 'search' ? new Error('boom') : null) });
    expect((await handleBlockSuggestion({ action_id: 'company', value: 'c' }, client)).options).toEqual([]);
    expect((await handleBlockSuggestion({ action_id: 'company', value: 'ensora' }, client)).options).toEqual([
      { text: { type: 'plain_text', text: 'Create new: "ensora"' }, value: 'new:ensora' },
    ]);
  });

  it('a slow search times out to the fallback', async () => {
    const { client } = fakeAttio();
    client.search = () => new Promise(() => {});
    const { options } = await handleBlockSuggestion({ action_id: 'deal', value: 'cozeva' }, client, 10);
    expect(options).toEqual([]);
  });
});
