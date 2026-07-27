# Moon Scan Utilisation Roadmap

Date: 2026-07-22

## Scope

This roadmap covers Moon Scan database and Worker utilisation only.

Out of scope:

- Structures work. Another owner is already handling that area.
- General auth/session optimisation, except where Moon routes amplify it.
- Product changes to Moon Scan functionality that are not needed for utilisation.

## Current State

Moon Scan is not in the same risk category as Structures because verified moon list reads already have a summary read model and SQL-side pagination through `MoonScanDO.getVerifiedMoonPage`.

The remaining pressure points are narrower:

- Profit sorting on verified moons falls back to full verified-moon hydration before pagination.
- The normal verified-moons route performs request-time summary consistency checks and lazy backfill.
- Region and system map endpoints compute coverage from broad moon ID sets.
- CSV export repeats pricing/material input work per page.
- The UI can amplify these routes through per-keystroke search and 5-second export polling.

## Success Criteria

- `/api/moon-scan/moons/verified` never scans all verified moon IDs during normal list requests.
- Profit sorting uses SQL pagination or a precomputed read model, not full Worker-side hydration.
- Region overview and region detail no longer transfer all scanned/verified moon IDs per request.
- CSV export reuses pricing inputs across pages within a run.
- UI search generates at most one API request per debounce window.
- Moon-specific route logs expose path choice, row counts, page counts, and duration.
- Neon top-query data shows lower rows returned and transfer for Moon Scan routes after rollout.

## Phase 0: Measurement First

Goal: prove the hot paths in production before changing behaviour.

Tasks:

- Add structured timing logs or metrics for `/moons/verified`.
- Record whether the request used:
  - summary-page path
  - lazy summary backfill
  - profit-sort/full-hydration path
  - fallback legacy hydration after summary failure
- Record request parameters that affect cost:
  - `sortBy`
  - `page`
  - `pageSize`
  - presence of `regionId`, `constellationId`, `rarity`, `search`
- Record workload sizes:
  - verified moon ID count
  - summary missing count
  - page moon count
  - composition count
  - ore type count
  - material type count
  - export page count
- Add comparable metrics for:
  - `/moons/regions`
  - `/moons/region/:regionId`
  - `/moons/system/:systemId`
  - `/moons/verified/export`
  - `/moons/verified/export/:workflowInstanceId`

Acceptance:

- We can answer which Moon route accounts for the most Worker CPU, DB rows returned, and repeated calls.
- We can distinguish normal summary-page traffic from profit-sort and fallback traffic.

## Phase 1: Remove Request-Time Summary Backfill

Goal: keep the verified moon summary table fresh without doing global checks on reads.

Problem:

- The verified-moons route calls `getScanSummary()` and `getVerifiedMoonSummaryIds()` before paginated reads.
- `getScanSummary()` returns all scanned and verified moon IDs.
- `getVerifiedMoonSummaryIds()` returns all summary moon IDs.
- Missing summaries are backfilled inline during user requests.

Tasks:

- Move summary creation/update to the write paths:
  - `submitScans(..., autoVerify: true)`
  - `verifyScan`
  - `verifyScans`
- Add a dedicated backfill workflow or admin maintenance endpoint for historical gaps.
- Remove the global summary ID comparison from `/moons/verified`.
- Keep a defensive fallback for summary read failures, but log it as exceptional.
- Add a summary freshness check that can be run manually or on a schedule without blocking user reads.

Acceptance:

- A normal verified-moons page request performs one count query, one paginated summary query, and page-scoped composition/pricing work only.
- New verified scans appear in `moon_verified_moon_summaries` immediately or through an explicit async job.
- There is no per-request read of all verified moon IDs.

## Phase 2: Precompute Profit For SQL Sorting

Goal: make `metenoxProfit` and `tataraProfit` sorting as cheap as other verified moon sorts.

Problem:

- Sorting by profit currently hydrates every verified composition.
- The Worker computes profitability for all verified moons, filters/sorts in memory, then slices the page.

Recommended model:

- Add profit fields to `moon_verified_moon_summaries`, or create a companion `moon_verified_moon_profit_summaries` table.
- Store:
  - `moonId`
  - `metenoxProfit`
  - `tataraProfit`
  - `profitCalculatedAt`
  - `pricingSnapshotAt`
  - `settingsVersion` or equivalent invalidation marker
- Index:
  - `metenoxProfit`
  - `tataraProfit`
  - common compound filters such as `regionId, metenoxProfit` and `regionId, tataraProfit` if query plans need them.

Tasks:

- Extract the existing profit calculation into reusable server-side logic.
- Add migration for the profit read model.
- Update profit summaries when:
  - a scan is verified
  - extraction settings change
  - structure profiles change
  - market pricing snapshot changes or a scheduled refresh runs
- Extend `getVerifiedMoonPage()` to support profit sort columns.
- Remove the profit-sort legacy hydration path.

Acceptance:

- Profit sorting uses paginated SQL queries.
- The number of compositions loaded for a verified page is bounded by `pageSize`.
- Profit values are clearly timestamped so stale data is visible and debuggable.

## Phase 3: Coverage Aggregates For Map Routes

Goal: avoid broad scanned/verified moon ID transfer for region and system map views.

Problem:

- `/moons/regions` reads all scanned and verified moon IDs, then maps them to regions in Worker code.
- `/moons/region/:regionId` resolves every moon in the region and calls `getMoonCoverage()` for the whole set.
- `/moons/system/:systemId` is smaller but uses the same coverage method.

Recommended model:

- Maintain a coverage read model keyed by moon ID, system ID, and region ID.
- At minimum, expose aggregate DO methods:
  - `getRegionCoverageSummary(regionIds: string[])`
  - `getSystemCoverageSummary(systemIds: string[])`
  - `getMoonCoverage(moonIds: string[])` for small detail views only

Tasks:

- Add or derive fields for:
  - scanned moon count by region
  - verified moon count by region
  - scanned moon count by system
  - verified moon count by system
- Update coverage aggregates on scan submit, verify, and reject.
- Add a repair/backfill job for aggregate correctness.
- Use aggregate methods in:
  - `/moons/regions`
  - `/moons/region/:regionId`
  - `/moons/system/:systemId` where useful

Acceptance:

- Region overview does not transfer every scanned or verified moon ID.
- Region detail computes per-system counts from aggregate data, not by checking every moon ID against scan tables.
- Backfill can rebuild aggregates from source tables.

## Phase 4: Shared Caching For Stable Moon Reads

Goal: reduce repeated Worker and DB work across users, browsers, isolates, and regions.

Candidate routes:

- `/moons/regions`
- `/moons/region/:regionId`
- `/moons/system/:systemId`
- `/leaderboard`
- `/moons/verified` for non-sensitive, permission-gated result pages

Cache strategy:

- Always perform permission checks before returning cached protected data.
- Key cached data by route, query params, and a Moon data version.
- Use short TTLs first:
  - regions: 5-15 minutes
  - region detail: 1-5 minutes
  - system detail: 1-5 minutes
  - leaderboard: 1-5 minutes
  - verified list pages: 1-5 minutes after summary/profit read models are fixed
- Invalidate or version-bump on submit, verify, reject, settings update, and profit refresh.

Acceptance:

- Repeat requests for stable Moon pages avoid repeated Neon reads after permission check.
- Cache keys cannot leak data across permission scopes.
- Metrics show cache hit/miss rates by route.

## Phase 5: CSV Export Efficiency

Goal: keep export bounded and avoid repeated per-page pricing work.

Current strengths:

- Export requires `regionId` or `constellationId`, so it is scoped.
- Export streams to R2 instead of building one large response body.

Problems:

- Each export page calls `getVerifiedMoonPage()`.
- Each page then loads page compositions and calls pricing/material helpers.
- Settings, profiles, type names, materials, and market prices can be repeated across pages.

Tasks:

- Build export-level pricing inputs once per workflow run where possible.
- Cache `getMoonPricingInputs` by ore type set and pricing timestamp within the workflow.
- Reuse settings and structure profiles across pages.
- Add export metrics:
  - page count
  - row count
  - composition count
  - pricing lookup count
  - elapsed duration
- Consider using the profit read model for the CSV profit columns, then fetch ore detail only for row expansion.

Acceptance:

- Export pricing/material lookup count is not proportional to page count when inputs are unchanged.
- Large scoped exports complete with predictable page-level work.
- Export status polling does not dominate auth/session traffic.

## Phase 6: UI Request Throttling

Goal: reduce unnecessary protected API calls from the Moon UI.

Tasks:

- Debounce scanned-moon search input by 300-500ms.
- Keep `page` reset local, but only send the debounced search value to `useScannedMoons`.
- Back off export status polling:
  - start at 2-5 seconds
  - increase interval for long-running exports
  - stop immediately on terminal status
- Consider a lightweight status endpoint or session-activity throttle if export polling shows up in auth/session metrics.

Acceptance:

- Typing a search term does not issue one request per keystroke.
- Long-running exports produce fewer protected status requests.
- Existing React Query stale windows remain intact.

## Rollout Plan

1. Ship Phase 0 metrics.
2. Validate production route mix for at least one normal traffic window.
3. Ship Phase 6 UI throttling as a low-risk quick win.
4. Ship Phase 1 summary write-path updates and remove read-time backfill.
5. Ship Phase 2 profit read model behind metrics and compare results with current live calculation.
6. Ship Phase 3 coverage aggregates and route rewrites.
7. Add shared caching after the read models are stable.
8. Optimise export internals once profit summaries are available.

## Risks And Mitigations

- Risk: profit values become stale.
  - Mitigation: store calculation timestamps and refresh version markers.

- Risk: aggregate coverage counts drift.
  - Mitigation: keep source tables authoritative and provide a rebuild job.

- Risk: cached protected data leaks across access scopes.
  - Mitigation: permission-check before cache reads and key by access scope where needed.

- Risk: removing lazy summary backfill hides historical gaps.
  - Mitigation: create an explicit backfill workflow before removing the read-time path.

- Risk: migration exists but production table was created by the runtime initializer without indexes.
  - Mitigation: verify `0001_wandering_bloodstorm.sql` is applied in production and check query plans.

## Production Evidence To Collect

- Neon top queries for Moon tables by calls, rows returned, and transfer.
- Cloudflare route counts for `/api/moon-scan/*`.
- Worker CPU duration by Moon route.
- DO RPC counts for:
  - `getScanSummary`
  - `getVerifiedMoonSummaryIds`
  - `getVerifiedMoonPage`
  - `getVerifiedCompositions`
  - `getMoonCoverage`
- Count of verified moons and scanned moons over time.
- Export workflow frequency, duration, and row counts.

## Expected Impact

Highest expected impact:

- Removing profit-sort full hydration.
- Removing request-time summary backfill.
- Replacing region coverage scans with aggregate counts.

Medium expected impact:

- Export pricing reuse.
- Shared caching for region/system/leaderboard pages.

Low-risk quick wins:

- Search debounce.
- Export polling backoff.
- Metrics for route path choice and workload sizes.
