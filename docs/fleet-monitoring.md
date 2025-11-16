# FleetMonitor System Documentation

**Version:** 1.0
**Last Updated:** 2025-11-14

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [Key Components](#key-components)
4. [Data Flow](#data-flow)
5. [EVE Online ESI Integration](#eve-online-esi-integration)
6. [Current Features](#current-features)
7. [Database Schema](#database-schema)
8. [WebSocket Real-Time Updates](#websocket-real-time-updates)
9. [Monitoring & Health Checks](#monitoring--health-checks)
10. [Use Cases](#use-cases)
11. [Potential Improvements](#potential-improvements)
12. [Developer Guide](#developer-guide)

---

## System Overview

FleetMonitor is a real-time fleet tracking system for EVE Online built on Cloudflare Workers and Durable Objects. It provides:

- **Automatic fleet detection** for configured fleet commanders
- **Real-time monitoring** of fleet status with 20-second update intervals
- **Member history tracking** to detect joins/leaves with ship and location data
- **WebSocket support** for live fleet updates to connected clients
- **Quick join invitation system** for easy fleet access
- **Persistent state management** using PostgreSQL (Neon) and SQLite (Durable Objects)

### Purpose

FleetMonitor solves the problem of tracking EVE Online fleet composition and activity in real-time without requiring manual updates. It automatically:

1. Detects when monitored fleet commanders form fleets
2. Tracks all fleet members, their ships, and locations
3. Records historical join/leave events
4. Provides live updates via WebSocket connections
5. Handles fleet lifecycle (creation, updates, disbanding)

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐        ┌───────────────────────┐          │
│  │  Hono App    │───────>│  FleetsDO (Singleton) │          │
│  │  (HTTP API)  │        │  - Quick Join Links   │          │
│  └──────────────┘        │  - FC Management      │          │
│         │                │  - Watchdog Alarm     │          │
│         │                └───────────────────────┘          │
│         │                          │                         │
│         │                          │ Creates/Monitors        │
│         │                          ▼                         │
│         │                ┌───────────────────────┐          │
│         └───────────────>│ FleetMonitorDO (N)    │          │
│                          │ - Per-Fleet Instance  │          │
│                          │ - 20s Update Alarm    │          │
│                          │ - WebSocket Support   │          │
│                          │ - Member Tracking     │          │
│                          └───────────────────────┘          │
│                                    │                         │
└────────────────────────────────────┼─────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
            ┌──────────────┐  ┌──────────┐  ┌────────────────┐
            │ PostgreSQL   │  │ EVE ESI  │  │ Other Services │
            │ (Neon)       │  │   API    │  │ - TokenStore   │
            │ - Fleet      │  │          │  │ - CharacterData│
            │   Cache      │  │          │  │ - Universe     │
            │ - History    │  │          │  │                │
            └──────────────┘  └──────────┘  └────────────────┘
```

### Component Layers

1. **HTTP API Layer** (`/apps/fleets/src/index.ts`)
   - Hono-based REST API
   - Routes for monitored FC management
   - WebSocket upgrade endpoints
   - Fleet status queries

2. **Durable Object Layer**
   - **FleetsDO**: Singleton managing all fleet-related operations
   - **FleetMonitorDO**: Per-fleet instances (one DO per active fleet)

3. **Scheduled Processing**
   - Cron trigger every 5 minutes
   - Checks monitored FCs for fleet activity
   - Initializes FleetMonitor instances automatically

4. **Data Persistence**
   - PostgreSQL for cross-instance data
   - SQLite for Durable Object instance state

---

## Key Components

### 1. Fleets Worker (`/apps/fleets/`)

**Main Entry Point:** `/apps/fleets/src/index.ts`

A Cloudflare Worker with:

- REST API for fleet management
- Scheduled cron handler (every 5 minutes)
- Exports two Durable Object classes: `FleetsDO` and `FleetMonitorDO`

**Key Endpoints:**

- `GET /fleet-monitor/:fleetId/ws` - WebSocket endpoint for real-time updates
- `GET /fleet-monitor/:fleetId/status` - HTTP fleet status query

**Configuration:** `/apps/fleets/wrangler.jsonc`

- Cron: `*/5 * * * *` (every 5 minutes)
- Durable Objects: `Fleets`, `FleetMonitor`
- Bindings: EVE_TOKEN_STORE, EVE_CHARACTER_DATA, EVE_CORPORATION_DATA, UNIVERSE

---

### 2. FleetsDO (Singleton Durable Object)

**File:** `/apps/fleets/src/durable-object.ts`

**Responsibilities:**

- Manages list of monitored fleet commanders
- Creates and validates quick join invitations
- Fetches fleet details from ESI
- Caches fleet state to reduce ESI calls
- **Watchdog alarm** (every 2 minutes) to check FleetMonitor health

**Key RPC Methods:**

```typescript
interface Fleets {
  listMonitoredFleetCommanders(): Promise<string[]>
  addMonitoredFleetCommander(characterId: string): Promise<boolean>
  removeMonitoredFleetCommander(characterId: string): Promise<boolean>

  getCharacterFleetInformation(characterId: EveCharacterId): Promise<FleetInformation>
  getFleetDetails(fleetId: string, characterId: string): Promise<FleetDetailsResponse>

  createQuickJoinInvitation(...): Promise<QuickJoinCreationResult>
  validateQuickJoinToken(token: string): Promise<QuickJoinValidationResult>
  joinFleetViaQuickJoin(...): Promise<FleetJoinResult>

  isFleetActive(fleetId: string, characterId: string): Promise<boolean>
  getFleetCacheStatus(fleetId: string): Promise<{...} | null>
}
```

**Watchdog Functionality:**

- Runs every 2 minutes via alarm
- Checks all active FleetMonitor instances
- Detects stale monitors (not updated in 2+ minutes)
- Logs health status for debugging

---

### 3. FleetMonitorDO (Per-Fleet Durable Object)

**File:** `/apps/fleets/src/fleet-monitor.ts`

**Responsibilities:**

- Monitors a single fleet in real-time
- Updates fleet status every 20 seconds via alarm
- Tracks member join/leave events
- Broadcasts updates via WebSocket
- Handles fleet lifecycle (active → ended)

**Instance ID Pattern:** `fleet-${fleetId}` (e.g., `fleet-1234567890`)

**Key RPC Methods:**

```typescript
interface FleetMonitor {
  initializeMonitoring(fleetId: string, characterId: string, force?: boolean): Promise<void>
  getFleetStatus(): Promise<FleetDetailsResponse | null>
  getMonitorState(): Promise<FleetMonitorState | null>
  terminate(): Promise<void>
}
```

**State Storage:**

- **SQLite** (Durable Object storage):
  - `monitor_state` - Fleet ID, character ID, initialization status, last checked timestamp
  - `previous_members` - Snapshot of current members for diff detection
  - `error_tracking` - Tracks 404 errors to detect fleet disbanding

- **PostgreSQL** (Neon):
  - `fleet_state_cache` - Fleet status for cross-instance queries
  - `fleet_member_history` - Join/leave events with ship/location data

**Alarm Cycle:**

1. Trigger every 20 seconds
2. Fetch fleet info and members from ESI
3. Compare with previous snapshot to detect joins/leaves
4. Update PostgreSQL cache
5. Broadcast to WebSocket clients
6. Reschedule next alarm

**Fleet End Detection:**

- Requires 3 consecutive 404 errors within 2 minutes
- Marks fleet as `notFound` and `isActive: false`
- Stops alarms and allows garbage collection

---

### 4. Scheduled Handler

**File:** `/apps/fleets/src/scheduled.ts`

**Execution:** Every 5 minutes (cron trigger)

**Process:**

1. Query FleetsDO for monitored fleet commanders
2. For each commander:
   - Fetch current fleet information from ESI
   - Check if commander is in a fleet
   - Check if commander is the fleet boss
   - If yes, initialize/verify FleetMonitor instance
3. Detect "fleet blips" (fleets marked inactive but still active in ESI)
4. Force re-initialize monitors if needed

**Blip Detection:**

- Compares ESI data with fleet cache
- If fleet is active in ESI but marked inactive/ended in cache, reinitializes
- Restarts alarms to resume monitoring

---

### 5. Shared Package (`@repo/fleets`)

**Location:** `/packages/fleets/`

**Purpose:** Type-safe RPC interfaces and ESI schemas

**Exports:**

- TypeScript interfaces for `Fleets` and `FleetMonitor` RPC methods
- Zod schemas for ESI API validation
- Shared types for fleet data structures

**Files:**

- `src/index.ts` - Main interface definitions
- `src/fleet-monitor.ts` - FleetMonitor types
- `src/esi.ts` - ESI response schemas with Zod validation

---

## Data Flow

### 1. Fleet Detection Flow

```
┌──────────────────────────────────────────────────────────────┐
│ Cron Trigger (Every 5 Minutes)                               │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │ scheduledHandler()  │
              └─────────┬───────────┘
                        │
                        │ 1. Get monitored FCs
                        ▼
              ┌─────────────────────┐
              │ FleetsDO            │
              │ .listMonitored...() │
              └─────────┬───────────┘
                        │
                        │ 2. For each FC
                        ▼
              ┌──────────────────────┐
              │ .getCharacterFleet   │
              │ Information()        │
              └─────────┬────────────┘
                        │
                        │ 3. ESI call
                        ▼
              ┌──────────────────────┐
              │ EVE ESI API          │
              │ /characters/X/fleet  │
              └─────────┬────────────┘
                        │
                        │ 4. Check if FC is fleet boss
                        ▼
              ┌──────────────────────┐
              │ If yes, create/init  │
              │ FleetMonitorDO       │
              │ instance             │
              └──────────────────────┘
```

### 2. Fleet Monitoring Flow

```
┌──────────────────────────────────────────────────────────────┐
│ FleetMonitorDO Alarm (Every 20 Seconds)                      │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        │ 1. Schedule next alarm early
                        ▼
              ┌──────────────────────┐
              │ .getFleetStatus()    │
              └─────────┬────────────┘
                        │
                        │ 2. Fetch fleet info & members
                        ▼
              ┌──────────────────────┐
              │ EVE ESI API          │
              │ - /fleets/X/         │
              │ - /fleets/X/members/ │
              └─────────┬────────────┘
                        │
                        │ 3. Compare members
                        ▼
              ┌──────────────────────┐
              │ .trackMemberHistory()│
              │ - Detect joins       │
              │ - Detect leaves      │
              └─────────┬────────────┘
                        │
                        │ 4. Store in PostgreSQL
                        ▼
              ┌──────────────────────┐
              │ fleet_member_history │
              │ fleet_state_cache    │
              └─────────┬────────────┘
                        │
                        │ 5. Update SQLite snapshot
                        ▼
              ┌──────────────────────┐
              │ previous_members     │
              └─────────┬────────────┘
                        │
                        │ 6. Broadcast to WebSocket clients
                        ▼
              ┌──────────────────────┐
              │ Connected WS Clients │
              └──────────────────────┘
```

### 3. WebSocket Connection Flow

```
Client                  Worker               FleetMonitorDO
  │                       │                         │
  │ GET /fleet-monitor/   │                         │
  │ 123/ws               │                         │
  ├──────────────────────>│                         │
  │                       │ getStub('fleet-123')    │
  │                       ├────────────────────────>│
  │                       │                         │
  │                       │ .fetch(upgrade req)     │
  │                       ├────────────────────────>│
  │                       │                         │
  │                       │ WebSocketPair created   │
  │                       │ ctx.acceptWebSocket()   │
  │<──────────────────────┤<────────────────────────┤
  │ 101 Switching         │                         │
  │ Protocols             │                         │
  │                       │                         │
  │ {"type":"subscribe"}  │                         │
  ├──────────────────────────────────────────────────>│
  │                       │                         │
  │                       │   .webSocketMessage()   │
  │                       │   - Send current status │
  │<──────────────────────────────────────────────────┤
  │ {"type":"fleet_status"}                         │
  │                       │                         │
  │                       │   Every 20s alarm:      │
  │<──────────────────────────────────────────────────┤
  │ {"type":"fleet_update"}                         │
  │                       │                         │
```

---

## EVE Online ESI Integration

### ESI Endpoints Used

1. **Character Fleet Information**
   - Endpoint: `GET /characters/{character_id}/fleet/`
   - Purpose: Check if character is in a fleet and their role
   - Returns: `fleet_id`, `fleet_boss_id`, `role`, `squad_id`, `wing_id`

2. **Fleet Information**
   - Endpoint: `GET /fleets/{fleet_id}/`
   - Purpose: Get fleet configuration and MOTD
   - Returns: `is_free_move`, `is_registered`, `is_voice_enabled`, `motd`

3. **Fleet Members**
   - Endpoint: `GET /fleets/{fleet_id}/members/`
   - Purpose: List all fleet members with details
   - Returns: Array of members with ship, location, role, etc.

4. **Fleet Invitation** (POST)
   - Endpoint: `POST /fleets/{fleet_id}/members/`
   - Purpose: Invite character to fleet (quick join feature)
   - Body: `{ character_id, role }`

### Authentication

- Uses `@repo/eve-token-store` Durable Object for ESI access tokens
- Token refresh handled automatically
- Requires `esi-fleets.read_fleet.v1` scope for reading fleet data
- Requires `esi-fleets.write_fleet.v1` scope for inviting members

### Error Handling

**404 Not Found:**

- Character not in fleet
- Fleet no longer exists
- Requires 3 consecutive 404s within 2 minutes to confirm fleet ended

**403 Forbidden:**

- Missing ESI scopes
- Character not authorized to access fleet

**Rate Limiting:**

- ESI has rate limits (150 requests/second)
- Fleet cache reduces ESI calls (5-minute cache for fleet existence)

---

## Current Features

### 1. Fleet Commander Monitoring

- Add/remove fleet commanders to monitoring list
- Automatic fleet detection every 5 minutes
- Only monitors fleets where FC is the fleet boss

### 2. Real-Time Fleet Tracking

- 20-second update intervals
- Tracks fleet configuration (MOTD, settings)
- Monitors member count
- Detects fleet disbanding

### 3. Member History Tracking

- Records join events with timestamp, ship, location
- Records leave events with last known state
- Stores in `fleet_member_history` table
- Includes:
  - Character ID
  - Ship type ID (resolved to ship name)
  - Solar system ID
  - Station ID (if docked)
  - Role and role name
  - Squad/wing IDs
  - Join/leave timestamps

### 4. Quick Join Invitations

- Generate time-limited invitation tokens
- Optional maximum use count
- Direct ESI fleet invitation
- Token validation and revocation

### 5. WebSocket Live Updates

- Real-time fleet status broadcasts
- Subscribe/unsubscribe messaging
- Ping/pong keepalive
- Automatic updates every 20 seconds

### 6. Fleet State Caching

- PostgreSQL cache reduces ESI calls
- 5-minute cache validity
- Tracks `notFound` status to avoid repeated 404s
- Records fleet end timestamps

### 7. Watchdog Monitoring

- FleetsDO alarm checks FleetMonitor health every 2 minutes
- Detects stale monitors (not updating)
- Logs warnings for debugging

### 8. Fleet Blip Recovery

- Detects fleets marked inactive but still active in ESI
- Force reinitializes monitors
- Restarts alarms automatically

---

## Database Schema

### PostgreSQL Tables (Neon)

#### `fleet_invitations`

Quick join invitation tokens

| Column        | Type      | Description                    |
| ------------- | --------- | ------------------------------ |
| id            | uuid      | Primary key                    |
| token         | text      | Unique invitation token        |
| fleet_boss_id | text      | Character ID of fleet boss     |
| fleet_id      | text      | ESI fleet ID                   |
| expires_at    | timestamp | Expiration time                |
| created_at    | timestamp | Creation time                  |
| max_uses      | integer   | Optional max use count         |
| uses_count    | integer   | Current use count (default: 0) |
| is_active     | boolean   | Active status (default: true)  |

**Indexes:** `token`, `expires_at`, `fleet_boss_id`

---

#### `fleet_memberships`

Tracks who joined via quick join

| Column        | Type      | Description                        |
| ------------- | --------- | ---------------------------------- |
| id            | uuid      | Primary key                        |
| character_id  | text      | Character who joined               |
| fleet_id      | text      | Fleet they joined                  |
| invitation_id | uuid      | Reference to invitation used       |
| joined_at     | timestamp | Join timestamp (default: now)      |
| role          | text      | Fleet role (default: squad_member) |

**Indexes:** `character_id`, `fleet_id`, `invitation_id`

---

#### `fleet_state_cache`

Caches fleet status to reduce ESI calls

| Column           | Type      | Description                           |
| ---------------- | --------- | ------------------------------------- |
| id               | uuid      | Primary key                           |
| fleet_id         | text      | ESI fleet ID (unique)                 |
| fleet_boss_id    | text      | Fleet boss character ID               |
| is_active        | boolean   | Fleet active status (default: true)   |
| member_count     | integer   | Current member count (default: 0)     |
| motd             | text      | Fleet MOTD (nullable)                 |
| is_free_move     | boolean   | Free move enabled (default: false)    |
| is_registered    | boolean   | Registered in finder (default: false) |
| is_voice_enabled | boolean   | Voice enabled (default: false)        |
| not_found        | boolean   | Fleet returned 404 (default: false)   |
| not_found_at     | timestamp | When 404 was first detected           |
| ended_at         | timestamp | When fleet ended                      |
| last_checked     | timestamp | Last ESI check (default: now)         |
| created_at       | timestamp | Cache entry creation                  |
| updated_at       | timestamp | Last update                           |

**Indexes:** `fleet_id`, `fleet_boss_id`, `last_checked`, `not_found`, `ended_at`

---

#### `monitored_fleet_commanders`

List of FCs to monitor

| Column       | Type      | Description               |
| ------------ | --------- | ------------------------- |
| id           | uuid      | Primary key               |
| character_id | text      | Character ID (unique)     |
| created_at   | timestamp | When added (default: now) |

**Indexes:** `character_id`

---

#### `fleet_member_history`

Historical join/leave events

| Column          | Type      | Description                             |
| --------------- | --------- | --------------------------------------- |
| id              | uuid      | Primary key                             |
| fleet_id        | text      | ESI fleet ID                            |
| character_id    | text      | Member character ID                     |
| event_type      | text      | 'join' or 'leave'                       |
| ship_type_id    | integer   | Ship type ID                            |
| solar_system_id | integer   | Solar system ID                         |
| station_id      | integer   | Station ID (nullable, null if in space) |
| role            | text      | Fleet role                              |
| role_name       | text      | Human-readable role                     |
| squad_id        | text      | Squad ID (text to handle large values)  |
| wing_id         | text      | Wing ID (text to handle large values)   |
| joined_at       | timestamp | When member joined (nullable)           |
| left_at         | timestamp | When member left (nullable)             |
| event_timestamp | timestamp | When event occurred (default: now)      |
| created_at      | timestamp | Record creation                         |

**Indexes:** `fleet_id`, `character_id`, `event_type`, `event_timestamp`, `(fleet_id, character_id)`

---

### SQLite Tables (Durable Object Storage)

#### FleetMonitorDO: `monitor_state`

Per-instance state

| Column         | Type    | Description                 |
| -------------- | ------- | --------------------------- |
| id             | integer | Primary key (always 1)      |
| fleet_id       | text    | ESI fleet ID                |
| character_id   | text    | Fleet boss character ID     |
| is_initialized | integer | Initialized flag (0/1)      |
| last_checked   | text    | ISO timestamp of last check |

---

#### FleetMonitorDO: `previous_members`

Snapshot for diff detection

| Column          | Type    | Description               |
| --------------- | ------- | ------------------------- |
| character_id    | text    | Primary key               |
| ship_type_id    | integer | Ship type ID              |
| solar_system_id | integer | Solar system ID           |
| station_id      | integer | Station ID (nullable)     |
| role            | text    | Fleet role                |
| role_name       | text    | Human-readable role       |
| squad_id        | integer | Squad ID                  |
| wing_id         | integer | Wing ID                   |
| join_time       | text    | ISO timestamp when joined |
| last_seen       | text    | ISO timestamp last seen   |

---

#### FleetMonitorDO: `error_tracking`

Tracks 404 errors for fleet end detection

| Column        | Type    | Description                |
| ------------- | ------- | -------------------------- |
| id            | integer | Auto-increment primary key |
| error_type    | text    | Error type (e.g., '404')   |
| error_message | text    | Full error message         |
| timestamp     | text    | ISO timestamp              |

---

## WebSocket Real-Time Updates

### Connection Protocol

**URL:** `GET /fleet-monitor/{fleetId}/ws`

**Upgrade:** WebSocket (HTTP 101 Switching Protocols)

### Message Types

#### Client → Server

**Subscribe:**

```json
{
  "type": "subscribe"
}
```

Response: Immediate fleet status + confirmation

```json
{
  "type": "fleet_status",
  "fleetId": "1234567890",
  "data": { /* FleetDetailsResponse */ }
}
{
  "type": "subscribed"
}
```

**Ping:**

```json
{
  "type": "ping"
}
```

Response:

```json
{
  "type": "pong",
  "payload": 1699999999999
}
```

**Unsubscribe:**

```json
{
  "type": "unsubscribe"
}
```

Response:

```json
{
  "type": "unsubscribed"
}
```

#### Server → Client

**Fleet Update (every 20 seconds):**

```json
{
  "type": "fleet_update",
  "fleetId": "1234567890",
  "timestamp": "2025-11-14T12:34:56.789Z",
  "data": {
    "fleetInfo": {
      "is_free_move": true,
      "is_registered": false,
      "is_voice_enabled": true,
      "motd": "Form on FC"
    },
    "members": [
      {
        "character_id": 123456,
        "join_time": "2025-11-14T12:00:00Z",
        "role": "fleet_commander",
        "role_name": "Fleet Commander",
        "ship_type_id": 11567,
        "solar_system_id": 30000142,
        "squad_id": 1,
        "station_id": null,
        "takes_fleet_warp": true,
        "wing_id": 1
      }
    ],
    "fleetBossName": "John Doe",
    "memberCount": 25,
    "shipTypeNames": {
      "11567": "Machariel"
    }
  }
}
```

**Error:**

```json
{
  "type": "error",
  "payload": "Invalid message format"
}
```

### Hibernation API

FleetMonitorDO uses Cloudflare's WebSocket Hibernation API:

- `ctx.acceptWebSocket(server)` to accept connections
- `webSocketMessage()` handler for incoming messages
- `webSocketClose()` handler for disconnections
- `webSocketError()` handler for errors

**Benefits:**

- Reduced CPU usage when WebSocket is idle
- Automatic state management
- Better scalability

---

## Monitoring & Health Checks

### 1. FleetsDO Watchdog

**Frequency:** Every 2 minutes (alarm)

**Process:**

1. Query `fleet_state_cache` for active fleets
2. For each fleet, get FleetMonitorDO stub
3. Call `.getMonitorState()` to get `lastChecked` timestamp
4. If `lastChecked` is older than 2 minutes, log as stale

**Output:**

- Info logs for healthy monitors
- Error logs for stale monitors
- Summary of total checked and stale count

### 2. Fleet End Detection

**Method:** Consecutive 404 tracking

**Process:**

1. On ESI 404 error, insert into `error_tracking` table
2. Query recent 404s (within 2 minutes)
3. If count >= 3, mark fleet as ended:
   - Set `notFound: true`, `isActive: false`
   - Record `endedAt` and `notFoundAt` timestamps
   - Stop alarms (DO becomes eligible for garbage collection)

**Why 3 consecutive 404s?**

- Prevents false positives from transient ESI errors
- Ensures fleet is truly disbanded

### 3. Blip Recovery

**Detection:** Scheduled handler compares ESI vs cache

**Scenario:**

- Fleet is active in ESI
- Cache shows `isActive: false` or `notFound: true`

**Action:**

- Log warning about blip detection
- Force reinitialize FleetMonitor (`force: true`)
- Clears cache state and restarts alarms

### 4. Logging

Uses `@repo/hono-helpers` logger with tagged messages:

**Tags:**

- `[FleetMonitor ${fleetId}]` - FleetMonitor instance logs
- `[FleetsDO Watchdog]` - Watchdog alarm logs
- `[FleetMonitoring]` - Scheduled handler logs
- `[Fleets DO]` - FleetsDO operation logs

**Log Levels:**

- `debug` - Detailed execution traces
- `info` - Normal operations, status updates
- `warn` - Non-critical issues, retries
- `error` - Failures, exceptions

---

## Use Cases

### 1. Alliance Fleet Tracking

**Scenario:** Track all major alliance fleet operations

**Setup:**

1. Add all alliance FCs to monitored list
2. Connect web dashboard via WebSocket
3. Display real-time fleet composition

**Benefits:**

- Know which FCs are currently running fleets
- See fleet sizes and ships at a glance
- Historical data for after-action reports

---

### 2. Fleet Invitation System

**Scenario:** Quick fleet join without manual invites

**Setup:**

1. FC forms fleet in-game
2. System generates quick join link
3. Share link via Discord/Slack
4. Members click link, select character, join

**Benefits:**

- No need for manual invites in-game
- Works for alts easily
- Track who joined via which invitation

---

### 3. Fleet Analytics

**Scenario:** Analyze fleet participation and ship usage

**Query Examples:**

**Most active FCs:**

```sql
SELECT
  fleet_boss_id,
  COUNT(DISTINCT fleet_id) as fleet_count,
  SUM(member_count) as total_members
FROM fleet_state_cache
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY fleet_boss_id
ORDER BY fleet_count DESC
```

**Popular ship types:**

```sql
SELECT
  ship_type_id,
  COUNT(*) as usage_count
FROM fleet_member_history
WHERE event_type = 'join'
  AND event_timestamp > NOW() - INTERVAL '7 days'
GROUP BY ship_type_id
ORDER BY usage_count DESC
LIMIT 10
```

**Fleet duration analysis:**

```sql
SELECT
  fleet_id,
  MIN(event_timestamp) as fleet_start,
  MAX(event_timestamp) as fleet_end,
  EXTRACT(EPOCH FROM (MAX(event_timestamp) - MIN(event_timestamp))) / 3600 as duration_hours,
  COUNT(DISTINCT character_id) as unique_members
FROM fleet_member_history
GROUP BY fleet_id
ORDER BY duration_hours DESC
```

---

### 4. Discord Bot Integration

**Scenario:** Real-time fleet notifications in Discord

**Implementation:**

1. Discord bot subscribes to fleet WebSocket
2. On `fleet_update` with member joins:
   - Post notification: "John Doe joined in Machariel"
3. On fleet formation:
   - Post: "Fleet up with FC Name - 15 pilots"

**Benefits:**

- Members see fleet activity without logging in
- Quick notifications for important fleets
- Encourages participation

---

### 5. Strategic Planning

**Scenario:** Analyze enemy fleet patterns

**Use:**

- Track fleet formation times
- Identify peak activity hours
- Analyze ship doctrines used
- Monitor fleet sizes over time

**Data Sources:**

- `fleet_member_history` for composition
- `fleet_state_cache` for timing and status
- Ship type IDs for doctrine identification

---

## Potential Improvements

### 1. Performance Optimizations

#### Batch ESI Requests

**Problem:** Each FleetMonitor makes separate ESI calls
**Solution:**

- Aggregate ESI requests from multiple monitors
- Use ESI batch endpoints where available
- Implement request coalescing

**Benefit:** Reduce ESI rate limit pressure, faster updates

---

#### Database Connection Pooling

**Problem:** Each update opens new database connection
**Solution:**

- Implement connection pooling in `@repo/db-utils`
- Reuse connections across DO instances
- Use prepared statements for repeated queries

**Benefit:** Lower database latency, reduced connection overhead

---

#### Incremental Member Updates

**Problem:** Full member list fetched every 20 seconds
**Solution:**

- Use ESI `If-None-Match` headers for caching
- Only update PostgreSQL on actual changes
- Store ETag in SQLite state

**Benefit:** Reduce bandwidth and database writes

---

### 2. Feature Enhancements

#### Ship Fitting Tracking

**Extension:** Record not just ship type but entire fit

**Implementation:**

- ESI endpoint: `GET /characters/{id}/ship/`
- Store module IDs in separate table
- Join with `fleet_member_history`

**Use Case:** Doctrine compliance checking, fit analysis

---

#### Location-Based Alerts

**Feature:** Notify when fleet enters specific systems

**Implementation:**

- Add `alert_systems` table with system IDs
- Check member solar_system_id against alerts
- Trigger webhook/notification on match

**Use Case:** Territorial defense, intel warnings

---

#### Fleet Voice Activity

**Feature:** Track who's speaking in fleet voice

**Limitation:** ESI doesn't expose voice activity
**Alternative:**

- Integrate with mumble/discord APIs
- Correlate voice activity with fleet membership

---

#### Member Skill Tracking

**Feature:** Track pilot skills in fleet

**Implementation:**

- ESI: `GET /characters/{id}/skills/`
- Store skill levels for fleet members
- Analyze fleet composition by skills (logistics level, etc.)

**Use Case:** Fleet capability assessment, skill training recommendations

---

### 3. Reliability Improvements

#### Alarm Backup System

**Problem:** If alarm fails to schedule, monitoring stops
**Solution:**

- Implement external cron check
- Ping FleetMonitor instances from worker cron
- Auto-restart stale monitors

**Implementation:**

```typescript
// In scheduled handler
for (const fleet of activeFleets) {
  const stub = getStub<FleetMonitor>(env.FLEET_MONITOR, `fleet-${fleet.id}`)
  const state = await stub.getMonitorState()
  if (!state || isStale(state.lastChecked)) {
    await stub.initializeMonitoring(fleet.id, fleet.bossId, true)
  }
}
```

---

#### Multi-Region Deployment

**Problem:** Single region point of failure
**Solution:**

- Deploy to multiple Cloudflare regions
- Use region-aware Durable Object IDs
- Implement failover logic

---

#### ESI Outage Handling

**Problem:** ESI downtime stops all monitoring
**Solution:**

- Detect ESI 5xx errors vs 404s
- Exponential backoff for retries
- Cache last known good state
- Alert on prolonged outages

**Implementation:**

```typescript
if (isEsi5xxError(error)) {
  // Don't mark as ended, ESI is down
  const backoffMs = Math.min(2 ** retryCount * 1000, 60000)
  await this.state.storage.setAlarm(Date.now() + backoffMs)
  return
}
```

---

### 4. Data Management

#### Historical Data Archival

**Problem:** `fleet_member_history` grows unbounded
**Solution:**

- Archive old records to R2 storage
- Keep last 30 days in PostgreSQL
- Implement partitioning by month

**Implementation:**

```typescript
// Scheduled monthly archival
const oldRecords = await db
  .select()
  .from(fleetMemberHistory)
  .where(lte(fleetMemberHistory.eventTimestamp, thirtyDaysAgo))

await env.ARCHIVE_BUCKET.put(`fleet-history/${year}-${month}.json`, JSON.stringify(oldRecords))

await db.delete(fleetMemberHistory).where(lte(fleetMemberHistory.eventTimestamp, thirtyDaysAgo))
```

---

#### Data Retention Policies

**Feature:** Configurable retention per table

**Configuration:**

```typescript
const retentionPolicies = {
  fleet_invitations: 90, // days
  fleet_memberships: 365,
  fleet_state_cache: 30,
  fleet_member_history: 90,
}
```

---

### 5. Developer Experience

#### GraphQL API

**Enhancement:** Replace REST with GraphQL

**Benefits:**

- Type-safe queries
- Reduce over-fetching
- Real-time subscriptions (instead of WebSocket polling)

**Schema Example:**

```graphql
type Query {
  fleet(id: ID!): Fleet
  monitoredCommanders: [Character!]!
  fleetHistory(fleetId: ID!, limit: Int): [MemberEvent!]!
}

type Subscription {
  fleetUpdates(fleetId: ID!): FleetUpdate!
}

type Fleet {
  id: ID!
  boss: Character!
  members: [FleetMember!]!
  motd: String
  isActive: Boolean!
  memberCount: Int!
}
```

---

#### Admin Dashboard

**Feature:** Web UI for fleet management

**Components:**

- Monitored FC list management
- Active fleet overview
- Real-time fleet viewer (WebSocket connected)
- Historical charts and analytics
- Quick join link generator

**Tech Stack:**

- Next.js/React for frontend
- Deploy via Cloudflare Pages
- Use `@repo/fleets` package for type safety

---

#### Testing Suite

**Gap:** Limited integration tests

**Additions:**

- Mock ESI responses in tests
- Test fleet lifecycle (create → update → end)
- Test 404 detection and recovery
- Load testing for concurrent fleets

**Example:**

```typescript
// apps/fleets/src/test/integration/fleet-monitor.test.ts
describe('FleetMonitor', () => {
  it('detects fleet disbanding after 3x 404', async () => {
    // Setup mock ESI returning 404
    // Initialize monitor
    // Trigger 3 alarms
    // Assert fleet marked as ended
  })
})
```

---

### 6. Advanced Features

#### Predictive Fleet Formation

**ML Feature:** Predict when FC will form fleet

**Data:**

- Historical fleet formation times
- Day of week patterns
- Recent activity

**Model:** Time-series forecasting (LSTM or Prophet)

**Output:** "FC typically forms fleets at 18:00 UTC on Saturdays"

---

#### Doctrine Compliance Checker

**Feature:** Validate fleet composition against doctrine

**Implementation:**

1. Store doctrine definitions (ship types, modules, skills)
2. Compare fleet members against doctrine
3. Highlight non-compliant members
4. Generate compliance score

**Use Case:** Ensure fleet readiness, identify doctrine violations

---

#### Fleet Performance Metrics

**Analytics:** Track fleet effectiveness

**Metrics:**

- Average time to form (from FC login to first member)
- Member retention (how long members stay)
- Ship diversity (composition variety)
- Geographic distribution (systems visited)

---

#### Integration with zkillboard

**Feature:** Correlate fleet activity with kills/losses

**Implementation:**

1. Fetch kills from zkillboard API
2. Match kill timestamps with fleet member presence
3. Attribute kills to specific fleets
4. Calculate ISK efficiency per fleet

**Output:** "Fleet 123 had 50 kills, 5 losses, 90% ISK efficiency"

---

## Developer Guide

### Prerequisites

- Node.js 18+
- pnpm package manager
- Cloudflare account with Workers/DO enabled
- Neon PostgreSQL database
- EVE Online ESI application

### Local Development

**Install dependencies:**

```bash
just install
# or: pnpm install --child-concurrency=10
```

**Set up environment variables:**

```bash
# apps/fleets/.dev.vars
DATABASE_URL=postgresql://user:pass@host/db
ENVIRONMENT=development
NAME=fleets
SENTRY_RELEASE=local
```

**Run development server:**

```bash
just dev
# or: pnpm -F fleets dev
```

**Run tests:**

```bash
just test
# or: pnpm -F fleets test
```

### Database Migrations

**Generate migration:**

```bash
just db-generate fleets
# or: pnpm -F fleets db:generate
```

**Run migrations:**

```bash
just db-migrate fleets
# or: pnpm -F fleets db:migrate
```

**IMPORTANT:** NEVER use `db:push` even in development. Always use migrations.

### Adding a New RPC Method

**Example:** Add method to get fleet member count

1. **Define interface in `@repo/fleets`:**

```typescript
// packages/fleets/src/index.ts
export interface Fleets extends DurableObject {
  // ... existing methods
  getFleetMemberCount(fleetId: string): Promise<number>
}
```

2. **Implement in FleetsDO:**

```typescript
// apps/fleets/src/durable-object.ts
export class FleetsDO extends DurableObject implements Fleets {
  async getFleetMemberCount(fleetId: string): Promise<number> {
    const [cached] = await this.db
      .select({ count: fleetStateCache.memberCount })
      .from(fleetStateCache)
      .where(eq(fleetStateCache.fleetId, fleetId))
      .limit(1)

    return cached?.count ?? 0
  }
}
```

3. **Call from worker:**

```typescript
// apps/fleets/src/index.ts
.get('/api/fleet/:fleetId/count', async (c) => {
  const fleetId = c.req.param('fleetId')
  using stub = getStub<Fleets>(c.env.FLEETS, 'default')
  const count = await stub.getFleetMemberCount(fleetId)
  return c.json({ count })
})
```

### Accessing Durable Objects

**ALWAYS use `getStub` helper:**

```typescript
import { getStub } from '@repo/do-utils'

import type { Fleets } from '@repo/fleets'

// Correct: automatic disposal with 'using' keyword
using stub = getStub<Fleets>(env.FLEETS, 'default')
const data = await stub.someMethod()
// stub.dispose() called automatically
```

**NEVER access namespace directly:**

```typescript
// ❌ WRONG - causes RPC stub leaks
const id = env.FLEETS.idFromName('default')
const stub = env.FLEETS.get(id)
// Missing dispose() call!
```

### Deployment

**Deploy to production:**

```bash
just deploy
# or: pnpm -F fleets deploy
```

**Tail logs:**

```bash
just tail fleets
# or: pnpm -F fleets tail
```

### Debugging

**Enable debug logs:**

- Set `debug: true` in logger configuration
- Check Cloudflare dashboard for real-time logs
- Use `wrangler tail` for local streaming

**Common issues:**

1. **FleetMonitor not updating:**
   - Check alarm is scheduled: query DO via RPC
   - Verify ESI access token is valid
   - Check watchdog logs for stale detection

2. **Database connection errors:**
   - Verify `DATABASE_URL` is correct
   - Check Neon project status
   - Ensure IP allowlist includes Cloudflare Workers

3. **WebSocket not connecting:**
   - Verify upgrade header is sent
   - Check DO instance is initialized
   - Ensure client handles 101 response

---

## Conclusion

The FleetMonitor system provides a robust, scalable solution for real-time EVE Online fleet tracking. Built on Cloudflare's edge infrastructure with Durable Objects, it offers:

- **Reliability:** Automatic recovery from failures, health monitoring
- **Performance:** 20-second update intervals, WebSocket real-time delivery
- **Scalability:** Per-fleet isolation, distributed across edge network
- **Extensibility:** Type-safe RPC interfaces, PostgreSQL for analytics

### Key Takeaways

- **Durable Objects** provide per-fleet state isolation and alarm scheduling
- **PostgreSQL** stores cross-instance data for queries and history
- **ESI integration** requires careful error handling and rate limit management
- **WebSocket Hibernation API** enables efficient real-time updates
- **Scheduled handlers** automate fleet detection without manual intervention

### Next Steps for Developers

1. Review the codebase structure and RPC interfaces
2. Set up local development environment
3. Explore the database schema and run sample queries
4. Implement one of the suggested improvements
5. Write tests for new features
6. Deploy and monitor in production

For questions or contributions, refer to the main repository documentation and CLAUDE.md project guidelines.

---

**Documentation Version:** 1.0
**Generated:** 2025-11-14
**Repository:** /Users/ozzeh/src/tapi-workers
**Worker:** apps/fleets
**Package:** @repo/fleets
