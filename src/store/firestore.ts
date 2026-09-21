import { Firestore, Timestamp } from '@google-cloud/firestore';
import { DEDUPE_TTL, SUBMISSION_TTL, type Store, type SubmissionRecord } from './store';

const ALREADY_EXISTS = 6;

/** Firestore document ids may not contain '/'. */
const docId = (key: string) => key.replace(/\//g, '__').slice(0, 1500);

const expiresAt = (ttlSeconds: number) => Timestamp.fromMillis(Date.now() + ttlSeconds * 1000);

/** True when the document is past its expiry. Firestore's TTL is a
 *  background sweep that runs within 24 hours, not an instant delete, so an
 *  expired document stays readable until it is collected. Every read has to
 *  enforce the deadline itself or a one-hour cache serves stale values all
 *  day. */
const expired = (value: unknown) =>
  value instanceof Timestamp && value.toMillis() < Date.now();

export function createFirestoreStore(db: Firestore): Store {
  const dedupe = db.collection('dedupe');
  const submissions = db.collection('submissions');
  const cache = db.collection('cache');

  return {
    async isDuplicate(eventId) {
      // create() fails when the document exists, which makes this a single
      // atomic check-and-set rather than a read followed by a write.
      try {
        await dedupe.doc(docId(eventId)).create({ expiresAt: expiresAt(DEDUPE_TTL) });
        return false;
      } catch (err) {
        if ((err as { code?: number }).code === ALREADY_EXISTS) return true;
        throw err;
      }
    },

    async getSubmission(id) {
      const snap = await submissions.doc(docId(id)).get();
      if (!snap.exists) return null;
      const body = snap.data()!;
      if (expired(body.expiresAt)) return null;
      return body.record as SubmissionRecord;
    },

    async putSubmission(rec) {
      await submissions.doc(docId(rec.submission_id)).set({
        record: rec,
        expiresAt: expiresAt(SUBMISSION_TTL),
      });
    },

    async getCache<T>(key: string) {
      const snap = await cache.doc(docId(key)).get();
      if (!snap.exists) return null;
      const body = snap.data()!;
      if (expired(body.expiresAt)) return null;
      return body.value as T;
    },

    async putCache(key, value, ttlSeconds) {
      await cache.doc(docId(key)).set({ value, expiresAt: expiresAt(ttlSeconds) });
    },
  };
}

export { Firestore };
