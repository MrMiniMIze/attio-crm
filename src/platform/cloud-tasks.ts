import type { CloudTasksClient } from '@google-cloud/tasks';
import type { Queue } from './queue';
import type { QueuedSubmission } from '../pipeline';

const ALREADY_EXISTS = 6;

export interface CloudTasksConfig {
  /** projects/P/locations/R/queues/crm-writes */
  parent: string;
  /** The absolute URL of this service's own /tasks/write route. */
  targetUrl: string;
  /** Service account the queue signs its callbacks as. */
  invoker: string;
}

/** Task ids accept letters, digits, hyphens and underscores only. */
const taskId = (key: string) => key.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 500);

export function createCloudTasksQueue(cfg: CloudTasksConfig, injected?: CloudTasksClient): Queue {
  let client: CloudTasksClient | undefined = injected;

  // Loaded on first enqueue rather than at boot. The client costs about
  // 140 ms to import, and the cold path that matters — /crm opening a modal
  // inside Slack's three seconds — never reaches it.
  async function tasks(): Promise<CloudTasksClient> {
    if (!client) {
      const { CloudTasksClient: Ctor } = await import('@google-cloud/tasks');
      client = new Ctor();
    }
    return client;
  }

  return {
    async enqueue(job, dedupeKey) {
      const c = await tasks();
      try {
        await c.createTask({
          parent: cfg.parent,
          task: {
            // Naming the task is the whole deduplication story: the queue
            // rejects a name it has already seen for about an hour, which
            // covers Slack's retry window.
            name: `${cfg.parent}/tasks/${taskId(dedupeKey)}`,
            httpRequest: {
              httpMethod: 'POST',
              url: cfg.targetUrl,
              headers: { 'content-type': 'application/json' },
              body: Buffer.from(JSON.stringify(job)).toString('base64'),
              oidcToken: { serviceAccountEmail: cfg.invoker, audience: cfg.targetUrl },
            },
          },
        });
      } catch (err) {
        if ((err as { code?: number }).code === ALREADY_EXISTS) return;
        throw err;
      }
    },
  };
}
