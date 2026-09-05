import type { AttioClient, AttioSearchHit } from '../attio/client';
import type { SlackOption } from './types';
import { truncate } from './views';

export interface BlockSuggestion { action_id: string; value: string }

const MIN_QUERY = 2;

const option = (text: string, value: string): SlackOption => ({ text: { type: 'plain_text', text: truncate(text, 75) }, value: truncate(value, 150) });

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(fallback); });
  });
}

export async function handleBlockSuggestion(payload: BlockSuggestion, attio: AttioClient, timeoutMs = 2500): Promise<{ options: SlackOption[] }> {
  const q = (payload.value ?? '').trim();
  if (q.length < MIN_QUERY) return { options: [] };

  const search = (objects: ('companies' | 'people' | 'deals')[]) =>
    withTimeout<AttioSearchHit[]>(attio.search(objects, q, 20), timeoutMs, []);

  switch (payload.action_id) {
    case 'company': {
      const hits = await search(['companies']);
      const options = hits.map((h) => option(`${h.text} · ${h.domains[0] ?? 'no domain'}`, `id:${h.record_id}`));
      options.push(option(`Create new: "${q}"`, `new:${q.slice(0, 140)}`));
      return { options };
    }
    case 'deal': {
      const hits = await search(['deals']);
      return { options: hits.map((h) => option(h.text, `id:${h.record_id}`)) };
    }
    case 'record': {
      const hits = await search(['companies', 'people']);
      return { options: hits.map((h) => option(`${h.text} (${h.object === 'people' ? 'person' : 'company'})`, `${h.object}:${h.record_id}`)) };
    }
    default:
      return { options: [] };
  }
}
