export type FormKind = 'lead' | 'hunt' | 'deal' | 'task' | 'note';

export interface PlainText { type: 'plain_text'; text: string; emoji?: boolean }
export interface MrkdwnText { type: 'mrkdwn'; text: string }
export type Block = Record<string, unknown> & { type: string; block_id?: string };

export interface SlackOption { text: PlainText; value: string }

export interface View {
  type: 'modal';
  callback_id: string;
  title: PlainText;
  submit?: PlainText;
  close?: PlainText;
  private_metadata?: string;
  blocks: Block[];
}

export type Prefill = Record<string, { value: string; label?: string }>;

/** Shape of view.state.values[block_id][action_id] as Slack sends it. */
export interface StateValue {
  type: string;
  value?: string | null;
  selected_option?: { text: PlainText; value: string } | null;
  selected_date?: string | null;
}
export type StateValues = Record<string, Record<string, StateValue>>;
