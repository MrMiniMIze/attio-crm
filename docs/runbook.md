# Runbook: /crm → Attio → Clay

## 1. Go-live checklist (company workspace)

1. **Cloudflare** (company or Maggie's account): `npx wrangler login`, then
   `npx wrangler kv namespace create KV` and paste the returned `id` into `wrangler.jsonc`.
2. **Attio access token** (Maggie, workspace admin): Settings → Developers → create token with
   `record_permission:read-write`, `object_configuration:read`, `note:read-write`,
   `task:read-write`, `user_management:read`. Deals object must be enabled.
3. **Secrets**: `npx wrangler secret put ATTIO_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`
   (the last two after step 5).
4. **Vars** in `wrangler.jsonc`: `SUMMARY_CHANNEL` = channel ID of `#crm-requests`
   (channel details → copy ID), `DEFAULT_OWNER_EMAIL` = Maggie's Attio login email,
   `ALLOWED_USERS` = Slack member IDs for Sagar and Maggie (profile → ⋯ → Copy member ID).
5. **Deploy**: `npm run deploy`; note the `*.workers.dev` URL.
6. **Slack app** (Maggie): api.slack.com/apps → Create New App → From a manifest → paste
   `slack-manifest.json` with `WORKER_HOST` replaced → Install to Workspace. Copy the Signing
   Secret and Bot User OAuth Token into step 3, then `npm run deploy` again.
7. Invite the bot to `#crm-requests`: `/invite @Attio CRM`.
8. Smoke test: one submission per form with `[TEST]` names, check Attio, delete the test records.
9. Send Sagar the one-pager (section 3).

## 2. Clay (free, no write-back)

1. Clay → Settings → Connections → Attio → authorize (Attio admin).
2. Three tables, each **Actions → Import → Attio** as the source: Deals, Companies, People.
3. On each source: **Schedule** → Daily, and turn on **Update existing rows**.
4. Never add "Create/Update/Upsert record in Attio" columns; those cost Clay credits.
5. If a table needs "has open deal", add a Lookup column against the Deals table on the
   Attio company record ID.

## 3. Sagar's one-pager

Type `/crm` anywhere in Slack (the DM with Maggie is fine). Pick what you want:

- **Add lead**: company (search or type a new domain), optional person, stage, owner, note, follow-up task.
- **Add companies to hunt**: paste several names or domains, one per line.
- **Update deal**: search the deal, change stage or value, add a person, add a note.
- **Add task** / **Add note**: search the company or person, type the text.

Shortcuts: `/crm lead Jane Doe @ cozeva.com`, `/crm hunt Ensora, acme.com`,
`/crm task Follow up with Cozeva due tomorrow`, `/crm note Met them at HLTH`.

Every submission posts a card in `#crm-requests`. Click **Edit** on the card to fix anything.

## 4. Troubleshooting

| Symptom | Check |
|---|---|
| `/crm` says "dispatch_failed" | Worker down or URL wrong: `curl https://WORKER_HOST/health` |
| Modal opens but pickers show nothing | Attio token scopes; `npx wrangler tail` for `AttioError` |
| Card says "some steps failed" | Click the failed line's detail; usually a stage title that no longer exists (stage cache refreshes hourly) |
| "This command is limited to the sales team." | Add the Slack member ID to `ALLOWED_USERS` and redeploy |
| Nothing posts to `#crm-requests` | Bot not in channel, or `SUMMARY_CHANNEL` is a name instead of an ID |
| Edit says the submission expired | Submissions are kept 30 days; add it again with `/crm` |

Logs: `npx wrangler tail attio-crm`. Cloudflare dashboard → Workers → attio-crm → Observability.
