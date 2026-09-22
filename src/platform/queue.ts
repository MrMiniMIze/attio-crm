import type { QueuedSubmission } from '../pipeline.ts';

/**
 * Hands a submission off to be written after the response has gone back to
 * Slack. Cloud Run stops the container once a response is sent, so the Attio
 * writes cannot simply continue behind the reply the way they did under a
 * Worker's `ctx.waitUntil()` — they have to become a second request.
 */
export interface Queue {
  /** `dedupeKey` must be stable across Slack's own retries of the same
   *  interaction; `view.id` is. */
  enqueue(job: QueuedSubmission, dedupeKey: string): Promise<void>;
}

/** Runs the write inline, before responding. Used by the test suite and by
 *  `npm run dev`, where there is no queue to deliver a second request. */
export function createInlineQueue(run: (job: QueuedSubmission) => Promise<void>): Queue {
  return {
    async enqueue(job) {
      await run(job);
    },
  };
}
