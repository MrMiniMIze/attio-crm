import type { AttioClient } from './attio/client.ts';
import { executeDocument } from './attio/writer.ts';
import type { SlackApi } from './slack/api.ts';
import type { Store, SubmissionRecord } from './store/kv.ts';
import type { Config } from './env.ts';
import { fromModalSubmission, type SubmittedView } from './input/from-modal.ts';
import { dropRepeatedTasksAndNotes } from './input/edit-diff.ts';
import { prefillFromState } from './input/prefill.ts';
import { describeDocument } from './contract/describe.ts';
import { buildSummaryBlocks, formKindFromCallback, summaryText, type ViewMetadata } from './slack/views.ts';
import { loadMembers } from './slack/form-context.ts';
import { todayIso } from './util/dates.ts';

export interface PipelineDeps {
  attio: AttioClient; slack: SlackApi; store: Store; config: Config;
  now?: () => Date; newId?: () => string;
}

export interface SubmissionInput {
  view: SubmittedView & { id: string };
  user: { id: string; name: string };
  metadata: ViewMetadata;
}

export async function processSubmission(input: SubmissionInput, deps: PipelineDeps): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { view, user, metadata } = input;
  let card: { channel: string; ts: string } | null = null;
  let wrote = false;

  try {
    if (await deps.store.isDuplicate(`view:${view.id}`)) return;

    const kind = formKindFromCallback(view.callback_id);
    if (!kind) throw new Error(`unknown form ${view.callback_id}`);
    const members = await loadMembers(deps);
    const receivedAt = now().toISOString();
    const submitted = fromModalSubmission(view, { requester: user.id, received_at: receivedAt, permalink: null }, { members, defaultOwnerEmail: deps.config.defaultOwnerEmail });

    const prev = metadata.submission_id ? await deps.store.getSubmission(metadata.submission_id) : null;
    let doc = prev ? dropRepeatedTasksAndNotes(prev.document, submitted) : submitted;
    const submissionId = prev?.submission_id ?? newId();

    card = prev?.card ?? await deps.slack.chatPostMessage(deps.config.summaryChannel, `${user.name} via /crm: working on it…`, [
      { type: 'section', text: { type: 'mrkdwn', text: `*${user.name} via /crm* · working on it…` } },
    ]);
    const permalink = await deps.slack.chatGetPermalink(card.channel, card.ts);
    doc = { ...doc, source: { ...doc.source, permalink } };

    const day = todayIso(deps.config.timezone, now());
    const report = await executeDocument(doc, deps.attio, {
      defaultOwnerEmail: deps.config.defaultOwnerEmail,
      timezone: deps.config.timezone,
      members,
      sourceNote: {
        title: `From ${user.name} via Slack ${day}`,
        markdown: `${describeDocument(doc)}${permalink ? `\n\n[Slack](${permalink})` : ''}`,
      },
      now,
    });

    await deps.slack.chatUpdate(card.channel, card.ts, summaryText(report), buildSummaryBlocks({ requesterName: user.name, whenIso: receivedAt, report, submissionId }));
    wrote = true;

    const record: SubmissionRecord = {
      submission_id: submissionId, form_kind: kind, requester: user.id, created_at: prev?.created_at ?? receivedAt,
      document: { ...submitted, source: doc.source }, report, card, prefill: prefillFromState(view.state.values),
    };
    await deps.store.putSubmission(record);

    if (metadata.response_url) {
      const done = report.items.filter((i) => i.outcome !== 'failed' && i.outcome !== 'skipped').length;
      const failed = report.items.filter((i) => i.outcome === 'failed').length;
      const skipped = report.items.filter((i) => i.outcome === 'skipped').length;
      const tail = [failed ? `${failed} failed` : null, skipped ? `${skipped} skipped` : null].filter(Boolean).join(', ');
      await deps.slack.respond(metadata.response_url, `Added to Attio: ${done} steps done${tail ? `, ${tail}` : ''}. Details in <#${deps.config.summaryChannel}>.`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('processSubmission failed', msg);
    if (wrote) {
      const text = `Attio was updated, but a follow-up step failed: ${msg}. The summary card in <#${deps.config.summaryChannel}> is accurate.`;
      if (metadata.response_url) await deps.slack.respond(metadata.response_url, text).catch(() => {});
      return;
    }
    const text = `Something went wrong: ${msg}. Nothing may have been written; please check Attio.`;
    if (card) await deps.slack.chatUpdate(card.channel, card.ts, text, [{ type: 'section', text: { type: 'mrkdwn', text: `✖ ${text}` } }]).catch(() => {});
    if (metadata.response_url) await deps.slack.respond(metadata.response_url, text).catch(() => {});
  }
}
