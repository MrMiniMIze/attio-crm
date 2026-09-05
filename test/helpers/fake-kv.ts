export function fakeKv() {
  const data = new Map<string, string>();
  const kv = {
    data,
    async get(key: string, type?: string) {
      const v = data.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) { data.set(key, value); },
    async delete(key: string) { data.delete(key); },
    async list() { return { keys: [...data.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null }; },
    async getWithMetadata() { throw new Error('not used'); },
  };
  return kv as unknown as KVNamespace & { data: Map<string, string> };
}
