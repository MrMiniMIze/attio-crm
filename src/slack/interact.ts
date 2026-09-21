import { handleBlockSuggestion } from './options.ts';
import { loadFormContext } from './form-context.ts';
import { buildFormView, decodeMetadata, type ViewMetadata } from './views.ts';
import { validateSubmission } from './validate.ts';
import { NOT_ALLOWED_TEXT } from './command.ts';
import { processSubmission, type PipelineDeps } from '../pipeline.ts';
import { todayIso } from '../util/dates.ts';
import type { FormKind, View } from './types.ts';

export type InteractionDeps = PipelineDeps;

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const empty = () => new Response('', { status: 200 });

function noticeView(text: string): View {
  return {
    type: 'modal', callback_id: 'crm_notice', title: { type: 'plain_text', text: 'Attio' }, close: { type: 'plain_text', text: 'Close' },
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
  };
}

const KINDS: FormKind[] = ['lead', 'hunt', 'deal', 'task', 'note'];

export async function handleInteraction(payload: any, deps: InteractionDeps, ctx: ExecutionContext): Promise<Response> {
  switch (payload?.type) {
    case 'block_suggestion':
      return json(await handleBlockSuggestion({ action_id: payload.action_id, value: payload.value ?? '' }, deps.attio));

    case 'block_actions': {
      const action = payload.actions?.[0];
      const actionId: string = action?.action_id ?? '';
      const userId: string = payload.user?.id ?? '';

      if (actionId.startsWith('choose_')) {
        const kind = actionId.slice('choose_'.length) as FormKind;
        if (!KINDS.includes(kind) || !payload.view?.id) return empty();
        const metadata = decodeMetadata(payload.view.private_metadata ?? '');
        ctx.waitUntil((async () => {
          const formCtx = await loadFormContext(deps, metadata);
          await deps.slack.viewsUpdate(payload.view.id, buildFormView(kind, formCtx));
        })().catch((err) => console.error('choose failed', err)));
        return empty();
      }

      if (actionId === 'edit_submission') {
        const responseUrl: string | null = payload.response_url ?? null;
        ctx.waitUntil((async () => {
          if (!deps.config.allowedUsers.has(userId)) {
            if (responseUrl) await deps.slack.respond(responseUrl, NOT_ALLOWED_TEXT);
            return;
          }
          const sub = await deps.store.getSubmission(String(action.value ?? ''));
          if (!sub) {
            if (responseUrl) await deps.slack.respond(responseUrl, 'This submission has expired (older than 30 days). Use /crm to add it again.');
            return;
          }
          const metadata: ViewMetadata = { channel_id: payload.channel?.id ?? '', requester: userId, submission_id: sub.submission_id, response_url: responseUrl };
          const formCtx = await loadFormContext(deps, metadata);
          await deps.slack.viewsOpen(payload.trigger_id, buildFormView(sub.form_kind, formCtx, sub.prefill));
        })().catch(async (err) => {
          console.error('edit failed', err);
          const msg = err instanceof Error ? err.message : String(err);
          if (responseUrl) await deps.slack.respond(responseUrl, `Could not open the form: ${msg}`).catch(() => {});
        }));
        return empty();
      }
      return empty();
    }

    case 'view_submission': {
      const view = payload.view ?? {};
      const userId: string = payload.user?.id ?? '';
      if (!deps.config.allowedUsers.has(userId)) return json({ response_action: 'update', view: noticeView(NOT_ALLOWED_TEXT) });

      const metadata = decodeMetadata(view.private_metadata ?? '');
      const today = todayIso(deps.config.timezone, deps.now?.());
      const errors = validateSubmission(view.callback_id, view.state?.values ?? {}, today);
      if (errors._form) return json({ response_action: 'update', view: noticeView(errors._form) });
      if (Object.keys(errors).length > 0) return json({ response_action: 'errors', errors });

      ctx.waitUntil((async () => {
        const info = await deps.slack.usersInfo(userId).catch(() => null);
        const name = info?.name ?? payload.user?.real_name ?? payload.user?.name ?? userId;
        await processSubmission({
          view: { id: view.id, callback_id: view.callback_id, private_metadata: view.private_metadata ?? '', state: { values: view.state?.values ?? {} } },
          user: { id: userId, name },
          metadata,
        }, deps);
      })().catch((err) => console.error('submission failed', err)));
      return empty();
    }

    default:
      return empty();
  }
}
