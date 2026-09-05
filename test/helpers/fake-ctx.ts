export function fakeCtx() {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) { pending.push(p); },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { ctx, async flush() { await Promise.all(pending.splice(0)); } };
}
