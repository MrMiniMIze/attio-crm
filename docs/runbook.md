# Runbook: /crm to Attio to Clay

## 1. Launch checklist (company workspace)

1. **Cloudflare** (company or Maggie's account): `npx wrangler login`, then
   `npx wrangler kv namespace create KV` and paste the returned `id` into `wrangler.jsonc`.
2. **Attio access token** (Maggie, workspace admin): Settings > Developers > create token with
   `record_permission:read-write`, `object_configuration:read`, `note:read-write`,
   `task:read-write`, `user_management:read`. Deals object must be enabled.
3. **Secrets**: `npx wrangler secret put ATTIO_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`
   (the last two after step 5).
4. **Vars** in `wrangler.jsonc`: `SUMMARY_CHANNEL` = channel ID of `#crm-requests`
   (channel details > copy ID), `DEFAULT_OWNER_EMAIL` = Maggie's Attio login email,
   `ALLOWED_USERS` = Slack member IDs for Sagar and Maggie (profile > More > Copy member ID).
5. **Deploy**: `npm run deploy`; note the `*.workers.dev` URL.
6. **Slack app** (Maggie): api.slack.com/apps > Create New App > From a manifest > paste
   `slack-manifest.json` with `WORKER_HOST` replaced > Install to Workspace. Copy the Signing
   Secret and Bot User OAuth Token into step 3, then `npm run deploy` again.
7. Invite the bot to `#crm-requests`: `/invite @Attio CRM`.
8. Smoke test: one submission per form with `[TEST]` names, check Attio, delete the test records.
   Section 5 has the full matrix; run it in a sandbox first.
9. Send Sagar the one page guide (section 3).

## 2. Clay (free, nothing written back)

1. Clay > Settings > Connections > Attio > authorize (Attio admin).
2. Three tables, each **Actions > Import > Attio** as the source: Deals, Companies, People.
3. On each source: **Schedule** > Daily, and turn on **Update existing rows**.
4. Never add "Create/Update/Upsert record in Attio" columns; those cost Clay credits.
5. If a table needs "has open deal", add a Lookup column against the Deals table on the
   Attio company record ID.

## 3. Sagar's one page guide

Type `/crm` anywhere in Slack (the DM with Maggie is fine). Pick what you want:

- **Add lead**: company (search or type a new domain), optional person, stage, owner, note, follow up task.
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

Logs: `npx wrangler tail attio-crm`. Cloudflare dashboard > Workers > attio-crm > Observability.

## 5. Sandbox smoke test (before the company workspace)

Run this on your own free Slack and free Attio workspaces first. Nothing here touches
company data.

1. Create a free Slack workspace with a channel named `#crm-requests`. Create a free Attio
   workspace, enable the Deals object (Settings > Objects > Deals > Enable) and add two or
   three companies and one deal by hand.
2. `npx wrangler login`, then `npx wrangler kv namespace create KV` and paste the id into
   `wrangler.jsonc`. Set the vars to the sandbox channel ID, your own Slack member ID and
   your Attio login email. `npx wrangler secret put ATTIO_TOKEN`, then `npm run deploy` and
   note the `workers.dev` URL.
3. Create the Slack app from `slack-manifest.json` with `WORKER_HOST` replaced, install it,
   invite the bot to the channel, then `npx wrangler secret put SLACK_SIGNING_SECRET` and
   `npx wrangler secret put SLACK_BOT_TOKEN`, and `npm run deploy` again.
   `curl https://WORKER_HOST/health` should print `ok`.
4. Work through the matrix with `npx wrangler tail` open in another terminal, checking
   Slack and Attio after each row.

| # | Action | Expected in Slack | Expected in Attio |
|---|---|---|---|
| 1 | `/crm` > Add lead > type `[TEST] Zeta` > Create new; person `[TEST] Ann Lee`, email `ann@zeta.test`; task "call", due tomorrow | Card: company created, person created, deal created (Lead), task created, source note on 3 records | Company, person linked to it, deal owned by you, task due 17:00 tomorrow, notes on all three |
| 2 | The same lead again | Card: company existing, person existing, deal updated | No duplicate deal |
| 3 | Add lead against a `[TEST]` company whose deal is already In Progress | Card: deal updated, "kept stage In Progress" | Stage unchanged |
| 4 | `/crm hunt` with two lines: `[TEST] Alpha` and `beta.test` | Two companies, two deals | Both created |
| 5 | `/crm` > Update deal > pick `[TEST] Zeta` > stage In Progress, value 1000 | Card: deal updated, "stage In Progress, value 1000" | Stage and value changed |
| 6 | `/crm task Ping Ann due tomorrow` > pick `[TEST] Ann Lee (person)` | Task created | Task linked to Ann |
| 7 | `/crm note hello` > pick `[TEST] Zeta (company)` | Note created | Note on Zeta |
| 8 | Click Edit on card 1 and change the person name to `[TEST] Ann M. Lee` | Same card updated, no new task | Person renamed, task count unchanged |
| 9 | Type `/crm` as a second Slack user who is not in `ALLOWED_USERS` | "This command is limited to the sales team." | Nothing |
| 10 | `npx wrangler tail` during rows 1 to 9 | No uncaught errors | |

5. Confirm three things the unit tests cannot: the modal opens within Slack's three second
   window on a cold cache; the source notes carry a Slack link (which means `users.info` and
   `chat.getPermalink` accepted the calls); and the card posts to the channel. Write the
   results at the bottom of this file.
6. Delete every `[TEST]` record in the sandbox Attio.
