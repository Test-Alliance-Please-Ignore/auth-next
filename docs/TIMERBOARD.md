# Timerboard proposal and Codex implementation prompt

## Decision

Add Timerboard as a first-class, shared operational module in the existing
`core` + `ui` slice:

```text
apps/ui  ── typed HTTP client ──>  apps/core/timerboard  ──> Neon/Postgres
                                      │
                                      └── optional later: typed ESI projections
```

Do **not** start it as a new Worker, Durable Object, generic scheduler, or a
copy of the Structures feature. A timerboard is collaborative CRUD plus
time-range queries, history, and permission checks; Postgres gives the right
durability and query model. A dedicated Worker/DO would add deployment and
consistency complexity without providing leverage for v1.

The source of truth in v1 is an explicitly created timer entry. This is
important: EVE data can help operators discover timers, but it cannot yet be
treated as a complete, authoritative feed. ESI calendar data is personal and
structure state data is neither a universal nor a sufficient timer feed.

All stored instants and all display copy are EVE time (UTC). Never store a
local time zone or make an operator infer one.

## Product shape

Timerboard is an alliance/organisation-wide queue of imminent operational
timers. An entry answers: _what is happening, where, when, how important is
it, who owns the response, and what changed?_

### V1 scope

- A single shared board, visible to authorised users.
- Create, view, filter, edit, assign, complete, and cancel timers.
- Timer kinds: `structure`, `sovereignty`, `skyhook`, `moon`, `fleet`, and
  `custom`. Treat kinds as a closed TypeScript union in v1, not an admin
  configurable taxonomy.
- Exact timers and time windows. A timer has `startsAt`; `endsAt` is optional.
  If it is absent, `startsAt` is the exact time. If it is present, it must be
  strictly later than `startsAt`.
- Operational fields: title, priority, side (`friendly`, `hostile`, `neutral`,
  `unknown`), system, optional linked EVE entity, response/FC owner, concise
  plaintext notes, source, and lifecycle state.
- A full append-only activity trail. Cancellation and completion are state
  changes, not destructive deletes.
- A list-first interface with fast filters and reliable EVE countdowns.

### Explicitly not in V1

- Calendar scraping, automatic structure-timer import, or raw ESI requests
  from `core`.
- Discord reminders, external webhooks, fleet creation, RSVP/attendance,
  doctrine fitting, board configuration, recurring timers, and a drag/drop
  calendar. These are useful follow-ons but would make the initial module too
  broad.
- Per-corporation/private boards. Introduce that only after there is a concrete
  visibility rule; a premature `boards`/membership model would be a shallow
  layer with no current caller.

## Domain and persistence design

Put the persistent schema in `apps/core/src/db/schema.ts`, alongside the
existing core-owned tables. Add a normal, version-controlled Drizzle migration
to the core migration directory. Do not use `db:push`, `drizzle-kit push`, or
generate a migration implicitly; migration generation must be a deliberate,
reviewable step.

### `timerboard_entries`

Use a UUID/ULID consistent with neighbouring core tables. Suggested columns:

| Column                                                                 | Meaning                                                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                   | Stable entry identifier.                                                                                                                  |
| `kind`                                                                 | Closed timer-kind value.                                                                                                                  |
| `title`                                                                | Required operator-facing summary.                                                                                                         |
| `priority`                                                             | `critical`, `high`, `normal`, or `low`.                                                                                                   |
| `side`                                                                 | `friendly`, `hostile`, `neutral`, or `unknown`.                                                                                           |
| `starts_at`, `ends_at`                                                 | UTC instant or UTC window; `ends_at` is nullable.                                                                                         |
| `state`                                                                | `planned`, `covered`, `completed`, or `cancelled`. “Overdue” is a presentation derived from the current time, never a cron-written state. |
| `system_id`, `system_name`                                             | Optional EVE system reference and denormalised display snapshot. Store EVE IDs as strings where existing conventions require it.          |
| `entity_id`, `entity_type`, `entity_name`                              | Optional linked structure/other EVE object and display snapshot.                                                                          |
| `assigned_user_id`, `assigned_character_id`, `assigned_character_name` | Optional response owner. Keep the character-name snapshot so historical entries remain readable.                                          |
| `notes`                                                                | Optional bounded plaintext operational notes; no HTML/Markdown rendering in v1.                                                           |
| `source_kind`, `source_reference`                                      | `manual` initially; reserve structured provenance for a later explicit ESI import.                                                        |
| `created_by_user_id`, `updated_by_user_id`                             | Audit attribution.                                                                                                                        |
| `version`                                                              | Increment on each update for optimistic concurrency.                                                                                      |
| `created_at`, `updated_at`                                             | Server-owned timestamps.                                                                                                                  |

Add database checks for enum-like fields and time-window ordering if that is
consistent with the current migration style. Index active-listing access:

- `(state, starts_at)` for the primary board query;
- `updated_at` for recent changes;
- `assigned_user_id` only if the “mine” filter is part of v1;
- a partial uniqueness constraint on `(source_kind, source_reference)` once a
  non-manual importer exists. Do not constrain nullable manual entries.

### `timerboard_activity`

Add an append-only audit table with: `id`, `entry_id`, `actor_user_id`,
`action`, a small JSON payload containing only the changed fields/previous
values, and `created_at`. Record creation, update, assignment, state change,
and cancellation. Keep user-facing notes in the entry; do not overload the
audit table as a chat system.

### Deep module and seam

Create one `TimerboardService` module in `apps/core/src/services/` (or the
closest established core service location). Its interface is the sole place
that owns validation after transport parsing, state-transition rules,
concurrency checks, row serialization, and activity writing:

```ts
list(actor, query)
get(actor, entryId)
create(actor, input)
update(actor, entryId, input, expectedVersion)
setState(actor, entryId, state, expectedVersion)
assign(actor, entryId, assignment, expectedVersion)
listActivity(actor, entryId)
```

The implementation should use a transaction whenever an entry mutation and
its activity record are written. A version mismatch returns a clear `409
Conflict` response with the latest serialised entry so the UI can invite the
operator to reload. Do not introduce a repository interface: there is only one
Postgres adapter, so that would be a hypothetical seam. The service is the
deep module; routes and React queries should not reproduce lifecycle or
permission logic.

## Authorisation and safety

Use the existing `requireAuth`, cached user-permission lookup, and the
established permission-registration path. Site administrators retain their
existing authority. Define and document three permissions:

- `urn:timerboard:view` — list and view entry/history;
- `urn:timerboard:edit` — create and update entries the user created,
  including marking their own entry covered/completed;
- `urn:timerboard:manage` — update, assign, complete, or cancel every entry.

Make `manage` imply the operational capabilities above in the Timerboard
module, rather than requiring every route to remember combinations. Enforce
permissions server-side on every endpoint; hiding controls in the UI is only a
usability aid. Return `401` or `403` using the conventions already used by
core. Validate every request body and route/query parameter, bound text
lengths, and return typed, safe errors. Do not permit free-form HTML.

The board is intentionally a single shared audience in v1. It must not infer
access from a caller-supplied corporation ID, and it must never expose EVE
access tokens or personal calendar data.

## HTTP contract

Mount a new core route module using the repository's existing `/api` routing
convention (confirm the precise mount point before implementation). Keep
responses serialisable and timestamps ISO-8601 UTC strings.

| Method  | Path                              | Capability        | Purpose                                                                                                                                                             |
| ------- | --------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/timerboard`                     | view              | Filtered, paginated list. Filters: state (default active), kind, priority, side, system, assigned-to-me, and bounded `from`/`to`. Sort by urgency, then `startsAt`. |
| `POST`  | `/timerboard`                     | edit              | Create a manual entry.                                                                                                                                              |
| `GET`   | `/timerboard/:entryId`            | view              | Entry detail, including permission-derived actions.                                                                                                                 |
| `PATCH` | `/timerboard/:entryId`            | owner edit/manage | Update editable fields with `expectedVersion`.                                                                                                                      |
| `POST`  | `/timerboard/:entryId/state`      | owner edit/manage | Controlled state transition with `expectedVersion`.                                                                                                                 |
| `POST`  | `/timerboard/:entryId/assignment` | manage            | Assign/unassign response owner with `expectedVersion`.                                                                                                              |
| `GET`   | `/timerboard/:entryId/activity`   | view              | Ordered activity trail.                                                                                                                                             |

Keep `state` and assignment as dedicated commands because they are meaningful
audited actions; avoid a broad PATCH that silently changes lifecycle. The
route module should remain a transport adapter: parse, call the service, and
map domain errors to HTTP responses.

## UI design

Add a `/timerboard` route in `apps/ui` and a small Timerboard feature folder
containing types, query keys/hooks, API calls, formatting helpers, and focused
presentational modules. Extend the existing typed `ApiClient`; do not introduce
a second fetch client or use `any`/untyped JSON.

Expose the sidebar item only when the current user has `view`, `edit`, or
`manage`. Reuse the established user-permission hook. The page should have:

- A compact header with “New timer” for editors/managers and active filter
  chips.
- “Now / next 24h / next 7d / later / completed-cancelled” views or equivalent
  filters; default to active entries in the next seven days plus overdue
  entries.
- Rows/cards ordered by priority then next actionable instant, showing a
  coloured priority marker, type, title, system/entity, FC/owner, EVE date,
  and a live but inexpensive countdown. Reuse `EveTimeDisplay`,
  `DurationDisplay`, and the existing `useNowMs` pattern from Structures.
- A clear window presentation: `Starts 19:00–21:00 EVE`; exact timers: `19:00
EVE`. Colour alone must not communicate urgency/state.
- Create/edit form with client-side mirrors of server constraints; server
  validation remains authoritative. Use searchable, existing entity/system
  inputs only if they are already available; otherwise allow a validated name
  plus optional ID in v1.
- An entry detail drawer/page that includes the audit trail and only shows
  actions the server says are allowed.

Avoid a continuously polling board. Invalidate list/detail queries after a
successful mutation; a modest refetch-on-focus is enough for v1. The countdown
may update locally without refetching. Include accessible labels, keyboard
usable filters/forms, loading states, empty states, and conflict recovery.

## ESI and automation follow-up

Future ESI integration must respect the repository's ownership rules:

1. `apps/esi` remains the only owner of typed ESI transport, response cache,
   ETag, and rate-limit policy. `core` must never construct raw ESI requests or
   use token-store bearer-token methods.
2. A later workflow may ask `apps/esi` for a typed, authorised projection and
   create a **candidate** entry with provenance. It should not overwrite a
   manually edited entry; deduplicate using an external reference and surface
   a review action.
3. Add reminder delivery only with a durable outbox/workflow and an idempotency
   key per `(entry, reminder policy, revision)`. Do not rely on a Worker timer
   or a browser tab for operational notifications.

## Test and delivery requirements

Test the module through its interface and routes, not by reaching into its
database implementation:

- Unit tests: input and window validation, permission matrix, transition
  matrix, optimistic-concurrency conflict, list ordering/overdue derivation,
  and activity payloads.
- Core integration tests: unauthenticated/forbidden access, editor ownership,
  manager actions, serialised timestamps, pagination/filter boundaries, and a
  mutation transaction producing exactly one activity record.
- UI tests: protected navigation visibility, initial/empty/error states,
  countdown/window rendering, create/update invalidation, and conflict
  recovery.
- Run focused typechecks/tests and Prettier against every changed file, then
  report commands and results. Do not make unrelated formatting churn.

## Prompt for Codex

```text
Implement the v1 Timerboard described in TIMERBOARD.md in this auth-next
repository. Treat that document as the product and architecture decision.

Before editing, inspect the current core route mount, core schema/migration
conventions, permission registration, an authenticated CRUD route with
ownership rules, the typed UI ApiClient/query pattern, UI route registration,
and the existing Structures time-display helpers. Prefer the
codebase-memory-mcp graph tools for discovery. Preserve unrelated work.

Build one shared, manually managed operational timerboard in apps/core and
apps/ui. It must support exact timers and time windows; kind, priority, side,
system/entity snapshot, assignment, plaintext notes, state, audit history,
and optimistic concurrency. Persist data in core's Postgres schema with an
explicit Drizzle migration. Never use db:push or drizzle-kit push, and do not
run migration generation unless the current task explicitly authorises it.

Put lifecycle, permission, concurrency, serialization, and audit-write rules
behind a single TimerboardService module. Routes must only validate/translate
HTTP and call that module. Do not add a repository abstraction, a new Worker,
a Durable Object, or a generic scheduling framework. Use a transaction for
each entry mutation plus audit record.

Use the three permissions in TIMERBOARD.md and the existing auth/cached
permissions patterns. Enforce authorisation server-side: editors can create
and update only their own entries; managers can update/assign/state-change all
entries; admins retain their normal authority. Return 409 plus the current
entry for a stale expectedVersion. Completed/cancelled entries are retained;
there is no hard-delete endpoint.

Add a typed `/timerboard` UI route and guarded sidebar entry. Reuse the
repository's existing typed ApiClient, query hooks, design components, and
EVE-time/countdown helpers. Deliver a list-first board with filters, a
create/edit flow, detail/history, mutation invalidation, accessible states,
and no continuous board polling. Timestamps are ISO UTC/EVE time throughout.

Do not make raw ESI calls from core and do not expose token material. Keep ESI
importing, Discord reminders, recurring events, fleet/RVSP integration, and
multi-board configuration out of scope.

Add focused unit, integration, and UI tests as specified in TIMERBOARD.md.
Run the relevant tests/typechecks and Prettier on changed files. Finish with a
concise summary of files changed, migration status, validation commands and
results, and any deliberate assumptions.
```
