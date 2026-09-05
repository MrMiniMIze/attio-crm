# CEO Slack requests to Attio to Clay: design

- **Date:** 2026-09-04 (revision 2, zero-credit design)
- **Status:** Implemented (v1); go-live steps in `docs/runbook.md`
- **For:** Maggie (operator), Sagar (CEO, requester)
- **Author:** Christopher Pena

## 1. Problem and goals

Sagar sends Maggie several free-form Slack messages a day asking for CRM changes:
"add Jane as a warm lead at cozeva.com", "add Cozeva and Ensora as accounts you
should be hunting", "Acme has a portfolio company called X, add it and prospect it
out", "I should follow up with Cozeva tomorrow". Maggie translates each one by hand
into Attio (deals, companies, people, tasks, notes) and then by hand again into Clay.

**Goals**

1. Sagar can put a request into Attio directly, from Slack, in under thirty seconds,
   with no retyping by Maggie.
2. Never lose the original request: every write carries a note with what was asked,
   by whom, when, and a link back to Slack.
3. Replace the manual Attio to Clay sync with a scheduled import.
4. **Zero recurring cost.** No Attio workflow credits, no Clay credits, no paid Slack
   tier, no paid hosting. Everything runs on free tiers and the free Attio REST API.
5. Keep the door open for an LLM parser later without redoing anything else.

**Non-goals**

- Parsing Sagar's free-form prose in version one. There is no LLM in v1; the input is
  a form. The LLM parser option is designed in (section 12) but not built.
- Reading Sagar and Maggie's 1:1 DM passively. Not possible for any Slack app.
- Enrichment, scoring, or outbound logic. Clay keeps doing that.

## 2. Verified constraints

Checked 2026-09-04 against vendor docs (links in section 15).

| Fact | Consequence |
|---|---|
| Attio REST API is on every plan and is not credit-metered. Credits are spent only by Workflow blocks, AI attributes and Ask Attio. Rate limits: 100 reads/s, 25 writes/s | All writes go through the API from code, never through Workflows |
| Attio API: assert company by `domains`, assert person by `email_addresses`; deals accept `stage` by title, `owner` by email, `associated_company` by domain, `associated_people` by email; `POST /v2/tasks` links records by domain or email; `POST /v2/notes` takes markdown | The writer needs no ID bookkeeping for the common path |
| Attio Deals: disabled by default; `name`, `stage`, `owner` required; no unique attribute; default stages Lead / In Progress / Won / Lost; a Free workspace may enable one extra object | Dedupe deals by company lookup; a free Attio workspace can serve as a dev sandbox |
| Slack Free: up to 10 custom or third-party app installs; no Workflow Builder; slash commands, modals, buttons and shortcuts all work; 3-second acknowledgement rule on every callback | A custom app on the free plan replaces Workflow Builder |
| Cloudflare Workers Free: 100k requests/day, 10 ms CPU per invocation (I/O wait excluded); Workers KV Free: 100k reads, 1k writes, 1k deletes per day, 1 GB; business use allowed | Hosting and state cost nothing at this volume |
| Clay: CRM imports, webhook imports, formulas and filters are free; scheduled sources with "update existing rows"; hourly Enterprise-only; write-back to Attio costs 1 Clay credit per row | Import is free; do not write back |
| Attio Slack app "Ask Attio" is read-only Q&A | Not usable as the writer |

## 3. Approaches considered

**A. Attio Workflows + Slack Workflow Builder (revision 1).** No hosting, but every
record write, Slack post and AI block costs Attio credits, and Workflow Builder needs
a paid Slack plan. Rejected on cost.

**B. Hosted code with an LLM parsing free text.** Zero credits, but a few dollars a
month in API usage and prose parsing that needs a review step. Kept as the optional
parser (section 12).

**C. Hosted code with a structured form (chosen).** A slash command opens a modal;
the modal resolves records against Attio while Sagar types; the Worker writes through
the REST API. Zero recurring cost, no parsing ambiguity, no review step needed.

**Decision:** C, with the modal submission and any future parser both producing the
same action document (section 8), so the writer never changes.

## 4. Architecture

1. Sagar types `/crm` in any conversation (the DM with Maggie included). Slack sends the
   slash command to the Worker.
2. The Cloudflare Worker "attio-crm" (TypeScript, free tier) has five parts:
   the Slack layer (signature check, `/crm` command, modal views, option search, buttons);
   the input layer (modal mapper today, parsers later) that produces an ActionDocument
   (section 8); the Attio client (search, assert, query, create, notes, tasks over REST,
   no credits); Workers KV (submission log 30 days, event dedupe 1 day, stage and member
   cache 1 hour); and the summary card posted to `#crm-requests` with an Edit button.
3. Attio is the source of truth: Companies, People, Deals, Tasks, Notes.
4. Clay imports from Attio on a daily schedule with "update existing rows" on, free.
5. Clay tables: Deals, Companies, People.

Ownership: the Slack app, Cloudflare account and Attio API key belong to the company,
created by Maggie. Christopher builds, tests and hands over the repository. Secrets
never live in the repo.

## 5. User flow

1. Sagar types `/crm` (anywhere) and presses Enter. A chooser modal opens with five
   buttons: **Add lead**, **Add companies to hunt**, **Update deal**, **Add task**,
   **Add note**. Typing `/crm lead`, `/crm hunt`, `/crm deal`, `/crm task` or
   `/crm note` skips the chooser.
2. The chosen form opens (section 6). Record pickers search Attio live as Sagar types.
3. Sagar submits. The Worker validates, acknowledges within 3 seconds, and does the
   Attio writes in the background.
4. A summary card lands in `#crm-requests`: what was created or updated, with links to
   the Attio records, and an **Edit** button. Sagar sees an ephemeral confirmation in
   the conversation where the command was typed.
5. **Edit** reopens the same form prefilled. Resubmitting updates the records created
   by the original submission instead of creating new ones.
6. Clay picks up the changes on its next daily import.

Maggie's per-request work drops to zero. Maggie skims `#crm-requests` for anything odd.

## 6. Slack app

**App configuration**

- Slash command `/crm`: `POST https://<worker>/slack/command`
- Interactivity and shortcuts: `POST https://<worker>/slack/interact` (modal
  submissions, button clicks, and `external_select` option loads all arrive here)
- Bot token scopes: `commands`, `chat:write`, `chat:write.public` (so the summary can
  post to `#crm-requests` even before the bot is invited), `users:read`,
  `users:read.email` (to map the Slack user to an Attio workspace member)
- Allowlist: only Slack user IDs listed in `ALLOWED_USERS` (Sagar, Maggie) can run
  `/crm`. Anyone else gets "This command is limited to the sales team."
- Request verification: Slack signing secret, HMAC over the raw body, reject
  timestamps older than five minutes.

**Forms** (all fields Block Kit inputs; * = required)

| Form | Fields |
|---|---|
| Add lead | Company* (record picker with a "Create new: `<typed text>`" option), Person name, Person email, Stage* (from Attio, default Lead), Owner* (workspace members, default Maggie), Note, Follow up task, Due date |
| Add companies to hunt | Companies* (multiline, one name or domain per line), Stage* (default Lead), Owner* (default Maggie), Note |
| Update deal | Deal* (record picker showing the deal name; Attio's search endpoint returns no stage), New stage, Value, Add person name, Add person email, Note |
| Add task | Record* (record picker across companies and people), Task text*, Due date, Assignee* (default Maggie) |
| Add note | Record* (record picker across companies and people), Note text* |

**Record pickers** are `external_select` elements. Slack calls the Worker with the
typed text; the Worker runs Attio's search endpoint and returns up to 20 options
labelled with name and domain (companies), name and email (people), or company and
stage (deals). Attio's search is fast enough for Slack's 3-second window; the Worker
returns whatever it has at 2.5 seconds.

**Stage and owner dropdowns** are populated from Attio at open time: the status
options of the deals `stage` attribute and the workspace member list, both cached in
KV for one hour. The spec therefore has no hard-coded stage list.

**Validation** happens on submit with inline errors: at least one company for hunt;
a company or a "create new" value for lead; a due date not in the past.

**Summary card** (Block Kit) posted to `#crm-requests`:

```
Sagar via /crm · 2026-09-04 16:45
✔ Company Cozeva (cozeva.com): existing
✔ Person Jane Doe: created, linked to Cozeva
✔ Deal Cozeva: created, stage Lead, owner Maggie
✔ Task "Follow up directly": created, due 2026-09-05, assigned to Maggie
✔ Note attached to Cozeva and Jane Doe
[Edit]
```

## 7. Worker internals

Modules, each independently testable:

- `slack/verify.ts`: signature verification.
- `slack/command.ts`: parses `/crm [subcommand]`, opens the chooser or a form with
  `views.open` using the `trigger_id` (must happen within 3 seconds).
- `slack/views.ts`: Block Kit builders for the chooser, five forms, and the summary
  card. Pure functions from data to blocks.
- `slack/options.ts`: `external_select` handler: Attio search, then options.
- `input/from-modal.ts`: modal submission to `ActionDocument`. Confidence is always 1.
- `input/parser.ts`: the `Parser` interface (`parse(text, today)` returning `{ kind, prefill }`)
  and the rule-based `ruleParser` used for `/crm <subcommand> <args>` shortcuts; a
  parser opens a prefilled form and never writes.
- `attio/client.ts`: thin fetch wrapper with bearer auth, JSON, `429` retry honouring
  `Retry-After`, and typed helpers: `searchRecords`, `assertCompany(domain)`,
  `assertPerson(email)`, `createRecord`, `updateRecord`, `queryOpenDeals(companyId)`,
  `createTask`, `createNote`, `listStageOptions`, `listWorkspaceMembers`.
- `attio/writer.ts`: executes an `ActionDocument` in dependency order and returns a
  `WriteReport` (created, updated, skipped with reasons, touched record IDs).
- `store/kv.ts`: submissions (`sub:<id>`, 30 days), dedupe (`evt:<id>`, 1 day),
  caches (`cache:stages`, `cache:members`, 1 hour).
- `index.ts`: routing, 3-second acknowledgement, `ctx.waitUntil` for background work.

**Write rules** (`attio/writer.ts`):

1. **Company.** Picked from the search: use its record ID. "Create new" with a
   domain: `PUT /v2/objects/companies/records?matching_attribute=domains`. "Create
   new" with a name only: search by name; none found, create; one found, use it; more
   than one, skip with reason "ambiguous, N matches" (only reachable from the hunt
   form's free text list).
2. **Person.** Email given: assert on `email_addresses` and set `company`. Name only:
   search people by name within the company; none found, create; one found, use it;
   more, skip.
3. **Deal.** Query deals where `associated_company` is the company and `stage` is not
   Won or Lost. One open deal: update value and add the person; the stage is left
   unchanged (only the Update deal form changes an existing deal's stage). None: create
   with `name` = company name, `stage`, `owner`, `associated_company`, `associated_people`.
   More than one: skip with reason. A company whose only deals are Won or Lost gets a fresh
   deal; intended.
4. **Task.** `POST /v2/tasks` with `content`, `deadline_at` (due date at 17:00
   America/Los_Angeles, ISO 8601), `linked_records`, `assignees`.
5. **Note.** `POST /v2/notes`, `format: markdown`, title `From <requester> via Slack
   <date>`, body = the human summary of the submission plus the `#crm-requests`
   permalink.
6. **Source note on every touched record**, deduplicated by record ID.
7. **Edit.** Resubmission loads `sub:<id>`, updates the records it recorded, creates
   only what is new, and posts a fresh summary replacing the old card.

**Dedupe.** Slack retries any callback not acknowledged within 3 seconds. Every
modal submission is keyed by its Slack view id in KV before processing; a repeat is
acknowledged and ignored. Slash commands and button clicks acknowledge in
milliseconds and are not deduplicated.

## 8. Action document (the contract)

Every input path, modal today and any parser later, produces this document, and the
writer consumes only this. Confidence is 1 for modal input; a parser may go lower and
the writer then treats anything under 0.7 as `needs_review`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": ["source", "actions", "needs_review"],
  "properties": {
    "source": {
      "type": "object", "additionalProperties": false,
      "required": ["kind", "requester", "permalink", "received_at", "raw"],
      "properties": {
        "kind": {"type": "string", "enum": ["modal", "command", "shortcut"]},
        "requester": {"type": "string", "description": "Slack user ID"},
        "permalink": {"type": ["string", "null"]},
        "received_at": {"type": "string", "format": "date-time"},
        "raw": {"type": "string", "description": "verbatim text or serialized form"}
      }
    },
    "actions": {
      "type": "array",
      "items": {
        "oneOf": [
          {"$ref": "#/$defs/upsert_company"},
          {"$ref": "#/$defs/upsert_person"},
          {"$ref": "#/$defs/set_deal_stage"},
          {"$ref": "#/$defs/create_task"},
          {"$ref": "#/$defs/add_note"}
        ]
      }
    },
    "needs_review": {
      "type": "array",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["fragment", "reason"],
        "properties": {"fragment": {"type": "string"}, "reason": {"type": "string"}}
      }
    }
  },
  "$defs": {
    "company_ref": {
      "type": "object", "additionalProperties": false,
      "required": ["record_id", "name", "domain"],
      "properties": {
        "record_id": {"type": ["string", "null"]},
        "name": {"type": ["string", "null"]},
        "domain": {"type": ["string", "null"]}
      }
    },
    "person_ref": {
      "type": "object", "additionalProperties": false,
      "required": ["record_id", "first_name", "last_name", "email"],
      "properties": {
        "record_id": {"type": ["string", "null"]},
        "first_name": {"type": ["string", "null"]},
        "last_name": {"type": ["string", "null"]},
        "email": {"type": ["string", "null"]}
      }
    },
    "actor_ref": {
      "type": "object", "additionalProperties": false,
      "required": ["member_id", "email"],
      "properties": {"member_id": {"type": ["string", "null"]}, "email": {"type": ["string", "null"]}}
    },
    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    "upsert_company": {
      "type": "object", "additionalProperties": false,
      "required": ["type", "company", "confidence"],
      "properties": {
        "type": {"const": "upsert_company"},
        "company": {"$ref": "#/$defs/company_ref"},
        "confidence": {"$ref": "#/$defs/confidence"}
      }
    },
    "upsert_person": {
      "type": "object", "additionalProperties": false,
      "required": ["type", "person", "company", "confidence"],
      "properties": {
        "type": {"const": "upsert_person"},
        "person": {"$ref": "#/$defs/person_ref"},
        "company": {"anyOf": [{"$ref": "#/$defs/company_ref"}, {"type": "null"}]},
        "confidence": {"$ref": "#/$defs/confidence"}
      }
    },
    "set_deal_stage": {
      "type": "object", "additionalProperties": false,
      "required": ["type", "deal_record_id", "company", "person", "stage", "value", "owner", "confidence"],
      "properties": {
        "type": {"const": "set_deal_stage"},
        "deal_record_id": {"type": ["string", "null"]},
        "company": {"$ref": "#/$defs/company_ref"},
        "person": {"anyOf": [{"$ref": "#/$defs/person_ref"}, {"type": "null"}]},
        "stage": {"type": "string", "description": "must equal a live Attio stage title"},
        "value": {"type": ["number", "null"]},
        "owner": {"$ref": "#/$defs/actor_ref"},
        "confidence": {"$ref": "#/$defs/confidence"}
      }
    },
    "create_task": {
      "type": "object", "additionalProperties": false,
      "required": ["type", "title", "company", "person", "due", "assignee", "confidence"],
      "properties": {
        "type": {"const": "create_task"},
        "title": {"type": "string"},
        "company": {"anyOf": [{"$ref": "#/$defs/company_ref"}, {"type": "null"}]},
        "person": {"anyOf": [{"$ref": "#/$defs/person_ref"}, {"type": "null"}]},
        "due": {"type": ["string", "null"], "format": "date"},
        "assignee": {"$ref": "#/$defs/actor_ref"},
        "confidence": {"$ref": "#/$defs/confidence"}
      }
    },
    "add_note": {
      "type": "object", "additionalProperties": false,
      "required": ["type", "company", "person", "text", "confidence"],
      "properties": {
        "type": {"const": "add_note"},
        "company": {"anyOf": [{"$ref": "#/$defs/company_ref"}, {"type": "null"}]},
        "person": {"anyOf": [{"$ref": "#/$defs/person_ref"}, {"type": "null"}]},
        "text": {"type": "string"},
        "confidence": {"$ref": "#/$defs/confidence"}
      }
    }
  }
}
```

Rules that hold for every producer:

1. Actions are emitted in dependency order: `upsert_company`, `upsert_person`,
   `set_deal_stage`, then `create_task` and `add_note`.
2. `stage` is validated against the live stage list fetched from Attio; the modal
   cannot produce an invalid one, a parser can, and the writer rejects it into
   `needs_review`.
3. Identifiers are never invented. A `record_id` comes from a picker or a search hit.
4. Dates are ISO dates resolved in America/Los_Angeles.
5. For `set_deal_stage` on an existing deal, `owner` is the deal's current owner unless
   the form changed it; the mapper copies it from the picked deal so the writer never
   has to guess.

## 9. Error handling

| Situation | Behaviour |
|---|---|
| Slash command from a user not in the allowlist | Ephemeral refusal, nothing else |
| Modal validation fails | Inline field errors, modal stays open |
| Attio search slow during option load | Return what arrived by 2.5 s; empty list shows "keep typing" |
| Attio `429` | Retry after `Retry-After`, up to 3 times, then report the write as failed |
| Attio `4xx` on a write | Stop the dependency chain for that company; summary card shows the failed step and the error text; Edit lets Sagar retry |
| Company name matches several records (hunt free text only) | Skipped, listed on the card with the candidates |
| Open deal already exists | Stage updated, no second deal |
| Slack retries a callback | Dedupe key already in KV, so it is acknowledged and ignored |
| Worker throws | Slack shows a generic error; the exception is in Workers Logs; the request is not recorded as a submission, so Edit is not offered, and Sagar re-runs `/crm` |
| KV daily write limit reached | Impossible at this volume (about 4 writes per request, 1,000/day allowed); if it ever happens, writes fail loudly and the summary card says so |
| Clay import fails | Clay's own notification; no coupling |

## 10. Clay sync

1. Maggie (Attio admin) authorizes Clay's Attio connection via OAuth.
2. Three Clay tables, each with source "Import from Attio": **Deals**, **Companies**,
   **People**. Schedule: daily, "Update existing rows" on. Imports cost no credits.
3. Deals table columns: name, stage, owner, value, associated company (with Attio record
   ID), associated people.
4. If Companies or People tables need deal awareness ("has open deal"), add a Clay
   lookup column against the Deals table on the Attio company record ID.
5. No write-back from Clay to Attio; that is the one Clay action that costs credits.
6. Open input: what Clay uses Deal data for. The tables do not depend on the answer.

## 11. Testing and rollout

**Unit tests (vitest).** `views.ts`, `from-modal.ts`, `RuleParser`, and `writer.ts`
are pure or take an injected Attio client. Fixtures: one submission per form, plus the
three requests from the original notes expressed as form submissions, each with its
expected `ActionDocument` and expected Attio calls (mocked `fetch`).

**Dev sandbox at no cost.** Christopher creates a free Slack workspace and a free
Attio workspace (Deals enabled as the one extra object). The Worker runs against
these under `wrangler dev` and then a dev deployment. No company data is touched
until go-live.

**Go-live checklist.**

1. Maggie creates the Slack app from the manifest in the repo and installs it (one of
   the 10 free-plan slots), invites the bot to `#crm-requests`, sets `ALLOWED_USERS`.
2. Maggie creates an Attio access token with record read/write, note write, task
   write, and object configuration read.
3. Maggie or the company creates a Cloudflare account; Christopher runs
   `wrangler deploy` and sets secrets with `wrangler secret put`.
4. Five smoke submissions, one per form, against real Attio with `[TEST]` names,
   deleted afterwards.
5. Sagar gets a one-screen guide: `/crm`, the five forms, Edit.

**Two-week soft launch.** Maggie tallies per request: correct / needed Edit / failed.
Fewer than 5% failures and no writes to the wrong record: done. Anything else: fix,
repeat.

## 12. The LLM parser option (designed, not built)

Trigger to build it: Sagar keeps sending prose instead of using `/crm`, or asks for it.

- An `LlmParser` implements the `Parser` interface in `src/input/parser.ts` by calling
  a hosted LLM API with the section 8 schema as a strict JSON output schema and the
  fixture set as few-shot examples.
- Entry points: a **message shortcut "Send to Attio"** that Maggie (or Sagar) uses on
  any message, including DMs; and `/crm <free text>` when `PARSER=llm`.
- Output does not write directly. It opens the matching form **prefilled**, so the
  human confirms and the writer path is unchanged. That keeps the no-review guarantee
  of the modal design.
- Cost: a few cents per message at most with a mid-tier model; single-digit dollars a
  month at current volume. The only non-zero line item, and optional.

## 13. Cost summary

| Component | Plan | Monthly cost |
|---|---|---|
| Slack custom app | Free (or any) | $0 |
| Attio REST API | Any plan | $0, no credits |
| Cloudflare Worker + KV | Free | $0 |
| Clay Attio import | Any plan | $0 credits |
| LLM parser (optional) | Pay per token | single-digit dollars if enabled |

## 14. Open inputs and assumptions

Inputs, none blocking development in the sandbox:

1. Sagar agrees to type `/crm`. Everything else about their habit stays.
2. Maggie can install a custom app and create an Attio access token (confirmed).
3. Who owns the Cloudflare account. Recommendation: the company, or Maggie.
4. What Clay uses Deal data for.
5. `#crm-requests` exists and Sagar and Maggie are in it.

Assumptions to verify during build:

- Attio's search endpoint returns companies and deals by partial name fast enough for
  Slack's option-load window.
- Attio status options for `stage` are readable with the object-configuration scope.
- Slack's `external_select` "create new" pattern (an option carrying the typed text)
  behaves as expected on the free plan.
- Workers Free 10 ms CPU is enough per request. Expected: under 2 ms; fetch waits do
  not count.

## 15. Sources

- Attio credits: https://attio.com/help/reference/workspace-settings-billing/manage-workspace-and-seat-credits
- Attio plans: https://attio.com/help/reference/workspace-settings-billing/attio-plans-and-features
- Attio API rate limits: https://docs.attio.com/rest-api/guides/rate-limiting
- Attio create deal: https://docs.attio.com/rest-api/endpoint-reference/deals/create-a-deal-record
- Attio assert person: https://docs.attio.com/rest-api/endpoint-reference/people/upsert-a-person-record
- Attio search records: https://docs.attio.com/rest-api/endpoint-reference/records/search-records
- Attio create task: https://docs.attio.com/rest-api/endpoint-reference/tasks/create-a-task
- Attio create note: https://docs.attio.com/rest-api/endpoint-reference/notes/create-a-note
- Attio Deals object: https://docs.attio.com/docs/standard-objects/standard-objects-deals
- Attio Slack app: https://attio.com/help/apps/automations-apps/slack-app
- Slack free plan limitations: https://slack.com/help/articles/27204752526611-Feature-limitations-on-the-free-version-of-Slack
- Slack slash commands: https://api.slack.com/interactivity/slash-commands
- Cloudflare Workers pricing and limits: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare KV pricing: https://developers.cloudflare.com/kv/platform/pricing
- Clay, which actions cost credits: https://www.clay.com/faq/which-actions-cost-credits-or-are-free
- Clay Attio integration: https://university.clay.com/docs/attio-integration
- Clay scheduled sources: https://university.clay.com/docs/scheduled-sources
