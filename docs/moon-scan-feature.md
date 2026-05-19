# Moon Scan Feature

Last updated: 2026-05-18

## Overview

Moon Scan tracks player-submitted moon composition scans, supports validator workflows, and computes profitability using live market data plus configurable extraction settings.

Primary user-facing surfaces:
- Region/system/moon exploration
- Verified moon catalog with profitability snapshots
- Scan submit + personal history
- Validation queue
- Leaderboard
- Admin settings for extraction and structure profiles

## Architecture

### Core API Layer (`apps/core/src/routes/moon-scan.ts`)
- Exposes all HTTP routes under `/api/moon-scan`.
- Enforces permissions via URNs from Groups permissions cache.
- Joins data from:
  - `MOON_SCAN` Durable Object (scan records + settings)
  - `UNIVERSE` Durable Object (static moon/system/region/type-material data)
  - `MARKETS` Durable Object (batch market prices)

### Moon Scan Durable Object (`apps/moon-scan/src/durable-object.ts`)
- Owns scan persistence and verification state.
- Stores:
  - submitted scans and ore rows
  - verified composition per moon
  - leaderboard data source
  - extraction settings + structure profiles
  - character name cache

### Shared Libraries
- `@repo/moon-scan`:
  - scan TSV parser
  - moon-scan RPC interface types
  - feature-owned ore rarity mapping (`ORE_TYPE_RARITY`)
- `@repo/universe`:
  - canonical static moon type IDs and Universe RPC types

## Core Feature Rules

1. Eligibility:
   - Only k-space regions are included (wormhole + Pochven excluded).
   - Only systems with `securityStatus < 0.6` are eligible for scan submission/profitability workflows.

2. Scan lifecycle:
   - Submitter with `urn:moons:validate` auto-verifies submitted scans.
   - Validators can explicitly verify/reject pending scans.
   - Verified composition is maintained as one active composition per moon (`moon_verified_compositions`).

3. Profitability:
   - Uses Universe `typeMaterials` per ore, live market prices, and structure profiles.
   - Supports admin override prices:
     - `fuelBlockPriceOverride`
     - `magmaticGasPriceOverride`
   - Override price takes precedence when a valid positive numeric value is set.

4. Batch/caching patterns:
   - Region detail uses `getMoonsBySystemIds` (batched).
   - System detail uses `getVerifiedCompositions` (batched).
   - Universe DO caches static/batch lookups for repeated data access.

## Data Model (Moon Scan DB)

Defined in `apps/moon-scan/src/db/schema.ts`:
- `moon_scans`
- `moon_scan_ores`
- `moon_verified_compositions`
- `moon_extraction_settings`
- `moon_structure_profiles`
- `moon_character_name_cache`
- Enums:
  - `moon_scan_status` (`pending`, `verified`, `rejected`)
  - `moon_scan_source` (`user`, `system`)

## Permission URNs

- `urn:moons:view`
- `urn:moons:submit`
- `urn:moons:validate`
- `urn:moons:admin`

Global behavior:
- All moon-scan API routes also require authenticated alliance member context (`requireAllianceMember()` middleware).
- Site admin (`user.is_admin`) bypasses moon URN checks.

## Permissions Access Matrix

| Capability | API / Surface | Required Access | Notes |
| --- | --- | --- | --- |
| View region overview/map stats | `GET /api/moon-scan/moons/regions` | `urn:moons:view` or site admin | Includes scan/verified counts and region graph links |
| View region detail | `GET /api/moon-scan/moons/region/:regionId` | `urn:moons:view` or site admin | Region must be k-space |
| View system detail | `GET /api/moon-scan/moons/system/:systemId` | `urn:moons:view` or site admin | Returns moon coverage + verified compositions |
| View verified moons list | `GET /api/moon-scan/moons/verified` | `urn:moons:view` or site admin | Includes profitability snapshot fields |
| View single moon detail + profitability | `GET /api/moon-scan/moons/:moonId` | `urn:moons:view` or site admin | Includes scans history and verified composition |
| Parse scan text (preview) | `POST /api/moon-scan/scans/parse` | `urn:moons:submit` or site admin | No DB write |
| Submit scans | `POST /api/moon-scan/scans/submit` | `urn:moons:submit` or site admin | High-sec systems filtered out |
| View own scans | `GET /api/moon-scan/scans/mine` | `urn:moons:submit` or site admin | Uses user primary character ID |
| View validation queue | `GET /api/moon-scan/scans/queue` | `urn:moons:validate` or site admin | Pending scans only |
| List scans (moderation list) | `GET /api/moon-scan/scans` | `urn:moons:validate` or site admin | Supports status/moon/page filters |
| Verify scan | `POST /api/moon-scan/scans/:id/verify` | `urn:moons:validate` or site admin | Updates verified composition |
| Reject scan | `POST /api/moon-scan/scans/:id/reject` | `urn:moons:validate` or site admin | Marks scan rejected |
| Read scan by ID (verified) | `GET /api/moon-scan/scans/:id` | `urn:moons:view` OR validator OR owner OR site admin | Verified scans are viewable with `view` |
| Read scan by ID (pending/rejected) | `GET /api/moon-scan/scans/:id` | validator OR owner OR site admin | Plain `view` is not enough for non-verified scans |
| View leaderboard | `GET /api/moon-scan/leaderboard` | `urn:moons:view` or site admin | Window: `all`, `7d`, `30d` |
| Read admin settings | `GET /api/moon-scan/admin/settings` | `urn:moons:admin` or site admin | Extraction + structure profile config |
| Update extraction settings | `POST /api/moon-scan/admin/settings` | `urn:moons:admin` or site admin | Supports override price fields |
| Update structure profile | `POST /api/moon-scan/admin/settings/profiles/:id` | `urn:moons:admin` or site admin | `id` in `{tatara, metenox}` |
| Show Moon Scanning nav group | UI sidebar | `urn:moons:view` or site admin | `Regions`, `Scanned Moons`, `Leaderboard` visible |
| Show `Submit Scan` + `My Scans` nav | UI sidebar | `urn:moons:submit` or site admin | Child links under Moon Scanning |
| Show `Validation Queue` nav | UI sidebar | `urn:moons:validate` or site admin | Child link under Moon Scanning |
| Show `Admin Settings` nav | UI sidebar | `urn:moons:admin` or site admin | Child link under Moon Scanning |

## Operational Notes

- Permissions are seeded separately (manual seed flow currently expected).
- Profitability can legitimately return `null` if dependencies fail during compute path.
- Character names in scan/leaderboard output depend on cached name availability.
