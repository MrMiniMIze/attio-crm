/**
 * Slack delivers every interactive payload for an app to ONE Request URL, and
 * every select-menu lookup to ONE Options URL. A bot that already owns those
 * endpoints routes CRM traffic with this test and leaves everything else on
 * its existing path:
 *
 *   app.post('/slack/interact', verify, async (req, res) => {
 *     const payload = JSON.parse(new URLSearchParams(await raw(req)).get('payload'));
 *     return isCrmPayload(payload) ? crmRouter(payload) : existingHandler(payload);
 *   });
 *
 * Every identifier this feature owns is either a `crm_` callback_id on a view
 * or a `crm_`-prefixed action_id, so the test is a prefix match and cannot
 * collide with handlers that were here first.
 */
export function isCrmPayload(payload: unknown): boolean {
  const p = payload as {
    view?: { callback_id?: unknown };
    callback_id?: unknown;
    action_id?: unknown;
    actions?: { action_id?: unknown }[];
  } | null;
  if (!p || typeof p !== 'object') return false;

  return (
    // view_submission, view_closed, and block_suggestion or block_actions
    // raised from inside one of our modals.
    isCrm(p.view?.callback_id) ||
    // Shortcuts.
    isCrm(p.callback_id) ||
    // block_suggestion at the top level.
    isCrm(p.action_id) ||
    // block_actions on a message rather than a modal — the Edit button on the
    // summary card, which carries no view at all.
    (Array.isArray(p.actions) && p.actions.some((a) => isCrm(a?.action_id)))
  );
}

const isCrm = (value: unknown): boolean => typeof value === 'string' && value.startsWith('crm_');
