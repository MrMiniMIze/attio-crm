export type AttioObject = 'companies' | 'people' | 'deals';

export type WriteOutcome = 'created' | 'updated' | 'existing' | 'skipped' | 'failed';

export interface WriteItem {
  kind: 'company' | 'person' | 'deal' | 'task' | 'note';
  label: string;
  outcome: WriteOutcome;
  url: string | null;
  detail: string | null;
  record_id: string | null;
  object: AttioObject | null;
}

export interface WriteReport {
  items: WriteItem[];
  touched: { object: AttioObject; record_id: string }[];
  ok: boolean;
}
