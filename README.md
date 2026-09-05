# attio-crm

A Slack `/crm` slash command that writes to the [Attio](https://attio.com) CRM, hosted on a
Cloudflare Worker. Built so a CEO can add leads, companies, deals, tasks and notes from
Slack in under thirty seconds, with nobody retyping anything.

**Zero recurring cost by design:** a custom Slack app on the free plan, the free Attio REST
API (no workflow credits), the Cloudflare Workers free tier, and Clay's free scheduled
import. The only paid component is optional (section "Extending" below).

- Design document: [`docs/design.md`](docs/design.md)
- Operations, go-live checklist and troubleshooting: [`docs/runbook.md`](docs/runbook.md)

## What it does

| Form (`/crm …`) | Result in Attio |
|---|---|
| **Add lead** | Company (existing or new), optional person, a deal at the chosen stage, optional follow-up task and note |
| **Add companies to hunt** | One company and one deal per line pasted (name or domain) |
| **Update deal** | Stage and value changes, add a person, add a note, on a deal picked from live search |
| **Add task** | A task linked to a company or person, with due date and assignee |
| **Add note** | A note on a company or person |

Every form's record pickers search Attio live as the user types, so "which Cozeva?" is
settled at input time. Each submission posts a summary card to a Slack channel with links
to the records and an **Edit** button that reopens the same form prefilled. Every record
touched gets a source note recording who asked, when, and a link back to Slack.

Shortcuts skip the chooser: `/crm lead Jane Doe @ cozeva.com`, `/crm hunt Ensora, acme.com`,
`/crm task Follow up with Cozeva due tomorrow`, `/crm note Met them at HLTH`.

## How it works

```
Slack /crm  ──►  Cloudflare Worker  ──►  Attio REST API
                  ├─ verifies the Slack signature on every request
                  ├─ allowlists who may write
                  ├─ turns a modal submission into an ActionDocument
                  ├─ writes companies → people → deals → tasks → notes
                  ├─ posts the summary card, stores the submission in Workers KV
                  └─ answers Slack within 3 seconds; the writes run in the background
```

Write rules worth knowing:

- Companies are matched by domain, people by email; a name-only entry is searched first
  and created only if nothing matches. Ambiguous matches are skipped and reported, never
  guessed.
- A company with one open deal gets that deal updated rather than a second deal created.
  "Add" forms never change an existing deal's stage; only **Update deal** does.
- Editing a submission updates the records it created and never re-creates tasks or notes.
- Any single failing write is reported on the card; the rest still run.

## Requirements

- Node.js 24 and npm
- A Cloudflare account (free plan is enough)
- A Slack workspace where you can install a custom app (free plan is enough)
- An Attio workspace with the Deals object enabled and an access token with
  `record_permission:read-write`, `object_configuration:read`, `note:read-write`,
  `task:read-write`, `user_management:read`

## Development

```bash
npm install
cp .dev.vars.example .dev.vars    # fill in the three secrets
npm test                          # vitest, 121 tests, no network
npm run typecheck                 # tsc --noEmit
npm run dev                       # wrangler dev on http://localhost:8787
```

Slack has to reach the Worker over the public internet, so interactive testing uses a
deployed dev Worker (`npm run deploy`) rather than localhost. The full sandbox and go-live
procedure, including the Slack app manifest, is in [`docs/runbook.md`](docs/runbook.md).

## Configuration

Secrets, set with `npx wrangler secret put <NAME>` (locally: `.dev.vars`):

| Name | Purpose |
|---|---|
| `SLACK_SIGNING_SECRET` | Verifies every request really came from Slack |
| `SLACK_BOT_TOKEN` | Opens modals and posts the summary card |
| `ATTIO_TOKEN` | Attio access token with the scopes listed above |

Variables, set in `wrangler.jsonc`:

| Name | Purpose |
|---|---|
| `ALLOWED_USERS` | Comma-separated Slack member IDs allowed to write |
| `SUMMARY_CHANNEL` | Channel ID that receives the summary cards |
| `DEFAULT_OWNER_EMAIL` | Attio login email of the default deal owner and task assignee |
| `TIMEZONE` | IANA zone for dates and 17:00 task deadlines (default `America/Los_Angeles`) |

The Worker also needs one KV namespace bound as `KV` (submissions kept 30 days, retry
dedupe keys 1 day, Attio stage and member caches 1 hour).

## Repository layout

```
src/
  index.ts            routes, signature check, dependency wiring
  env.ts              bindings and config parsing
  pipeline.ts         submission → Attio writes → summary card → KV
  slack/              command, interaction router, Block Kit views, option search,
                      validation, Web API wrapper, signature verification
  input/              modal → ActionDocument, /crm shortcut parser, edit diff, prefill
  contract/           the ActionDocument schema shared by every input path, WriteReport
  attio/              REST client, record accessors, the writer
  store/kv.ts         Workers KV store
  util/dates.ts       timezone-aware date helpers
test/                 one test file per module plus recording fakes for Slack, Attio, KV
docs/                 design document and operator runbook
slack-manifest.json   Slack app manifest (replace WORKER_HOST before installing)
wrangler.jsonc        Cloudflare Worker configuration
```

## Extending

**Another input path.** Everything downstream of a form submission consumes one
`ActionDocument` (see `src/contract/action-document.ts`), so a new way of producing one
never touches the writer. The `Parser` interface in `src/input/parser.ts` is the seam for
turning free text into a form kind plus prefill values; an LLM-backed implementation would
open the matching form prefilled so a human still confirms before anything is written.
That is the only component of the design with a running cost, and it is optional.

**Another CRM.** The Attio client (`src/attio/client.ts`) is the only module that knows
Attio's wire format; the writer works against its interface.

## Cost

| Component | Plan | Monthly cost |
|---|---|---|
| Slack custom app | Free | $0 |
| Attio REST API | Any plan | $0, no workflow credits |
| Cloudflare Worker and KV | Free | $0 |
| Clay scheduled import | Any plan | $0 |
