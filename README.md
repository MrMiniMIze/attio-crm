# attio-crm

A Slack `/crm` slash command that writes to the [Attio](https://attio.com) CRM, running on
Google Cloud Run. Built so a salesperson can add leads, companies, deals, tasks and notes
from Slack in under thirty seconds, with nobody retyping anything.

**Designed to be added to a Slack bot you already run.** Every identifier it introduces is
namespaced `crm_`, and [`src/slack/dispatch.ts`](src/slack/dispatch.ts) gives you the one
function needed to route traffic to it without touching your existing handlers.

**Zero recurring cost.** Cloud Run, Firestore, Cloud Tasks, Secret Manager and Cloud
Scheduler all stay inside their free tiers at this volume, and the Attio REST API is not
credit-metered.

- Design document: [`docs/design.md`](docs/design.md)
- Operations, launch checklist, smoke test and troubleshooting: [`docs/runbook.md`](docs/runbook.md)

## What it does

| Form (`/crm …`) | Result in Attio |
|---|---|
| **Add lead** | Company (existing or new), optional person, a deal at the chosen stage, optional follow-up task and note |
| **Add companies to hunt** | One company and one deal per line pasted (name or domain), up to 15 |
| **Update deal** | Stage and value changes, add a person, add a note, on a deal picked from live search |
| **Add task** | A task linked to a company or person, with due date and assignee |
| **Add note** | A note on a company or person |

Every form's record pickers search Attio live as the user types, so "which Cozeva?" is
settled at input time. Each submission posts a summary card to a Slack channel with links to
the records and an **Edit** button that reopens the same form prefilled. Every record touched
gets a source note recording who asked, when, and a link back to Slack.

Shortcuts skip the chooser: `/crm lead Jane Doe @ cozeva.com`, `/crm hunt Ensora, acme.com`,
`/crm task Follow up with Cozeva due tomorrow`, `/crm note Met them at HLTH`.

## Adding this to a bot you already run

Slack gives an app **one** Interactivity Request URL and **one** Select Menus Options URL for
the whole app. If your bot already owns those, this feature cannot claim them — it has to sit
behind a dispatcher beside what you already handle:

```ts
import { isCrmPayload } from './attio-crm/src/slack/dispatch';

app.post('/slack/interact', verifySlackSignature, async (req, res) => {
  const payload = JSON.parse(new URLSearchParams(await rawBody(req)).get('payload'));
  return isCrmPayload(payload) ? crmHandler(payload) : yourExistingHandler(payload);
});
```

`isCrmPayload` is a prefix test over the four places Slack hides an identifier — the view's
`callback_id`, a top-level `callback_id`, a top-level `action_id`, and `actions[].action_id`
— so it cannot collide with handlers that were there first. The last of those matters: the
Edit button lives on a *message*, not a modal, so its payload carries no view at all.

Three things to check on the Slack app itself:

| Setting | Value | If you miss it |
|---|---|---|
| Slash Commands → `/crm` | `https://HOST/slack/command` | The command does not exist |
| Interactivity → Request URL | `https://HOST/slack/interact` | Submits and Edit fail |
| Interactivity → Select Menus | `https://HOST/slack/interact` | **Silent:** pickers return nothing and look like an empty CRM |

The Select Menus Options URL is a separate field further down the same page, and it is the one
people forget. Bot scopes needed: `commands`, `chat:write`, `chat:write.public`, `users:read`,
`users:read.email`. Invite the bot to the summary channel — `chat:write` alone does not let it
post somewhere it is not a member.

## How it works

1. Slack sends the `/crm` command or an interaction to Cloud Run, which verifies the Slack
   signature on every request and checks the user against an allowlist.
2. Opening or updating a modal is **awaited**: it has to land inside the same three seconds
   Slack allows for the reply, and `views.open` is a couple of hundred milliseconds.
3. A modal submission becomes an `ActionDocument` — one validated list of typed actions — and
   is handed to **Cloud Tasks**, keyed on `view.id`. Slack gets its answer immediately.
4. The queue delivers that job back to `POST /tasks/write`, which is protected by an OIDC
   token and rejects anything that is not the queue.
5. The writer runs the actions against the Attio REST API in order: companies, then people,
   then deals, then tasks and notes. It posts the summary card and stores the submission in
   Firestore.

The queue hop exists because Cloud Run stops the container once a response is sent — there is
nowhere for work to continue behind the reply. It buys durability and retries in exchange.

### Write rules worth knowing

- Companies are matched by domain and people by email. An entry with only a name is searched
  first and created only if nothing matches. **Ambiguous matches are skipped and reported,
  never guessed.**
- A company with one open deal gets that deal updated rather than a second deal created, and
  **the "add" forms never change an existing deal's stage.** Only **Update deal** does. An add
  form must not drag a company at Negotiation back to Discovery because the form defaulted there.
- Editing a submission updates the records it created and does not create tasks or notes a
  second time.
- Any single failing write is reported on the card; the rest still run.
- A record id only ever comes from a picker or a search hit. Nothing constructs one.

## Layout

```
src/
  router.ts              routes, shared by the server and the tests
  server.ts              Node entrypoint; picks real or in-memory infrastructure
  pipeline.ts            submission -> action document -> writes -> summary card
  platform/
    queue.ts             Queue interface + the inline queue used locally
    cloud-tasks.ts       Queue over Cloud Tasks, with name-based deduplication
    oidc.ts              verifies the queue's token on /tasks/write
  store/
    store.ts             Store interface + the in-memory store used locally
    firestore.ts         Store over Firestore, with read-side expiry
  slack/
    dispatch.ts          isCrmPayload — the integration seam
    verify.ts            Slack signature verification
    command.ts           /crm
    interact.ts          modals, buttons, picker lookups
    views.ts             Block Kit
  attio/                 REST client and the writer
  contract/              the typed action document and write report
  input/                 shorthand parsing, modal decoding, edit diffing
```

Two interfaces carry the platform: `Store` and `Queue`. Locally both resolve to in-memory
implementations, which is why the 130 tests need no network and no emulator.

## Running locally

```bash
npm install
npm test          # 130 tests, no network
npm run typecheck
cp .env.example .env    # fill in the Slack and Attio values
npm run dev
```

With no GCP settings present the server keeps state in memory and runs Attio writes inline
instead of through Cloud Tasks, so `/crm` works end to end against a real Attio workspace with
nothing provisioned. Use a tunnel (`cloudflared tunnel --url http://localhost:8080`, `ngrok
http 8080`) to give Slack a public URL.

## Deploying

```bash
export PROJECT=your-project REGION=us-central1
gcloud config set project $PROJECT

gcloud services enable run.googleapis.com cloudtasks.googleapis.com \
  firestore.googleapis.com secretmanager.googleapis.com \
  cloudscheduler.googleapis.com cloudbuild.googleapis.com

gcloud firestore databases create --location=nam5      # permanent, choose carefully
gcloud tasks queues create crm-writes --location=$REGION \
  --max-attempts=5 --min-backoff=10s --max-backoff=300s

gcloud iam service-accounts create crm-run   --display-name="attio-crm service"
gcloud iam service-accounts create crm-queue --display-name="attio-crm task invoker"
SVC=crm-run@$PROJECT.iam.gserviceaccount.com
for r in roles/datastore.user roles/cloudtasks.enqueuer; do
  gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$SVC" --role="$r"
done

for s in ATTIO_TOKEN SLACK_SIGNING_SECRET SLACK_BOT_TOKEN; do
  gcloud secrets create $s --replication-policy=automatic
  gcloud secrets add-iam-policy-binding $s \
    --member="serviceAccount:$SVC" --role=roles/secretmanager.secretAccessor
done
printf %s "$ATTIO_TOKEN" | gcloud secrets versions add ATTIO_TOKEN --data-file=-   # not echo

# First pass: create the service so it has a URL.
gcloud run deploy attio-crm --source . --region=$REGION --service-account=$SVC \
  --allow-unauthenticated --cpu-boost --cpu=1 --memory=512Mi \
  --set-secrets=ATTIO_TOKEN=ATTIO_TOKEN:latest,SLACK_SIGNING_SECRET=SLACK_SIGNING_SECRET:latest,SLACK_BOT_TOKEN=SLACK_BOT_TOKEN:latest

# Second pass: hand it its own URL, which it needs to aim tasks back at itself.
URL=$(gcloud run services describe attio-crm --region=$REGION --format='value(status.url)')
gcloud run services update attio-crm --region=$REGION \
  --set-env-vars="TASK_URL=$URL/tasks/write,TASK_AUDIENCE=$URL/tasks/write,\
QUEUE_INVOKER=crm-queue@$PROJECT.iam.gserviceaccount.com,\
QUEUE_PARENT=projects/$PROJECT/locations/$REGION/queues/crm-writes,\
ALLOWED_USERS=U01ABC,SUMMARY_CHANNEL=C0123,DEFAULT_OWNER_EMAIL=maggie@example.com,\
TIMEZONE=America/Los_Angeles"

gcloud run services add-iam-policy-binding attio-crm --region=$REGION \
  --member="serviceAccount:crm-queue@$PROJECT.iam.gserviceaccount.com" --role=roles/run.invoker

# Free way to avoid cold starts during the working day.
gcloud scheduler jobs create http crm-warm --location=$REGION \
  --schedule="*/5 6-19 * * 1-5" --time-zone="America/Los_Angeles" \
  --uri="$URL/healthz" --http-method=GET
```

Then put `$URL` into the three Slack settings above (`slack-manifest.json` has them as
`CLOUD_RUN_HOST`).

`--allow-unauthenticated` is for Slack, which cannot present a Google identity; the security
boundary there stays the signing secret. The `run.invoker` binding is separate and is what the
OIDC token on `/tasks/write` is verified against.

## Configuration

| Variable | Where | Notes |
|---|---|---|
| `SLACK_SIGNING_SECRET` | Secret Manager | Reuse your bot's |
| `SLACK_BOT_TOKEN` | Secret Manager | Reuse your bot's |
| `ATTIO_TOKEN` | Secret Manager | Scopes below |
| `ALLOWED_USERS` | Env | Comma-separated Slack user ids allowed to write |
| `SUMMARY_CHANNEL` | Env | Channel id for summary cards |
| `DEFAULT_OWNER_EMAIL` | Env | Attio member owning records with no explicit owner |
| `TIMEZONE` | Env | Task due dates resolve to 17:00 here. Default `America/Los_Angeles` |
| `QUEUE_PARENT` | Env | `projects/P/locations/R/queues/crm-writes`. Unset locally |
| `TASK_URL` / `TASK_AUDIENCE` | Env | `https://HOST/tasks/write`. Unset locally |
| `QUEUE_INVOKER` | Env | `crm-queue@P.iam.gserviceaccount.com`. Unset locally |

Attio token scopes: `record_permission:read-write`, `object_configuration:read`,
`note:read-write`, `task:read-write`, `user_management:read`.

## Two behaviours worth knowing before you change anything

**Firestore's TTL is a background sweep, not an instant delete.** An expired document stays
readable until it is collected, which can take up to 24 hours, so
[`store/firestore.ts`](src/store/firestore.ts) checks `expiresAt` on every read. Remove that
check and the one-hour Attio stage cache will serve yesterday's stages all day. The three
collections (`submissions` 30 days, `dedupe` 1 day, `cache` 1 hour) each need a TTL policy:

```bash
for c in submissions dedupe cache; do
  gcloud firestore fields ttls update expiresAt --collection-group=$c --enable-ttl
done
```

**Cloud Tasks is at-least-once.** A job that fails halfway and retries re-enters the writer
with some records already created. Companies and People are safe because they match on domain
and email; deduplication for the submission as a whole is the Cloud Tasks *task name*, which is
`view.id` and which the queue refuses to accept twice within about an hour. `/tasks/write`
returns 2xx for anything already reported on the summary card — a non-2xx sends the task back
to the queue, so it is reserved for failures a retry could actually fix.

## Cost

| Service | Free allowance | Use at ~10 submissions/day |
|---|---|---|
| Cloud Run | 2M requests, 180k vCPU-s/mo | ~15k, ~4.4k |
| Firestore | 20k writes, 50k reads/day | ~80, ~400 |
| Cloud Tasks | 1M operations/mo | ~600 |
| Secret Manager | 6 active versions | 3 |
| Cloud Scheduler | 3 jobs | 1 |

Total $0. The binding constraint is Cloud Run vCPU-seconds, around 1,200 submissions a day.

Things that would start a bill: putting a global HTTPS load balancer in front of Cloud Run
(~$18/mo, charged hourly regardless of traffic — the built-in `run.app` URL is all Slack
needs); `--min-instances=1` (~$6–12/mo, and the warm ping above is the free alternative);
reaching for Memorystore instead of Firestore (no free tier); and moving any of this logic
into an Attio *Workflow*, which is credit-metered where the REST API is not.

## Tests

```bash
npm test
```

130 tests, no network and no emulator: `Store` and `Queue` both have in-memory implementations
that the suite wires up exactly the way `router.ts` does locally. `npm run typecheck` and
`npm run build` (esbuild, one 66 KB file) both run in CI-friendly isolation too.
