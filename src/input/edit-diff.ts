import type { Action, ActionDocument } from '../contract/action-document';

/** Deterministic JSON with keys sorted at every nesting level. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Identity of an action for edit comparison: everything except confidence. */
function fingerprint(a: Action): string {
  const { confidence: _ignored, ...rest } = a;
  return stableStringify(rest);
}

export function dropRepeatedTasksAndNotes(prev: ActionDocument, next: ActionDocument): ActionDocument {
  const seen = new Set(prev.actions.filter((a) => a.type === 'create_task' || a.type === 'add_note').map(fingerprint));
  const actions = next.actions.filter((a) => {
    if (a.type !== 'create_task' && a.type !== 'add_note') return true;
    return !seen.has(fingerprint(a));
  });
  return { ...next, actions };
}
