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
  /** True when this event has been seen before. Must be atomic: Slack
   *  retries a delivery it thinks failed, and two deliveries can race. */
  isDuplicate(eventId: string): Promise<boolean>;
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  putSubmission(rec: SubmissionRecord): Promise<void>;
  getCache<T>(key: string): Promise<T | null>;
  putCache<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}

const DAY = 60 * 60 * 24;
export const DEDUPE_TTL = DAY;
export const SUBMISSION_TTL = 30 * DAY;

/** In-memory store, used by the test suite and by `npm run dev`. Holds
 *  nothing across a restart, which is fine for both. */
export function createMemoryStore(): Store {
  const seen = new Set<string>();
  const subs = new Map<string, string>();
  const cache = new Map<string, { value: string; expires: number }>();

  return {
    async isDuplicate(eventId) {
      if (seen.has(eventId)) return true;
      seen.add(eventId);
      return false;
    },
    async getSubmission(id) {
      const raw = subs.get(id);
      return raw ? (JSON.parse(raw) as SubmissionRecord) : null;
    },
    async putSubmission(rec) {
      subs.set(rec.submission_id, JSON.stringify(rec));
    },
    async getCache<T>(key: string) {
      const hit = cache.get(key);
      if (!hit) return null;
      if (hit.expires < Date.now()) {
        cache.delete(key);
        return null;
      }
      return JSON.parse(hit.value) as T;
    },
    async putCache(key, value, ttlSeconds) {
      cache.set(key, { value: JSON.stringify(value), expires: Date.now() + ttlSeconds * 1000 });
    },
  };
}
