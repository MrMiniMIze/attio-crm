import type { AttioRecord } from './client.ts';

export function firstValue(rec: AttioRecord, attr: string): any | null {
  const arr = rec.values[attr];
  return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
}

/** Text `name` on companies/deals, or personal-name `full_name` on people. */
export function recordName(rec: AttioRecord): string | null {
  const v = firstValue(rec, 'name');
  if (!v) return null;
  if (typeof v.value === 'string') return v.value;
  if (typeof v.full_name === 'string') return v.full_name;
  return null;
}

export function dealStage(rec: AttioRecord): string | null {
  const v = firstValue(rec, 'stage');
  return v?.status?.title ?? null;
}
