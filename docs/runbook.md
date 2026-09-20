# Runbook: /crm to Attio to Clay

## 1. Launch checklist (company workspace)

1. **Google Cloud** (company or Maggie's project): `gcloud auth login`, set the project, and
   enable the APIs — see "Deploying" in the README for the exact command. Billing must be
   linked even though everything stays inside the free tier.
2. **Attio access token** (Maggie, workspace admin): Settings > Developers > create token with
   `record_permission:read-write`, `object_configuration:read`, `note:read-write`,
   `task:read-write`, `user_management:read`. Deals object must be enabled.
3. **Secrets** in Secret Manager: `ATTIO_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`
   (the last two after step 5). Load them with
   `printf %s "$VALUE" | gcloud secrets versions add NAME --data-file=-` — `echo` appends a
   newline, which breaks signature checks in a way that looks like a code bug.
4. **Environment** on the service: `SUMMARY_CHANNEL` = channel ID of `#crm-requests`
   (channel details > copy ID), `DEFAULT_OWNER_EMAIL` = Maggie's Attio login email,
   `ALLOWED_USERS` = Slack member IDs for Sagar and Maggie (profile > More > Copy member ID).
5. **Deploy**: the two-pass `gcloud run deploy` in the README; note the `*.run.app` URL.
   Then enable the three Firestore TTL policies and create the Cloud Scheduler warm ping.
6. **Slack app** (Maggie): api.slack.com/apps > Create New App > From a manifest > paste
   `slack-manifest.json` with `CLOUD_RUN_HOST` replaced > Install to Workspace. Copy the
   Signing Secret and Bot User OAuth Token into step 3, then redeploy.
   *If you are adding this to a Slack app that already exists, do not create a new one:* set
   the three URLs by hand and route payloads with `isCrmPayload` (see the README).
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
| `/crm` says "dispatch_failed" | Service down or URL wrong: `curl https://CLOUD_RUN_HOST/health` |
| Modal opens but pickers show nothing | Attio token scopes; logs for `AttioError`. If this is a shared Slack app, also check that the Select Menus Options URL is set |
| First `/crm` of the day times out, later ones are fine | Cold start. Confirm the Cloud Scheduler warm ping exists and is enabled: `gcloud scheduler jobs list --location=REGION` |
| Card says "some steps failed" | Click the failed line's detail; usually a stage title that no longer exists (stage cache refreshes hourly) |
| Cards stop appearing but Slack acknowledges | The queue is backed up or the task route is rejecting: `gcloud tasks queues describe crm-writes --location=REGION` |
| "This command is limited to the sales team." | Add the Slack member ID to `ALLOWED_USERS` and redeploy |
| Nothing posts to `#crm-requests` | Bot not in channel, or `SUMMARY_CHANNEL` is a name instead of an ID |
| Edit says the submission expired | Submissions are kept 30 days; add it again with `/crm` |
| Stale stages long after an edit in Attio | The read-side expiry check in `store/firestore.ts` was removed. Firestore's TTL sweep is not instant |

Logs: `gcloud run services logs tail attio-crm --region=REGION`, or Cloud Console >
Cloud Run > attio-crm > Logs. Queue depth: `gcloud tasks queues describe crm-writes
--location=REGION`.

## 5. Sandbox smoke test (before the company workspace)

Run this on your own free Slack and free Attio workspaces first. Nothing here touches
company data.

1. Create a free Slack workspace with a channel named `#crm-requests`. Create a free Attio
   workspace, enable the Deals object (Settings > Objects > Deals > Enable) and add two or
   three companies and one deal by hand.
2. Easiest path: skip Google Cloud entirely for the first pass. Copy `.env.example` to
   `.env`, fill in the sandbox values, run `npm run dev`, and expose it with
   `cloudflared tunnel --url http://localhost:8080` or `ngrok http 8080`. With no GCP
   settings present the server keeps state in memory and runs Attio writes inline, which
   exercises every row below except the queue.
3. Create the Slack app from `slack-manifest.json` with `CLOUD_RUN_HOST` replaced by the
   tunnel host, install it, invite the bot to the channel, and put the Signing Secret and Bot
   Token in `.env`. `curl https://TUNNEL_HOST/health` should print `ok`.
4. Work through the matrix with the dev server's output visible, checking Slack and Attio
   after each row. Then repeat rows 1, 2 and 8 against a real Cloud Run deployment, which is
   what actually exercises Cloud Tasks and Firestore.

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
| 10 | Watch the logs during rows 1 to 9 | No uncaught errors | |

5. Confirm five things the unit tests cannot, all of them against the real Cloud Run
   deployment rather than the dev server:
   - the modal opens within Slack's three second window on a **cold start** — pause the
     scheduler job, wait twenty minutes, then type `/crm`. Run it twice; the second is faster
     because the image is cached;
   - the source notes carry a Slack link, which means `users.info` and `chat.getPermalink`
     accepted the calls;
   - the card posts to the channel;
   - a failing write retries: point `ATTIO_TOKEN` at a bad value, submit one lead, and watch
     the queue back off and give up at five attempts;
   - `curl -X POST https://CLOUD_RUN_HOST/tasks/write -d '{}'` returns **401** and writes
     nothing.
   Write the results at the bottom of this file.
6. Delete every `[TEST]` record in the sandbox Attio.
