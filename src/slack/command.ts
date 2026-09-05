import type { SlackApi } from './api';
import { loadFormContext, type ContextDeps } from './form-context';
import { buildChooserView, buildFormView, type ViewMetadata } from './views';
import { parseCommandText } from '../input/parser';
import { todayIso } from '../util/dates';

export interface CommandForm {
  command: string; text: string; user_id: string; trigger_id: string; channel_id: string; response_url: string;
}
export interface CommandDeps extends ContextDeps { slack: SlackApi; now?: () => Date }

export const NOT_ALLOWED_TEXT = 'This command is limited to the sales team.';

export function ephemeral(text: string): Response {
  return new Response(JSON.stringify({ response_type: 'ephemeral', text }), { status: 200, headers: { 'content-type': 'application/json' } });
}

export async function handleCommand(form: CommandForm, deps: CommandDeps, ctx: ExecutionContext): Promise<Response> {
  if (!deps.config.allowedUsers.has(form.user_id)) return ephemeral(NOT_ALLOWED_TEXT);

  const metadata: ViewMetadata = { channel_id: form.channel_id, requester: form.user_id, submission_id: null, response_url: form.response_url || null };
  const today = todayIso(deps.config.timezone, deps.now?.());
  const parsed = parseCommandText(form.text ?? '', today);

  const open = async () => {
    try {
      if (parsed.kind === 'chooser') {
        await deps.slack.viewsOpen(form.trigger_id, buildChooserView(metadata));
      } else {
        const formCtx = await loadFormContext(deps, metadata);
        await deps.slack.viewsOpen(form.trigger_id, buildFormView(parsed.kind, formCtx, parsed.prefill));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (form.response_url) await deps.slack.respond(form.response_url, `Could not open the form: ${msg}`).catch(() => {});
    }
  };
  ctx.waitUntil(open());
  return new Response('', { status: 200 });
}
