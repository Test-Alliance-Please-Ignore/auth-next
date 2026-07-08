# Prediction Markets — Content Moderation (Design)

**Status:** Draft / Proposed
**Date:** 2026-07-07
**Scope:** Moderating the free-text content of member-created prediction markets.
**Related:** non-admin market creation (PR #463), creation guardrails — rate limit + economic-param clamping (PR #464). This doc covers the remaining `Phase 3` guardrail.

---

## Table of Contents

- [Context & Problem](#context--problem)
- [Goals / Non-Goals](#goals--non-goals)
- [What Exists Today](#what-exists-today)
- [Options Considered](#options-considered)
- [Recommendation](#recommendation)
- [Implementation Sketch](#implementation-sketch)
- [Phasing](#phasing)
- [Open Decisions](#open-decisions)
- [Risks & Limitations](#risks--limitations)
- [Future Work](#future-work)

---

## Context & Problem

Members holding the `urn:markets:creator` tier can now create prediction markets (PR #463). A market's
**free-text `question`, `description`, and `outcome` labels** are posted **immediately** to a public
forum channel — `createMarket` sets `status: 'open'` (`apps/prediction-markets/src/durable-object.ts`),
and `createAndPublishMarket` publishes the forum thread synchronously. There is **no review gate**.

**Risk:** offensive, abusive, harassing, NSFW, or doxxing text reaches the channel before any moderator
sees it.

**Mitigating context that shapes the right answer:**

- Creators are an **admin-granted, semi-trusted cohort** — not the open internet.
- The forum is an **internal** corp/alliance Discord (known membership).
- Every market is **attributable** (`createdBy`) and the **creator tier is revocable**.

That argues against heavy prevention machinery and for **fast, clean takedown + accountability** as the
primary control, with cheap prevention as a speed bump.

---

## Goals / Non-Goals

**Goals**

- Give moderators a fast, clean way to **remove** an inappropriate market (text gone from the channel,
  bettors refunded, action audited).
- Catch the **obvious** bad content automatically, at create time, without friction for clean content.
- Preserve the existing trust hierarchy: managers/admins are unaffected; only lower-trust `creator`
  submissions are filtered.

**Non-Goals (v1)**

- Perfect prevention of all inappropriate text (infeasible for free text; see [Limitations](#risks--limitations)).
- A full pre-publish moderation queue (kept as an optional escalation, not the default).
- AI/ML moderation (a clean future upgrade behind the same seam).

---

## What Exists Today

| Capability | State | Relevance |
| --- | --- | --- |
| `draft` market status + `draft → open` / `draft → voided` transitions | Exists (`lib/state-machine.ts`), unused by `createMarket` | Enables a pre-publish review path if we ever want Option 2 |
| `voidMarket` | Refunds all bets, archives + locks the thread, applies the Voided tag | **Not a takedown** — the offensive text stays visible in the archived thread |
| Discord DO forum methods | `createMarketForumPost`, `updateMarketPostMessage`, `lockThread`, `deleteMessage` | No `deleteThread` yet — a real takedown needs `DELETE /channels/{threadId}` |
| `urn:markets:manager` tier + P3 forum-button pattern | Exists | The moderator role + the UI pattern to hang a "Remove" button on |
| Audit log (`pm_market_history`, `visibility: 'internal'`) | Exists | Where takedowns/rejections get recorded |

Key gap: **Void ≠ takedown.** Void keeps the thread (locked/archived); removing offensive content
requires deleting the thread channel.

---

## Options Considered

| # | Option | Prevents bad content? | Creator friction | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Reactive takedown only** | No — removes after the fact | None | Low–Med |
| 2 | **Pre-publish approval** (`draft` → manager approves → publish) | Yes — nothing publishes unreviewed | High (every market waits on a human) | Med–High |
| 3 | **Automated filter at create** (blocklist / AI moderation) | Partial — catches the obvious | None for clean text | Med |
| 4 | **Hybrid: cheap auto-filter + reactive takedown** | Catches obvious + removes the rest fast | None | Med |

---

## Recommendation

**Option 4 — Hybrid (cheap automated pre-filter + reactive takedown).**

Full pre-publish approval (Option 2) is real friction and a moderation queue that is overkill *until abuse
actually materializes* in a semi-trusted, known-membership community. The pragmatic stack:

**A. Cheap automated pre-filter (create time, creators only).** A configurable **blocklist**
(case-insensitive, word-boundary phrases) applied to `question` + `description` + `outcomes` inside the
create flow; reject with a coded error → HTTP 400. Managers/admins bypass (same tier split as the
economic-param clamping). A list, **not** an AI call, for v1 — no latency/cost/external dependency.

**B. Reactive takedown — the actual backstop (manager-gated).** A **"Remove market"** action distinct
from Void: void the market (refund everyone — reuse `voidMarket`) **and delete the Discord thread** so the
text is gone, not just locked. Audit-logged with moderator + reason.

**C. Report affordance (optional).** A "Report" button on the post (visible to all) that logs a report /
pings the manager group, so the community flags what moderators miss.

**D. Accountability (already present, the real deterrent).** Markets are attributable and the creator tier
is revocable; combined with fast takedown, a repeat offender loses the ability to create. In a
known-membership community this deters abuse more than any text filter.

---

## Implementation Sketch

### A. Blocklist pre-filter

- Add `moderateMarketText({ question, description, outcomes })` (pure, unit-testable) that scans for
  blocklisted phrases (case-insensitive, `\b` word boundaries) and returns the first offending term or
  `null`.
- Call it in the **member create path only** (creators; managers/admins bypass, mirroring the tier split
  already in `apps/core/src/routes/prediction-markets.ts`). On a hit, throw/return a coded
  `MARKET_CONTENT_REJECTED` → 400 with a generic "your market contains disallowed content" message (do
  **not** echo the matched term).
- **Blocklist source:** see [Open Decisions](#open-decisions) — a core `vars` entry or a small config row
  is preferred over a code constant so it's tunable without a deploy.

### B. Takedown (highest value — build first)

- **Discord DO:** new `deleteThread(threadId): Promise<{ success; error? }>` → `DELETE /channels/{threadId}`
  (mirrors the other forum methods; best-effort with `{success,error}`).
- **Core service:** a `removeMarket(db, env, actorUserId, marketId, reason)` that:
  1. `voidMarket({ actorUserId, marketId, reason })` (refunds; reuses the existing, adversarially-reviewed
     void path);
  2. `deleteThread(discordThreadId)` (best-effort — the void already stands if Discord fails);
  3. logs a `pm_market_history` row (`action: 'removed'`, `visibility: 'internal'`, moderator + reason).
- **Permission gate:** `hasMarketPermission(env, userId, 'manager', isAdmin)` (managers/admins only), same
  server-side pattern as the resolver gate in `discord-components.service.ts`.
- **Surfaces (reuse existing patterns):**
  - a manager **"Remove" button** on the forum post (P3 button pattern — `mkt:remove:<marketId>` custom id,
    deferred component, opens a reason modal); and/or
  - a **Remove action** in the admin/manager markets UI.

### C. Report button (optional)

- A `Report` button (visible to all) on the post → records a lightweight report (a history row or a ping
  to the manager group). No refund/state change. Low effort; defer if not needed.

### Audit & error hygiene

- Takedown/rejection are **expected** outcomes — add `MARKET_CONTENT_REJECTED` to the create path's
  bad-request set (400, not 500) and keep takedown errors out of Sentry (like the existing resolver
  expected-error allowlist).

---

## Phasing

1. **Takedown** (B) — the highest-value piece; gives moderators real teeth immediately. `deleteThread` +
   `removeMarket` + a manager-gated button, audit-logged.
2. **Blocklist filter** (A) — cheap add once the create seam exists.
3. **Report button** (C) — optional.
4. **Pre-publish approval** (Option 2) — only if reactive moderation proves insufficient; a larger,
   separate effort built on the existing `draft` state (create-as-draft for creators → manager review
   queue → approve/publish or reject).

---

## Open Decisions

1. **First pass: takedown alone, or takedown + blocklist?** (Recommended: both — B then A.)
2. **Where is the blocklist configured?** Options: a code constant (simplest, needs a deploy to change),
   a core `vars` entry (tunable per env, no deploy), or a DB config row an admin edits in the UI (most
   flexible, most work). Recommended: `vars` for v1.
3. **Does takedown hard-delete the thread, or delete-and-repost a tombstone?** (Recommended: hard delete —
   simplest and fully removes the content; the audit row preserves the record.)
4. **Should `creator`-tier submissions ever require pre-publish approval** (Option 2 as a per-config or
   sub-tier escalation), or is reactive-only acceptable to start? (Recommended: reactive-only to start.)

---

## Risks & Limitations

- **Blocklists are evadable.** Creators can spell around a word list; it is a speed bump for the obvious,
  **not** the real defense. Do not oversell it. The real controls are takedown + tier revocation.
- **Reactive means a window of exposure.** Between publish and takedown, offensive content is visible.
  Acceptable given the semi-trusted cohort; unacceptable communities should adopt Option 2.
- **Thread deletion is destructive + best-effort.** If the Discord delete fails after the void, the market
  is still voided/refunded but the thread lingers — the audit row + a retry/monitor (or the existing
  reconcile sweep) should flag it.
- **False positives** from an aggressive blocklist frustrate legit creators — keep the list conservative
  and the reject message generic-but-actionable.

---

## Future Work

- **AI/LLM moderation** at create time (a moderation-endpoint call) behind the same `moderateMarketText`
  seam — better recall than a blocklist, at the cost of latency/dependency/cost.
- **Pre-publish approval** (Option 2) as an opt-in escalation on the existing `draft` state.
- **Reputation/auto-trust:** promote long-clean creators to reduced filtering; auto-suspend on repeated
  takedowns.
