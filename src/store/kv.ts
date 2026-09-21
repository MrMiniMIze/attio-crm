import type { ActionDocument } from '../contract/action-document.ts';
import type { WriteReport } from '../contract/write-report.ts';
import type { FormKind, Prefill } from '../slack/types.ts';

export interface SubmissionRecord {
  submission_id: string;
  form_kind: FormKind;
  requester: string;
  created_at: string;
  document: ActionDocument;
  report: WriteReport | null;
  card: { channel: string; ts: string } | null;
  prefill: Prefill;
}

export interface Store {
  isDuplicate(eventId: string): Promise<boolean>;
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  putSubmission(rec: SubmissionRecord): Promise<void>;
  getCache<T>(key: string): Promise<T | null>;
  putCache<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

const DAY = 60 * 60 * 24;

export function createStore(kv: KVNamespace): Store {
  return {
    async isDuplicate(eventId) {
      const key = `evt:${eventId}`;
      const seen = await kv.get(key);
      if (seen !== null) return true;
      await kv.put(key, '1', { expirationTtl: DAY });
      return false;
    },
    async getSubmission(id) {
      return (await kv.get(`sub:${id}`, 'json')) as SubmissionRecord | null;
    },
    async putSubmission(rec) {
      await kv.put(`sub:${rec.submission_id}`, JSON.stringify(rec), { expirationTtl: 30 * DAY });
    },
    async getCache<T>(key: string) {
      return (await kv.get(`cache:${key}`, 'json')) as T | null;
    },
    async putCache(key, value, ttlSeconds) {
      await kv.put(`cache:${key}`, JSON.stringify(value), { expirationTtl: ttlSeconds });
    },
  };
}
