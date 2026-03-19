# User Refresh Pipeline

This document describes the current end-to-end user refresh flow in `core`, including:
- link-time hydration + immediate role reconciliation
- workflow-driven character refresh + role reconciliation
- retries, isolation behavior, and known deferred items

## High-Level Flow

### Immediate path (link-time)

| Step | Input | Side effects | Failure handling | Output |
| --- | --- | --- | --- | --- |
| Link or create character record | Auth callback / claim-main / link-character | Inserts or updates `user_characters` | Request fails on hard validation/security failures | Character linked to user |
| Hydrate affiliation (`GET /characters/{id}`) | `characterId` | Persists `characterName`, `corporationId`, `allianceId`, `lastCharacterRefresh`, `isDeleted=false` | Logged on failure; flow continues | Authoritative affiliation IDs in DB |
| Resolve names (best effort) | `corporationId`, `allianceId` | Updates `corporationName` / `allianceName` | Background warning only | Human-readable names |
| Immediate core role reconcile | `userId` | Atomic replace of core corp/alliance memberships; clears role cache | Logged on failure; flow continues | Fresh role attachments |
| Queue manual refresh workflow | `userId` | Creates `USER_REFRESH_WORKFLOW` instance | Logged on failure | Deferred full refresh |

### Workflow path (`USER_REFRESH_WORKFLOW`)

| Step | Input | Side effects | Retry/Timeout | Failure handling | Output |
| --- | --- | --- | --- | --- | --- |
| `check-user-blacklisted` | `userId` | Reads blacklist state | default | Workflow continues | `isBlacklisted` |
| `disable-blacklisted-user` (conditional) | `userId` | Disables user if blacklisted | default | Throws on hard failure | Disabled user state |
| `fetch-user-characters` | `userId` | Reads character set | default | Throws on hard failure | Character list |
| Character refresh pool (concurrency 5) | Character list | Runs character-scoped steps in parallel | per-character (below) | Character failures are isolated | Per-character outcomes |
| `update-character-public-info-{characterId}` | Character ID | Refreshes affiliation fields | 5 retries, exp backoff, 1m timeout | On terminal failure, classified and recorded | Refreshed char or deleted signal |
| `handle-character-deleted-{characterId}` (conditional) | Character ID | Marks character deleted | 5 retries, exp backoff, 1m timeout | Failure isolated to character | Deleted marker persisted |
| `try-character-authenticated-fetch-{characterId}` | Character ID | Validates token via authenticated fetch, updates token validity | 5 retries, exp backoff, 1m timeout | Failure isolated to character | Auth fetch success/error |
| `get-user-role-attachments` | `userId` | Observability read of current roles | 3 retries, exp backoff, 30s timeout | Best effort; does not block attach | Pre-attach role snapshot |
| `attach-user-roles` | `userId` | Atomic core role reconciliation | 3 retries, exp backoff, 30s timeout | Throws on terminal failure | Updated corp/alliance attachments |
| `update-completion-timestamp` | `userId` | Updates workflow completion markers | default | Throws on hard failure | Completion state |

## Trigger Points

### 1. Auth callback (character flow)
- Route: `GET /auth/callback` with `flowType === 'character'`
- If character is linked to same user:
  - still runs link-time hydration + immediate role reconcile
- If character is newly linked:
  - links character
  - runs link-time hydration + immediate role reconcile
  - schedules manual `USER_REFRESH_WORKFLOW`

### 2. Claim main
- Route: `POST /auth/claim-main`
- Creates user + primary character
- runs link-time hydration + immediate role reconcile
- schedules manual `USER_REFRESH_WORKFLOW` (background path already present)

### 3. Direct link-character endpoint
- Route: `POST /auth/link-character`
- links character
- runs link-time hydration + immediate role reconcile
- schedules manual `USER_REFRESH_WORKFLOW`

## Link-Time Hydration (Immediate Path)

Service: `character-affiliation-hydration.service.ts`

Behavior:
1. Fetches authoritative public info (`fetchCharacterPublicInfo`) with `cacheMode: 'no-store'`.
2. Synchronously persists:
   - `characterName`
   - `corporationId`
   - `allianceId`
   - `lastCharacterRefresh`
   - `isDeleted = false`
3. Best-effort background resolution of `corporationName` / `allianceName` via `ESI_TYPE_RESOLVER` (`waitUntil`).

Result:
- New links no longer wait for a later workflow run to obtain corp/alliance IDs.

## Immediate Role Reconciliation (Post-Link)

Service: `core-role-reconciliation.service.ts`

Behavior:
1. Defensive role seeding (`batchCreateRoles`) for core roles.
2. Reads non-deleted user characters from `CoreDO.getUserCharacters(userId)`.
3. Builds unique desired targets:
   - `core:corp-member` for each unique `corporationId`
   - `core:alliance-member` for each unique `allianceId`
4. Calls atomic Groups RPC:
   - `replaceCoreMembershipRolesForUser({ userId, roles })`
5. Clears user role cache.

## Workflow Path (`USER_REFRESH_WORKFLOW`)

File: `apps/core/src/workflows/user-refresh.workflow.ts`

### Step sequence
1. `check-user-blacklisted`
2. `disable-blacklisted-user` (conditional)
3. `fetch-user-characters`
4. Per-character refresh pool (`concurrency = 5`)
5. `get-user-role-attachments` (best effort; failure does not block attach)
6. `attach-user-roles`
7. `update-completion-timestamp`

### Per-character execution model
For each character (isolated):
1. `update-character-public-info-{characterId}`
2. If deleted: `handle-character-deleted-{characterId}`
3. Else: `try-character-authenticated-fetch-{characterId}`

Character outcomes are collected as:
- `success`
- `deleted`
- `transient_failed_after_retries`
- `permanent_failed`

A single character failure does not fail the whole workflow.

## Retry / Timeout Semantics

Character steps:
- retries: `limit=5`, `delay=10 seconds`, exponential backoff
- timeout: `1 minute`

Role steps:
- retries: `limit=3`, `delay=5 seconds`, exponential backoff
- timeout: `30 seconds`

`get-user-role-attachments` is explicitly best effort.

## Role Attachment Semantics

Groups role replacement API:
- transactionally computes diff for core membership roles only
- inserts missing desired attachments
- removes stale core membership attachments
- leaves non-core role attachments untouched
- returns summary counts: `desiredCount`, `attachedCount`, `detachedCount`

## Deleted Character Handling

`update-character-public-info` treats these as deleted signals:
- typed `CharacterDeletedError`
- known deleted message variants

On successful public refresh, `isDeleted` is reset to `false`.

## Current Limits and Deferred Work

Implemented now:
- per-user character refresh concurrency cap (`5`)
- per-character isolation and retries

Deferred:
- global/shared ESI budget coordinator across all workflows and callers
- workflow-level integration tests for parallel step orchestration
