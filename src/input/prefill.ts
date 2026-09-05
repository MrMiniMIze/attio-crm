import type { Prefill, StateValues } from '../slack/types';

export function prefillFromState(values: StateValues): Prefill {
  const out: Prefill = {};
  for (const [block, inner] of Object.entries(values)) {
    const v = inner[block];
    if (!v) continue;
    if (v.selected_option) { out[block] = { value: v.selected_option.value, label: v.selected_option.text.text }; continue; }
    if (v.selected_date) { out[block] = { value: v.selected_date }; continue; }
    if (typeof v.value === 'string' && v.value.trim()) out[block] = { value: v.value };
  }
  return out;
}
