# Neon Data Transfer Investigation

## 1. Executive summary

Recent code changes could plausibly have increased Neon PostgreSQL data transfer. The strongest evidence points to application-level behavior rather than a Neon driver or infrastructure regression: several recent features repeatedly fetch broad database result sets without a shared Worker, edge, or query-result cache.

Top suspected causes:

| Rank | Suspect | Confidence | Summary |
| ---: | ------- | ---------- | ------- |
| 1 | Structures list and overview queries | High | Recent structures changes expanded tabbed views and summaries. Current code loads all visible structures and related fuel history before pagination, with no shared server-side cache. |
| 2 | Fleet tracking active-session polling | Medium-high | Active fleet detail pages poll several protected endpoints every 5s or 15s. Each request also pays global auth/session DB overhead, and timeline data is read broadly before slicing. |
| 3 | New background/admin workloads | Medium | Prediction-market reconciliation now runs every 5 minutes, and service access audit can scan all users when triggered. These are bounded, but new within the investigation window. |

Most important next action: compare Neon top queries by calls, rows returned, and transfer with Cloudflare route counts for `/api/structures`, `/api/fleets/tracking/*`, prediction-market cron execution, and service-access-audit workflow runs across the deploy window.

No application code, configuration, migrations, lock files, or infrastructure files were modified during the investigation before this report was written.

## 2. Architecture summary

This repository is a Cloudflare Workers monorepo using TypeScript, Hono, pnpm workspaces, Turborepo, Drizzle ORM, and Neon PostgreSQL.

The primary execution model is multiple Cloudflare Worker services under `apps/*`. The main API gateway is `apps/core`, with Hono routes mounted from `src/index.ts`. The UI Worker serves the React SPA and proxies API-like flows to core. The repo also uses Durable Objects, Workflows, Queues, Cron Triggers, KV, R2, and service bindings.

Neon access is centralized through `@repo/db-utils`. Most request-path database clients use Neon HTTP via `neon(databaseUrl)` and Drizzle in [`packages/db-utils/src/client.ts`](/Users/mcp/projects/auth-next/packages/db-utils/src/client.ts:14). Some Durable Objects use Neon WebSocket `Pool` clients via [`packages/db-utils/src/client.ts`](/Users/mcp/projects/auth-next/packages/db-utils/src/client.ts:40). I found no Hyperdrive integration and no primary Prisma, Kysely, or direct `pg` application access pattern.

Database queries originate from:

- Hono request handlers in core and service workers.
- Global auth/session middleware in core.
- Durable Object RPC methods.
- Workflows, scheduled handlers, and background reconciliation jobs.
- Queue-related and sync-oriented services.

Existing caching mechanisms include:

- Browser-local React Query caches in the UI.
- Process-local `TimeCache` instances, for example group/permission caches in [`apps/core/src/lib/groups-cache.ts`](/Users/mcp/projects/auth-next/apps/core/src/lib/groups-cache.ts:21) and fleet stats in [`apps/core/src/routes/fleets.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/fleets.ts:1177).
- Cloudflare Cache API helper code in [`packages/hono-helpers/src/middleware/withCache.ts`](/Users/mcp/projects/auth-next/packages/hono-helpers/src/middleware/withCache.ts:7), but it is not broadly applied to the high-risk structures or fleet detail paths.
- Static asset caching in the UI Worker. HTML is served with no-cache semantics, while hashed assets are immutable.

The existing process-local caches are not durable and are not shared across Worker isolates, regions, or deployments.

## 3. Investigation period and Git history

Exact investigation period: `2026-06-21` through `2026-07-21` inclusive.

Commands used included:

```bash
git log --since="2026-06-21 00:00:00" --until="2026-07-21 23:59:59" --date=iso --stat
git log --since="2026-06-21 00:00:00" --until="2026-07-21 23:59:59" --date=iso --name-status
git log --since="2026-06-21 00:00:00" --until="2026-07-21 23:59:59" --date=iso --oneline --decorate
git log --merges --since="2026-06-21 00:00:00" --until="2026-07-21 23:59:59" --date=iso --oneline --decorate
```

Code discovery was performed first through `codebase-memory-mcp`, including repository indexing and graph-based searches. Targeted read-only shell commands were then used for Git history, diffs, line-numbered evidence, configuration checks, and literal searches.

No merge commits were present in the investigation period.

Relevant commits selected for detailed review:

| Commit | Area | Why selected |
| ------ | ---- | ------------ |
| `592d1830` | Structures | Adjusted structure cooldown/update behavior. |
| `dd47a73b` | Structures, eve-corp-data | Touched structure services, workflows, and migrations. |
| `05a37a6b` | Structures | Large refactor aligning structures data model and UI with current behavior. |
| `fced9cc6` | Structures | Added structure sync cooldown behavior. |
| `5a7658fc` | Structures | Split structure tabs and expanded tab-specific access paths. |
| `402de771` | Fleet tracking | Added boss handoff and tracking stats behavior. |
| `ca6993bd` | Fleet tracking | Added live location tracking and polling surface. |
| `a12254f0` | Fleet tracking | Fixed tracking lifecycle and added migration. |
| `6e75f2aa` | Prediction markets | Introduced prediction-market application and schema. |
| `86bc80d3` | Prediction markets | Added forum-post reconciliation from core cron. |
| `03f3d046` | Service audit | Added read-only services access audit workflow, routes, UI, and migrations. |
| `c70792d1` | Navigation | Added DB-backed sidebar external links. |
| `5b5bbd14` | SRP | Added pagination to recent losses and my losses. |
| `aebda737` | SRP | Refactored SRP workflows and data storage. |

Dependency and lock-file changes were reviewed. I did not find evidence of a recent Neon/Drizzle driver update that would itself explain increased data transfer. The relevant current dependencies are `@neondatabase/serverless 1.0.2` and `drizzle-orm 0.44.7`.

## 4. Database-access inventory

| Location | Trigger | Query purpose | Frequency | Result size risk | Cache present | Recently changed |
| -------- | ------- | ------------- | --------: | ---------------- | ------------- | ---------------- |
| [`apps/core/src/middleware/session.ts`](/Users/mcp/projects/auth-next/apps/core/src/middleware/session.ts:26) | Every authenticated core request | Validate session, load profile, roles, blacklist status, record IP | Every authenticated API hit | Medium | Short process-local role/group caches only | Mostly old |
| [`apps/core/src/services/auth.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/auth.service.ts:70) | Session middleware | Session lookup and `lastActivityAt` update | Every valid authenticated API hit | Low per request, high at scale | None | Mostly old |
| [`apps/core/src/services/user.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/user.service.ts:159) | Session middleware | User, characters, preferences | Every authenticated API hit | Medium | None found | Mostly old |
| [`apps/core/src/lib/ip-tracking.ts`](/Users/mcp/projects/auth-next/apps/core/src/lib/ip-tracking.ts:77) | Session middleware background task | User IP insert/upsert | Every authenticated API hit with IP context | Low per request, write-amplified at scale | Throttled update condition, but still sends upsert | Mostly old |
| [`apps/core/src/routes/navigation-links.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/navigation-links.ts:27) | Sidebar render | Enabled external navigation links | Per browser cache window | Low | Browser React Query only | Yes, `c70792d1` |
| [`apps/structures/src/services/structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2426) | Structures pages/API | Visible structures, configs, corp names | Page load and tab refresh | High | Browser React Query only | Yes |
| [`apps/structures/src/services/structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2339) | Structures overview/list summaries | Fuel history samples for visible structures | Per overview/list call | High | None found | Yes |
| [`apps/core/src/routes/structures.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/structures.ts:756) | `/api/structures/overview` | Structure overview metrics | Page load and 30s stale refresh | High | None found | Yes |
| [`apps/core/src/routes/fleets.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/fleets.ts:823) | Active fleet detail | Live snapshot, current members, timeline, locations | 5s and 15s polling | Medium-high | None for live/detail | Yes |
| [`apps/fleets/src/durable-object.ts`](/Users/mcp/projects/auth-next/apps/fleets/src/durable-object.ts:1537) | Fleet timeline route | Member history, lifecycle, boss, ship timeline | 5s while page is active | High | None found | Yes |
| [`apps/core/src/services/discord-market-reconcile.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/discord-market-reconcile.service.ts:87) | Core cron | Prediction-market Discord reconciliation | Every 5 minutes per active environment | Medium | None found | Yes, `86bc80d3` |
| [`apps/prediction-markets/src/services/shared.ts`](/Users/mcp/projects/auth-next/apps/prediction-markets/src/services/shared.ts:36) | Prediction-market reads/reconcile | Market detail and outcomes | Per market detail | Medium | None found | Yes |
| [`apps/core/src/workflows/service-access-audit.workflow.ts`](/Users/mcp/projects/auth-next/apps/core/src/workflows/service-access-audit.workflow.ts:251) | Admin-started workflow | Full user eligibility scan and audit row writes | On demand | High if repeated | Results persisted as audit run rows | Yes, `03f3d046` |
| [`apps/srp/src/durable-object.ts`](/Users/mcp/projects/auth-next/apps/srp/src/durable-object.ts:969) | SRP losses page | Recent losses, SRP state, optional wallet journal scan | User page load, 5m client stale | Medium-high | DO storage and client cache | Yes |

## 5. Findings ranked by likely impact

### Finding 1: Structures endpoints fetch broad result sets without shared caching

Severity: high.
Confidence: high for the code mechanism, medium-high for production impact pending metrics.

Relevant commits: `5a7658fc`, `05a37a6b`, `dd47a73b`, `592d1830`.

Before the recent structures work, the feature was narrower and less tab-heavy. After the changes, the structures UI and routes expose richer overview and tabbed data, while the service layer currently loads broad visible datasets before reducing the response.

Evidence:

- `loadVisibleStructureContexts` reads all matching `corporationStructures` rows without SQL-side page limits in [`structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2480).
- Structure list functions sort and slice after building visible structures in memory, for example [`structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2737).
- `buildStructureSummary` loads fuel history for all returned structure IDs through [`structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2327).
- `loadFuelHistorySamplesByStructure` reads all `structureFuelLog` rows for the structure ID set, with no visible time or sample bound, in [`structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2348).
- Overview metrics call the same broad context path in [`structures.service.ts`](/Users/mcp/projects/auth-next/apps/structures/src/services/structures.service.ts:2765).
- The core overview route has no Cache API or cache-control layer in [`structures.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/structures.ts:756).

Mechanism that increases transfer:

- Rows returned: high, because full visible structure sets and fuel history are transferred to the Worker.
- Repeated reads: high, because browser-local React Query cache does not deduplicate across users, browsers, Workers isolates, or regions.
- Cache hit rate: no shared cache found for these results.
- Pagination effectiveness: weak for Neon transfer, because slicing occurs after broad reads.

Expected direction and rough magnitude:

Transfer scales with:

```text
structure page views
x route calls per page
x (visible structure rows + config rows + tab rows + fuel log rows)
x average row width
```

Illustrative example only: `500 visible structures x 24 fuel samples x 100 bytes` is about `1.2 MB` of fuel-log payload per summary call before protocol and JSON overhead.

Evidence still needed:

- Neon top queries by rows and calls for structure tables, especially `structure_fuel_log`.
- Cloudflare route counts for `/api/structures/*`.
- Production row counts and average row sizes for structure tables.

### Finding 2: Fleet tracking active pages can multiply Neon traffic through polling

Severity: high.
Confidence: medium-high.

Relevant commits: `402de771`, `ca6993bd`, `a12254f0`.

Before the recent fleet tracking work, there was less live-detail surface area. After the changes, active tracking views poll multiple protected endpoints at short intervals.

Evidence:

- Active tracking detail uses 5s polling for live/session/timeline/current-member data and 15s polling for location data in [`tracking-session-detail.tsx`](/Users/mcp/projects/auth-next/apps/ui/src/client/features/fleet-tracking/routes/tracking-session-detail.tsx:343).
- Each protected core request enters global session middleware in [`session.ts`](/Users/mcp/projects/auth-next/apps/core/src/middleware/session.ts:50).
- Session validation reads the session and updates `lastActivityAt` in [`auth.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/auth.service.ts:74) and [`auth.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/auth.service.ts:89).
- Fleet access resolution calls `getTrackingSession` before many tracking endpoints in [`fleets.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/fleets.ts:713).
- `getSessionTimeline` reads multiple event sets and merges/sorts them before slicing the requested page in [`durable-object.ts`](/Users/mcp/projects/auth-next/apps/fleets/src/durable-object.ts:1537) and [`durable-object.ts`](/Users/mcp/projects/auth-next/apps/fleets/src/durable-object.ts:1728).

Mechanism that increases transfer:

- Query frequency: high, due to 5s polling.
- Repeated reads: high, because separate endpoints repeat auth/session/access checks.
- Rows returned: potentially high for timeline data, because complete event collections are transferred before pagination.
- Writes: elevated because session activity and IP tracking run on authenticated request paths.

Expected direction and rough magnitude:

```text
active viewers
x active minutes
x 12 polling cycles per minute
x protected endpoints per cycle
x auth/session queries and writes
+ fleet route queries
```

A single active viewer can generate roughly 60 protected 5-second API calls per minute plus 15-second location calls. Production viewer counts are required to convert this into transfer.

Evidence still needed:

- Cloudflare request counts by fleet tracking route.
- Neon query stats for fleet tracking tables and session tables.
- Active fleet detail page concurrency during the spike.

### Finding 3: Prediction-market reconciliation introduced new recurring Neon work

Severity: medium.
Confidence: medium.

Relevant commits: `6e75f2aa`, `86bc80d3`.

Before the prediction-market feature, this workload did not exist. Afterward, core cron invokes reconciliation every 5 minutes in [`index.ts`](/Users/mcp/projects/auth-next/apps/core/src/index.ts:218).

Evidence:

- Reconciliation has bounded close, refresh, backfill, and settlement loops in [`discord-market-reconcile.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/discord-market-reconcile.service.ts:65).
- The cron path calls market detail methods during refresh/backfill/settlement work in [`discord-market-reconcile.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/discord-market-reconcile.service.ts:130).
- `buildMarketDetails` loops market IDs and calls `buildMarketDetail`, which reads market and outcome rows separately, in [`shared.ts`](/Users/mcp/projects/auth-next/apps/prediction-markets/src/services/shared.ts:87).
- A code comment documents a duplicate-post hazard if thread creation succeeds but attachment fails, which could cause repeated backfill attempts in [`discord-market-reconcile.service.ts`](/Users/mcp/projects/auth-next/apps/core/src/services/discord-market-reconcile.service.ts:166).

Mechanism that increases transfer:

- Background execution frequency: fixed every 5 minutes.
- Query count: bounded but additive.
- Retry/reprocessing: possible if Discord-side failures leave DB state incomplete.

Evidence still needed:

- Cron invocation count per environment.
- Number of markets processed per tick.
- Discord failure logs and repeated backfill attempts.
- Neon query stats for prediction-market tables.

### Finding 4: Service access audit can scan and write across all users

Severity: medium.
Confidence: medium.

Relevant commit: `03f3d046`.

Before this change, there was no service access audit workflow. Afterward, admins can start an audit run that scans user eligibility and writes audit rows.

Evidence:

- The workflow uses `SCAN_PAGE_SIZE = 500` and `MAX_SCAN_PAGES = 500` in [`service-access-audit.workflow.ts`](/Users/mcp/projects/auth-next/apps/core/src/workflows/service-access-audit.workflow.ts:44).
- The scan loop fetches eligibility pages, enriches users, and inserts audit rows in [`service-access-audit.workflow.ts`](/Users/mcp/projects/auth-next/apps/core/src/workflows/service-access-audit.workflow.ts:251).
- The scan query is set-based and paginated in [`service-eligibility.ts`](/Users/mcp/projects/auth-next/apps/core/src/lib/service-eligibility.ts:161).
- The route prevents concurrent active runs, but repeated completed/failed runs remain possible through admin action in [`services-audit.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/services-audit.ts:74).

Mechanism that increases transfer:

- Rows scanned: proportional to user count.
- Rows written: one audit row per scanned user.
- Background retry impact: depends on Workflow attempts and failures.

Evidence still needed:

- Audit run count and status history.
- Workflow retry count.
- Audit row growth over time.

### Finding 5: DB-backed sidebar external links are globally reusable but not edge-cached

Severity: low-medium.
Confidence: high for mechanism, low for total impact.

Relevant commit: `c70792d1`.

Before this change, sidebar external links were not served from this DB-backed route. Afterward, the UI requests enabled links from core.

Evidence:

- The route creates a DB client and reads enabled links in [`navigation-links.ts`](/Users/mcp/projects/auth-next/apps/core/src/routes/navigation-links.ts:27).
- The UI uses browser-local React Query stale time, not shared edge caching, in [`sidebar-nav.tsx`](/Users/mcp/projects/auth-next/apps/ui/src/client/components/sidebar-nav.tsx:94).

Mechanism that increases transfer:

- Query frequency: one shared list can be fetched independently by every browser session.
- Result size: likely small.
- Cache gap: high, because this is a good candidate for shared cache.

Evidence still needed:

- Route count for `/api/navigation/external-links`.
- Number and width of configured links.

## 6. Cache-gap analysis

| Data/query | Current behavior | Cache suitability | Recommended cache | Suggested TTL | Invalidation strategy | Security considerations |
| ---------- | ---------------- | ----------------- | ----------------- | ------------- | --------------------- | ----------------------- |
| Structures overview | Recomputed from Neon through broad service calls | High | Cloudflare Cache API or KV after SQL reduction | 30-120s with stale-while-revalidate | Version key on structure sync/config writes | Key by tenant/user permission-scope hash and feature/config version |
| Structures tab lists | Broad visible data loaded, then filtered/sorted/paged in Worker | Medium-high | SQL-side reduction first, then Cache API/KV | 30-120s | Version on structure sync, config update, ACL update | Include tenant, permission scope, tab, filters, sort, page, page size |
| Structure fuel summaries | Fuel history rows fetched for visible structures during summaries | High | Precomputed summary table, Durable Object cache, or KV | 5-15m | Update during fuel-log ingest or bump version per structure | Scope to visible structure IDs or permission scope |
| Fleet active session bundle | Multiple endpoints polled independently | Medium | Combined endpoint plus short Durable Object/request cache | 1-5s | Natural expiry or event-driven version | Private/session-scoped; never public CDN cache raw fleet state |
| Fleet timeline | Reads complete event sets before API pagination | Medium | SQL-side pagination and optional short DO cache | 1-10s for active sessions | Natural expiry; invalidate on new event | Key by session ID plus access check result |
| Sidebar external links | DB read with browser-only 5m cache | High | Cache API or KV | 5-30m | Admin create/update/delete bumps version | Cache only for correct audience; include auth/audience dimension if needed |
| Prediction-market public lists | DB reads and aggregates on list/leaderboard paths | Medium | Cache API/KV | 30-300s | Invalidate on market/bet/settlement write | Separate public, admin, and user-specific views |
| Session/profile data | DB read on every authenticated API request | Limited | Request-scoped dedupe and short private cache where safe | Seconds to minutes | Logout/session revocation/user update | Must key by session/user and authorization scope |
| Service audit run details | DB-backed report rows after run | Medium | Cache completed run summaries/pages | 5-60m | Immutable per completed run or version by run status | Admin-only; key by admin authorization |

## 7. Duplicate-query and oversized-result analysis

Confirmed duplicate-query risks:

- Auth/session work runs on every authenticated API request, including short-interval polling paths.
- Fleet active detail uses multiple independent polling hooks, causing repeated access resolution and repeated session middleware DB work.
- Prediction-market detail building has a per-market loop that performs separate market/outcome reads.

Confirmed oversized-result risks:

- Structures list and overview paths load all visible structures and related rows before pagination.
- Structure fuel history has no visible time/sample bound in the service method.
- Fleet timeline loads member history, lifecycle events, boss changes, and ship events before merging and slicing.
- SRP recent losses applies pagination late after collecting and enriching loss data, and can scan a legacy wallet-journal window.

Potentially unnecessary row width:

- Several Drizzle `findMany` or raw select paths retrieve whole rows where only summary fields appear to be needed. The structures and fleet timeline paths are the highest-risk examples.

No confirmed server-render/client-hydration double-fetch issue was found. The UI is a React SPA using React Query; repeated browser fetching is controlled by hook stale times, but those caches are per browser only.

## 8. Background-task analysis

Relevant scheduled/background execution:

- Core cron runs every 5 minutes and now calls prediction-market reconciliation.
- Core also runs token invalid alerts, temp op expiry, market-post reconciliation, R2 export cleanup, and daily audit cleanup.
- Other apps include scheduled workers for eve corporation data, eve character data, SRP, bills, fulcrum, markets, and paste.
- Service access audit is Workflow-based and admin-triggered, not scheduled in the code reviewed.
- Fleet monitoring uses Durable Objects and recent tracking features may write or read fleet state/history during active tracking sessions.

Changes that could explain increased transfer:

- Prediction-market reconciliation is a new recurring workload.
- Fleet tracking additions can increase live request volume and history reads while sessions are active.
- Structure sync/refactor changes likely changed which structure data is loaded and how often users view it.
- Service access audit can produce a burst of reads/writes when executed.

Things requiring production metrics:

- Whether scheduled jobs are active in preview/staging as well as production.
- Whether queue or workflow retries occurred.
- Whether failed prediction-market Discord operations caused repeated processing.
- Whether fleet tracking sessions were active during the transfer spike.

## 9. Dependency and configuration analysis

No recent dependency update was identified as a confirmed cause. The current architecture uses Neon directly from Workers through Drizzle and Neon HTTP/WebSocket drivers.

Configuration observations:

- Worker configs use JSONC and `nodejs_compat`.
- Neon connection strings are referenced through environment variables/secrets, not hard-coded in the inspected code.
- No Hyperdrive binding was found.
- Several Workers have cron triggers. If multiple environments are deployed with production database credentials, scheduled jobs could multiply database traffic.

Connection pooling or Hyperdrive may improve connection management and latency in the Workers runtime, especially for WebSocket or pooled code paths. It should not be treated as a substitute for application-level result caching when identical rows are repeatedly transferred from Neon.

## 10. Estimated impact

These are formulas and illustrative calculations, not production measurements.

Structures:

```text
estimated transfer =
structure page views
x route calls per page
x (visible structure rows + config rows + tab rows + fuel log rows)
x average bytes per row
```

Illustration: if one summary call touches `500` visible structures and `24` fuel samples per structure at `100` bytes per sample, fuel samples alone are about `1.2 MB` per call before protocol and JSON overhead.

Fleet active tracking:

```text
estimated request/query pressure =
active viewers
x active minutes
x 12 polling cycles per minute
x protected endpoints per cycle
x auth/session/access DB work
```

A single active viewer can generate about 60 protected 5-second API calls per minute plus 15-second location calls. The Neon transfer impact then depends on session/profile row width, fleet timeline event count, and current member count.

Prediction-market reconciliation:

```text
estimated daily work =
288 cron ticks per day per environment
x bounded close/refresh/backfill/settlement queries
x per-market detail queries
```

Impact grows if many markets are eligible every tick or if Discord failures leave work retried.

Service access audit:

```text
estimated work per run =
ceil(user_count / 500) scan pages
+ enrichment queries
+ user_count audit-row inserts
+ aggregate summary queries
```

Impact is bursty and depends on admin runs and Workflow retries.

## 11. Recommended remediation plan

### Immediate

Measure top SQL and route traffic before changing code. Expected benefit: confirms the cause and avoids optimizing the wrong path. Risk: low. Complexity: low. Files likely to change: none if existing dashboards/logs are sufficient. Metrics that should identify the issue: Neon rows returned, query calls, transfer, and Cloudflare route counts.

Specifically inspect:

- Neon top queries involving structure tables and `structure_fuel_log`.
- Neon top queries involving fleet tracking/session tables.
- Cloudflare route counts for `/api/structures/*` and `/api/fleets/tracking/*`.
- Core cron invocation counts and prediction-market reconcile logs.
- Service access audit workflow run and retry counts.

### Near term

Move structures filtering, sorting, pagination, and projections into SQL. Bound or precompute fuel summaries. Expected benefit: large reduction in rows transferred. Risk: medium, due to permission-sensitive structure visibility. Complexity: medium-high. Files likely to change: `apps/structures/src/services/structures.service.ts`, `apps/core/src/routes/structures.ts`, related tests. Test strategy: route parity tests, permission isolation tests, pagination/sort/filter tests. Metrics that should improve: rows returned and transfer for structure queries.

Add shared caching for structures after SQL reduction. Use keys including tenant, user permission-scope hash, tab, filters, sort, page, page size, and config/data version. Expected benefit: fewer repeated identical reads. Risk: stale or unauthorized structure data if keyed incorrectly. Complexity: medium. Metrics that should improve: cache hit rate, Neon query calls, Worker subrequest latency.

Combine fleet active-session polling into fewer endpoints and move timeline pagination into SQL. Expected benefit: fewer requests, fewer repeated auth checks, fewer timeline rows transferred. Risk: medium, because live fleet data is sensitive and freshness matters. Complexity: medium. Files likely to change: `apps/core/src/routes/fleets.ts`, `apps/fleets/src/durable-object.ts`, fleet tracking UI hooks. Metrics that should improve: API calls per active viewer-minute and fleet-table rows returned.

Throttle session `lastActivityAt` and IP tracking writes. Expected benefit: lower write amplification on polling-heavy pages. Risk: low-medium, depending on session activity semantics. Complexity: low-medium. Files likely to change: `apps/core/src/services/auth.service.ts`, `apps/core/src/lib/ip-tracking.ts`. Metrics that should improve: session and user-IP writes per request.

Cache sidebar external links with Cache API or KV. Expected benefit: remove a globally reusable nav query from common page views. Risk: low if audience is keyed correctly. Complexity: low. Files likely to change: `apps/core/src/routes/navigation-links.ts` and admin mutation invalidation code. Metrics that should improve: calls to sidebar link query.

Batch prediction-market detail loading. Expected benefit: reduce per-market N+1 reads during reconciliation and list/detail enrichment. Risk: low-medium. Complexity: medium. Files likely to change: `apps/prediction-markets/src/services/shared.ts`, reconcile/read service tests. Metrics that should improve: prediction-market query calls per cron tick.

### Longer term

Evaluate Hyperdrive for Cloudflare-to-Neon connection management. Expected benefit: better connection reuse and latency. Risk: operational config complexity. Complexity: medium. Metrics that should improve: connection churn, latency, timeout/retry rates.

Add route-level DB budgets and observability. Expected benefit: future regressions become visible before Neon transfer spikes. Risk: low if values are aggregated and secrets are not logged. Complexity: medium. Metrics that should improve: time to detect high-query routes.

Separate production, staging, and preview scheduled execution where possible. Expected benefit: prevents duplicated background traffic against production Neon. Risk: deployment complexity. Complexity: medium. Metrics that should improve: cron/workflow invocations against production database.

## 12. Verification plan

Before remediation:

- Capture 24-72 hours of Neon data transfer, query count, rows returned, rows written, active connections, slow queries, and top queries.
- Capture Cloudflare Worker route counts, cron invocations, Workflow attempts, Queue retries, subrequest counts, and cache hit/miss data.
- Segment by route family and deployment time.

After each fix:

- Compare the same metrics over a similar traffic window.
- Confirm cache hits via `CF-Cache-Status`, cache-specific logs, or explicit internal metrics.
- Confirm query-count and row-count reduction in Neon.
- Run representative load tests for structures page loads and fleet active-session viewing.
- Validate authorization isolation with at least two users whose structure/fleet visibility differs.

Rollback criteria:

- Increased 5xx or auth/permission errors.
- Evidence of stale private data or cross-tenant/cross-user data exposure.
- Incorrect pagination, counts, sorting, or fleet timeline order.
- Cache invalidation failures after structure config or market/fleet updates.

Suggested observation window:

- At least one normal weekday.
- Include one known fleet/event peak if fleet tracking is suspected.
- Include at least one full cron cycle set for prediction-market reconciliation.

Safe PostgreSQL checks, if `pg_stat_statements` is available on Neon:

```sql
select extname
from pg_extension
where extname = 'pg_stat_statements';

select query, calls, rows, total_exec_time, mean_exec_time
from pg_stat_statements
order by rows desc
limit 20;

select query, calls, rows, total_exec_time, mean_exec_time
from pg_stat_statements
where query ilike '%structure_fuel_log%'
   or query ilike '%fleet_member%'
   or query ilike '%fleet_tracking%'
   or query ilike '%prediction%'
order by rows desc
limit 20;
```

Safe row-size sampling examples:

```sql
select count(*)
from structure_fuel_log;

select avg(pg_column_size(t))
from (
	select *
	from structure_fuel_log
	limit 10000
) as t;
```

Do not share raw query text publicly if it contains sensitive literals. Scrub tokens, connection strings, IDs, and private user data from exported logs.

## 13. Unknowns and required access

The following cannot be determined from the repository alone:

- Neon dashboard transfer timeline.
- Neon top queries by calls, rows, execution time, and transfer.
- Whether `pg_stat_statements` is enabled.
- Table row counts and average row sizes in production.
- Cloudflare route-level request volume.
- Worker invocation counts by environment.
- Cron, Queue, Workflow, and Durable Object retry counts.
- Cache hit/miss rates in production.
- Production deployment timeline and environment topology.
- Whether preview or staging deployments use the production Neon database.
- Actual structures page usage, active fleet session concurrency, and prediction-market activity during the spike.

Final verdict:

```text
Most likely cause:
Structures list/overview endpoints repeatedly fetching broad Neon result sets, especially fuel history, without shared caching or SQL-side pagination.

Confidence:
High for the code mechanism; medium-high that it explains the production spike until Neon/Cloudflare metrics confirm volume.

Why:
Recent structures commits materially changed this area, and current code loads all visible structures plus related history/config data before slicing results.

Relevant change:
5a7658fc, 05a37a6b, dd47a73b, 592d1830 touching structures service/routes/UI.

Recommended first action:
Pull Neon top queries by calls/rows and Cloudflare route counts for /api/structures over the 2026-06-21 to 2026-07-21 window.

Metric needed to confirm:
A post-deploy rise in calls/rows/transfer for structure tables, especially structure_fuel_log, correlated with /api/structures route traffic.
```
