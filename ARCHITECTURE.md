# TAPI Workers Architecture

## Overview

This is a Cloudflare Workers monorepo implementing a comprehensive EVE Online application ecosystem using a microservices architecture. The system comprises 19 worker applications and 24 shared packages, built with TypeScript, Hono web framework, Drizzle ORM, and PostgreSQL.

## Core Architecture Principles

- **Microservices via Workers**: Each functional domain runs in isolated Cloudflare Workers
- **RPC Communication**: Cross-worker communication via RPC method bindings and service stubs
- **Durable Objects for State**: Persistent, strongly consistent state management for domain data
- **Queue-Driven Data Sync**: Asynchronous background processing for ESI data synchronization
- **Workflow Orchestration**: Cloudflare Workflows for complex multi-step operations
- **Single Database**: All workers share a Neon PostgreSQL database for persistence
- **ES Module Format**: All workers use ES modules (not Service Worker format)

---

## Worker Applications (apps/)

### 1. Core Worker (HTTP Gateway)
**File**: `/Users/ozzeh/src/tapi-workers/apps/core/`
**Type**: HTTP API Gateway + RPC Service Entrypoint
**Key Routes**: 
- `/api/*` - Main API namespace
- `/login` - OAuth flow entry point
- `/fleets/join/:token` - Fleet join page (server-rendered)
- `/invite` - User invite pages

**Key Responsibilities**:
- HTTP request routing to domain-specific endpoints
- Session management and authentication
- User/character/corporation data operations
- OAuth flow coordination (EVE SSO)
- Admin operations dispatching

**Database**: Uses Neon PostgreSQL with Drizzle ORM
**Bindings**:
- DurableObjects: EVE_TOKEN_STORE, EVE_CHARACTER_DATA, EVE_CORPORATION_DATA, GROUPS, NOTIFICATIONS, DISCORD, BILLS, BROADCASTS, FLEETS, FREIGHT, HR, SKILLS
- Services: ADMIN (admin worker RPC), EVE_STATIC_DATA (static data worker)

**Code Structure**:
- `src/routes/` - 20+ route handlers (admin, auth, bills, characters, corporations, discord, fleets, groups, hr, inventory, skills, etc.)
- `src/services/core-rpc.service.ts` - RPC methods for admin/orchestrator calls
- `src/middleware/` - Session, CSRF protection
- `src/db/schema.ts` - PostgreSQL schema (users, characters, corporations, etc.)

**Export**:
```typescript
export default app  // HTTP handler
export class CoreWorker extends WorkerEntrypoint<Env> { ... }  // RPC interface
```

### 2. Admin Worker (RPC-only)
**File**: `/Users/ozzeh/src/tapi-workers/apps/admin/`
**Type**: RPC Service Entrypoint
**No HTTP endpoints** - Called only via service binding from core worker

**Key Responsibilities**:
- User deletion and data cleanup
- Character ownership transfer
- User/character search and lookup
- Admin activity audit logging

**Database**: PostgreSQL via Drizzle ORM
**Bindings**:
- DurableObjects: EVE_TOKEN_STORE, EVE_CHARACTER_DATA
- Services: CORE (core worker RPC)

**Service Interface** (`@repo/admin`):
```typescript
async searchUsers(params: SearchUsersParams): Promise<SearchUsersResult>
async getUserDetails(userId: string): Promise<UserDetails | null>
async deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult>
async transferCharacterOwnership(characterId: string, newUserId: string, adminUserId: string)
async deleteCharacter(characterId: string, adminUserId: string)
async getActivityLog(filters: ActivityLogFilters, adminUserId: string)
```

### 3. UI Worker (React SPA)
**File**: `/Users/ozzeh/src/tapi-workers/apps/ui/`
**Type**: Static SPA Hosting + Server-Rendered Routes Proxy
**Routes**: `pleaseignore.app/*`

**Key Features**:
- Serves React SPA via Workers Static Assets
- Intelligent cache control:
  - HTML files: no-cache (ensures fresh deployments)
  - Hashed assets: immutable (safe long-term caching)
  - Other assets: must-revalidate (24h cache)
- Proxies `/login` and `/invite` routes to core worker (server-rendered)

**Bindings**:
- Fetcher: ASSETS (Static Assets), CORE (core worker)

**Code**: `/src/client/` contains React application
- Features: applications, corporations, skills, fleets, groups, etc.
- Modular architecture with feature-based structure

### 4. EVE Token Store (RPC + SQLite Cache)
**File**: `/Users/ozzeh/src/tapi-workers/apps/eve-token-store/`
**Type**: Durable Object (Singleton)
**Instance ID**: `default`

**Key Responsibilities**:
- EVE Online SSO OAuth flow (login, character attachment)
- Token storage with AES-GCM encryption
- Automatic token refresh via alarms
- ESI request deduplication and caching
- Entity name/ID resolution caching

**Storage**:
- PostgreSQL: Character accounts and tokens
- SQLite (Durable Object): ESI response cache, entity cache (2-level caching)

**RPC Interface** (`@repo/eve-token-store`):
```typescript
async startLoginFlow(state?: string): Promise<AuthorizationUrlResponse>
async startCharacterFlow(state?: string): Promise<AuthorizationUrlResponse>
async handleCallback(code: string, state?: string): Promise<CallbackResult>
async getAccessToken(characterId: string): Promise<string | null>
async getTokenInfo(characterId: string): Promise<TokenInfo | null>
async refreshToken(characterId: string): Promise<boolean>
async fetchEsi<T>(path: string, characterId: string): Promise<EsiResponse<T>>
async fetchPublicEsi<T>(path: string): Promise<EsiResponse<T>>
async fetchEsiAllPages<T>(basePath: string, characterId: string): Promise<{data: T[], pages: number}>
async resolveNames(names: string[]): Promise<Record<string, string>>
async resolveIds(ids: string[]): Promise<Record<string, string>>
async getCorporationById(corporationId: string): Promise<EsiCorporation | null>
async getAllianceById(allianceId: string): Promise<EsiAlliance | null>
```

**Special Features**:
- Alarm handler: Auto-refreshes tokens expiring within 5 minutes
- Entity caching: Corporations, alliances, systems cached for name lookups
- ETag support: HTTP conditional requests to minimize ESI API calls
- Pagination support: Handles multi-page ESI responses

### 5. EVE Character Data (RPC + Queue Consumer)
**File**: `/Users/ozzeh/src/tapi-workers/apps/eve-character-data/`
**Type**: Durable Object (Per-character)
**Instance ID**: `{characterId}`

**Key Responsibilities**:
- Per-character data synchronization from ESI
- Queue consumer for background refresh tasks
- Skills, skill queue, assets, clones, bookmarks caching

**Queue Consumers**: 12 queues from orchestrator
- Skills, assets, bookmarks, etc. refreshes

**Bindings**:
- DurableObjects: EVE_CHARACTER_DATA, EVE_TOKEN_STORE
- Queues: Multiple refresh queues

### 6. EVE Corporation Data (RPC + Queue + KV Cache + Cron)
**File**: `/Users/ozzeh/src/tapi-workers/apps/eve-corporation-data/`
**Type**: Durable Object (Per-corporation)
**Instance ID**: `{corporationId}`

**Most Complex Worker**: Handles all corporation data synchronization

**Key Responsibilities**:
- Per-corporation ESI data synchronization
- Director role management and health checks
- Multiple data types: members, assets, wallets, structures, orders, etc.
- Queue consumer for 12 different refresh types
- KV cache for temporary director cache

**Queue Consumers** (12 types):
```
corp-public-refresh
corp-members-refresh
corp-member-tracking-refresh
corp-wallets-refresh
corp-wallet-journal-refresh
corp-wallet-transactions-refresh
corp-assets-refresh
corp-structures-refresh
corp-orders-refresh
corp-contracts-refresh
corp-industry-jobs-refresh
corp-killmails-refresh
```

**Cron Trigger**: Hourly (`0 * * * *`)

**Database**:
- PostgreSQL: Persistent corporation data
- SQLite (DO): Pagination state for multi-page syncs
- KV: Directors cache (30-minute TTL)

**RPC Methods**: ~30 methods for querying/managing corporation data

### 7. Discord OAuth (RPC + Alarm)
**File**: `/Users/ozzeh/src/tapi-workers/apps/discord/`
**Type**: Durable Object (Singleton)
**Instance ID**: `default`

**Key Responsibilities**:
- Discord OAuth flow integration
- Token storage and encryption
- Bot messaging capabilities
- Discord proxy for rate-limit handling

**RPC Interface** (`@repo/discord`):
```typescript
async getProfileByCoreUserId(coreUserId: string): Promise<DiscordProfile | null>
async getDiscordUserStatus(coreUserId: string): Promise<DiscordUserStatus | null>
async handleCallback(code: string): Promise<DiscordCallbackResult>
async revokeAuth(coreUserId: string): Promise<boolean>
async sendMessage(userId: string, content: MessageContent): Promise<SendMessageResult>
async getUser(userId: string): Promise<DiscordUser | null>
```

**Proxy Configuration**: Supports proxy for Discord API rate limiting

### 8. Fleets (RPC + WebSocket + SQLite)
**File**: `/Users/ozzeh/src/tapi-workers/apps/fleets/`
**Type**: Durable Object (Singleton)
**Instance ID**: `default`

**Key Responsibilities**:
- Fleet quick-join invitation system
- Fleet state caching (members, squads, wings)
- WebSocket support for real-time updates
- Fleet operation coordination

**Storage**: SQLite (fleet invitations, memberships, state cache)

**RPC Interface** (`@repo/fleets`):
```typescript
async getCharacterFleetInformation(characterId: string): Promise<FleetInformation>
async createQuickJoinInvitation(fleetBossId: string, fleetId: string, expiresInHours?: number, maxUses?: number)
async validateQuickJoinToken(token: string): Promise<QuickJoinValidationResult>
async joinFleetViaQuickJoin(characterId: string, token: string): Promise<FleetJoinResult>
async getFleetDetails(characterId: string): Promise<FleetDetailsResponse>
```

### 9. HR (Durable Object + PostgreSQL)
**File**: `/Users/ozzeh/src/tapi-workers/apps/hr/`
**Type**: Durable Object (Singleton)
**Instance ID**: `default`

**Key Responsibilities**:
- Application management (submissions, approvals)
- Character blacklisting
- HR roles and permissions
- Recommendations system
- HR notes and audit trail

**Database**: PostgreSQL with Drizzle ORM

**RPC Interface** (`@repo/hr`):
```typescript
async submitApplication(userId: string, characterId: string, corporationId: string, ...): Promise<Application>
async listApplications(filters: ApplicationFilters, userId: string, isAdmin: boolean): Promise<Application[]>
async getApplication(applicationId: string, userId: string, isAdmin: boolean): Promise<ApplicationDetail>
async updateApplicationStatus(applicationId: string, status: ApplicationStatus, userId: string): Promise<Application>
async addBlacklistEntry(params: CreateUserBlacklistParams | CreateCharacterBlacklistParams): Promise<BlacklistEntry>
async isCharacterBlacklisted(characterId: string): Promise<boolean>
async checkCharactersBlacklisted(characterIds: string[]): Promise<Record<string, boolean>>
async listHrRoles(corporationId: string): Promise<HrRole[]>
async getUserHrCorporations(userId: string): Promise<string[]>
```

### 10. Bills (RPC + Workflow)
**File**: `/Users/ozzeh/src/tapi-workers/apps/bills/`
**Type**: Durable Object
**Key Responsibilities**:
- Corporate billing and payment tracking
- Workflow integration for approval processes

### 11. Broadcasts (RPC + Durable Object)
**File**: `/Users/ozzeh/src/tapi-workers/apps/broadcasts/`
**Type**: Durable Object (Singleton)
**Key Responsibilities**:
- System-wide announcements
- Message broadcasting to users/corporations

### 12. Groups (RPC + Durable Object + PostgreSQL)
**File**: `/Users/ozzeh/src/tapi-workers/apps/groups/`
**Type**: Durable Object (Singleton)
**Key Responsibilities**:
- User group management
- Group membership and permissions
- Discord server group sync

**Database**: PostgreSQL

### 13. Skills (RPC + Durable Object)
**File**: `/Users/ozzeh/src/tapi-workers/apps/skills/`
**Type**: Durable Object
**Key Responsibilities**:
- Skill planning and training
- Skill queue management
- Training time calculations

### 14. Freight (RPC + Durable Object)
**File**: `/Users/ozzeh/src/tapi-workers/apps/freight/`
**Type**: Durable Object
**Key Responsibilities**:
- Freight/logistics tracking
- Contract management

### 15. Markets (RPC + Durable Object + PostgreSQL)
**File**: `/Users/ozzeh/src/tapi-workers/apps/markets/`
**Type**: Durable Object
**Key Responsibilities**:
- Market price tracking
- Regional market data caching

**Database**: PostgreSQL

### 16. Notifications (RPC + Durable Object + PostgreSQL)
**File**: `/Users/ozzeh/src/tapi-workers/apps/notifications/`
**Type**: Durable Object (Singleton)
**Key Responsibilities**:
- User notification management
- WebSocket support for real-time notifications

**Database**: PostgreSQL

### 17. Features (RPC + Durable Object + PostgreSQL)
**File**: `/Users/ozzeh/src/tapi-workers/apps/features/`
**Type**: Durable Object (Singleton)
**Key Responsibilities**:
- Feature flag management
- A/B testing support

**Database**: PostgreSQL

### 18. EVE Static Data (HTTP Service)
**File**: `/Users/ozzeh/src/tapi-workers/apps/eve-static-data/`
**Type**: HTTP Service Worker
**Key Endpoints**:
- `/inventory/parse` - Parse EVE inventory format
- `/static/*` - Access static EVE data (types, groups, categories)

**Largest Worker** (460 lines): Contains comprehensive EVE static data loading from SQL dump

### 19. Orchestrator (Workflow + Cron)
**File**: `/Users/ozzeh/src/tapi-workers/apps/orchestrator/`
**Type**: Orchestration Worker (No Durable Objects)
**Cron**: Every 5 minutes (`*/5 * * * *`)

**Key Responsibilities**:
- Discord refresh workflow orchestration
- Batch task scheduling with jitter
- Load distribution across time

**Workflow**: `UserDiscordRefreshWorkflow`
- Executes Discord profile refresh for users
- Implements exponential backoff and retries
- Spreads load over 30-minute window via jitter

**Endpoints**:
- `POST /trigger/discord-refresh/:userId` - Manual single user trigger
- `POST /trigger/discord-refresh-batch` - Manual batch trigger
- Scheduled handler: Automatic batch every 5 minutes

---

## Shared Packages (packages/)

### 1. Database Utilities (`@repo/db-utils`)
**File**: `/Users/ozzeh/src/tapi-workers/packages/db-utils/src/`

**Exports**:
- `createDbClient()` - Factory for Drizzle ORM client
- `createDbClientRaw()` - Raw SQL client
- `createDbClientWs()` - WebSocket variant
- `migrate()` - Run migrations
- Drizzle operators: `eq`, `and`, `or`, `like`, `gt`, `lte`, `inArray`, etc.

**Pattern**: Single shared database for all workers

### 2. Durable Object Utils (`@repo/do-utils`)
**File**: `/Users/ozzeh/src/tapi-workers/packages/do-utils/src/index.ts`

**Core Function**:
```typescript
export function getStub<T>(
  namespace: DurableObjectNamespace,
  id: string | DurableObjectId
): T
```

**Benefits**:
- Type-safe DO access
- Handles both string IDs and DurableObjectId
- Used everywhere for cross-worker RPC calls

**Pattern**: `const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')`

### 3. HTTP Request Deduplication (`@repo/fetch-utils`)
**File**: `/Users/ozzeh/src/tapi-workers/packages/fetch-utils/src/`

**Features**:
- Prevents duplicate concurrent HTTP requests
- Authorization-aware key generation (BLAKE3 hashing)
- Statistics tracking
- Configurable deduplication strategies

**Use Case**: Optimize ESI API calls in Durable Objects

**Exports**:
```typescript
export class DedupedFetch
export function defaultAuthAwareKeyGenerator()
export function bodyAndAuthAwareKeyGenerator()
export function createDedupedFetch(config?: DedupConfig)
```

### 4. Hono Helpers (`@repo/hono-helpers`)
**File**: `/Users/ozzeh/src/tapi-workers/packages/hono-helpers/src/`

**Utilities**:
- `logger` - Tagged logging
- Error handlers: `withOnError()`, `withNotFound()`
- CORS middleware: `withDefaultCors()`
- Caching: `withCache()`, `TimeCache`
- Sentry integration: `withSentry()`
- Request logging: `getRequestLogData()`
- URL utilities: URL manipulation helpers

### 5. Authentication (`@repo/static-auth`)
**File**: `/Users/ozzeh/src/tapi-workers/packages/static-auth/src/`

**Purpose**: Static API key authentication for internal services

### 6. Domain-Specific Packages

#### EVE Token Store (`@repo/eve-token-store`)
Interface and types for token management

#### EVE Character Data (`@repo/eve-character-data`)
Interface for character-specific data

#### EVE Corporation Data (`@repo/eve-corporation-data`)
Interface for corporation-specific data

#### EVE Types (`@repo/eve-types`)
Branded type definitions for type safety:
```typescript
type EveCorporationId = EveBrandedType<string, 'EveCorporationId'>
type EveCharacterId = EveBrandedType<string, 'EveCharacterId'>
type EveAllianceId = EveBrandedType<string, 'EveAllianceId'>
// ... and 10+ more branded types
```

#### Admin (`@repo/admin`)
Admin operations interface for user/character management

#### Discord (`@repo/discord`)
Discord integration types and interfaces

#### Fleets (`@repo/fleets`)
Fleet operations interface

#### Groups (`@repo/groups`)
Group management interface

#### HR (`@repo/hr`)
HR operations (applications, blacklist, roles)

#### Skills (`@repo/skills`)
Skill planning interface

#### Freight (`@repo/freight`)
Freight/logistics interface

#### Broadcasts (`@repo/broadcasts`)
Broadcast system interface

#### Markets (`@repo/markets`)
Market data interface

#### Notifications (`@repo/notifications`)
Notification system interface

#### Features (`@repo/features`)
Feature flag interface

#### Hazmat (`@repo/hazmat`)
Utility package with shard key generation

#### Bills (`@repo/bills`)
Billing system interface

#### Queue Utils (`@repo/queue-utils`)
Queue message handling utilities

### 7. Configuration Packages

#### ESLint Config (`@repo/eslint-config`)
Shared ESLint configuration

#### TypeScript Config (`@repo/typescript-config`)
Shared TypeScript configurations (base, tools, vite, nextjs)

#### Tools (`@repo/tools`)
CLI scripts for development/deployment

#### Workspace Dependencies (`@repo/workspace-dependencies`)
Dependency version management

---

## Data Flow & Communication Patterns

### 1. HTTP Request Flow (User → UI → API)

```
User Browser
    ↓
[UI Worker] (pleaseignore.app/*)
    ├─ Static SPA assets (hashed = cached forever)
    ├─ HTML files (no-cache for fresh deploys)
    └─ Proxy: /login, /invite → [Core Worker]
        ↓
[Core Worker] (pleaseignore.app/api/*)
    ├─ Session middleware (validates cookie)
    ├─ Route handlers
    └─ RPC calls to Durable Objects / other workers
        ↓
    [EVE Token Store DO] - OAuth, token refresh, ESI requests
    [EVE Character Data DO] - Character-specific data
    [EVE Corporation Data DO] - Corporation data
    [HR DO] - Applications, blacklist
    [Discord DO] - Discord OAuth, messaging
    [Fleets DO] - Fleet operations
    [Skills DO] - Skill planning
    [Groups DO] - Group management
    ... etc
```

### 2. EVE Data Synchronization Flow

```
[Orchestrator Worker]
    (Cron: every hour)
    ↓
Get corporations needing refresh
    ↓
[Core Worker RPC]
    getCorporationsForBackgroundRefresh()
    ↓
For each corporation:
    Queue refresh messages
    ↓
[Eve Corporation Data Worker]
    Consumes queues (12 different refresh types)
    ↓
[Queue Consumers]
    - corp-public-refresh
    - corp-members-refresh
    - corp-wallets-refresh
    - corp-assets-refresh
    ... etc
    ↓
[EVE Token Store DO]
    fetchEsi() → ESI API
    ↓
[Database] PostgreSQL
    Store synchronized data
```

### 3. Discord User Refresh Workflow

```
[Orchestrator Worker]
    (Cron: every 5 minutes)
    ↓
Get users needing Discord refresh
    (users with lastDiscordRefresh > 30 minutes ago)
    ↓
[Core Worker RPC]
    getUsersForDiscordRefresh(limit=50, intervalMinutes=30)
    ↓
Create workflow instances with jitter
    (spread over 30-minute window)
    ↓
[UserDiscordRefreshWorkflow]
    ├─ Delay (jitter seconds)
    ├─ Call Discord API to fetch profile
    ├─ Update database
    ├─ Retry with exponential backoff on failure
    └─ Update lastDiscordRefresh timestamp
        ↓
[Database] PostgreSQL
    users.lastDiscordRefresh = now()
```

### 4. RPC Cross-Worker Communication

```
Pattern: Service Binding + Durable Object Stub

// Caller (e.g., Core Worker route handler)
const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
const token = await stub.getAccessToken(characterId)

// Called (e.g., EVE Token Store DO)
export class EveTokenStoreDO extends DurableObject<Env> implements EveTokenStore {
  async getAccessToken(characterId: string): Promise<string | null> {
    // Implementation
  }
}
```

**Key Points**:
- Type-safe via generic `getStub<T>()`
- Automatic serialization of request/response
- Instance ID determines which DO instance is called:
  - `'default'` - Singleton DOs (EVE_TOKEN_STORE, DISCORD, FLEETS, etc.)
  - `corporationId` - Per-corporation DO for EVE_CORPORATION_DATA
  - `characterId` - Per-character DO for EVE_CHARACTER_DATA

### 5. Queue-Based Batch Processing

```
// Producer (e.g., scheduled handler in orchestrator or cron in corporation data)
const queue = env['corp-members-refresh']
await queue.send({
  corporationId: '98000001',
  characterId: '2112345678'
}, { contentType: 'json' })

// Consumer (queue handler in eve-corporation-data)
export async function queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
  const queueName = batch.queue
  const handler = queueHandlers[queueName]
  await handler(batch, env, ctx)
}
```

**Queue Types in eve-corporation-data**:
- 12 specialized queues for different data refresh types
- Batch processing: max 10 items per batch (5 for assets due to size)
- Batch timeout: 30-60 seconds depending on type

---

## Key Patterns & Conventions

### 1. Durable Object Access Pattern

```typescript
// CORRECT - Always use getStub helper
import { getStub } from '@repo/do-utils'

const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')
const token = await stub.getAccessToken(characterId)

// WRONG - Never use direct namespace methods
const id = c.env.EVE_TOKEN_STORE.idFromName('default')  // ❌
const stub = c.env.EVE_TOKEN_STORE.get(id)
```

### 2. RPC Method Parameter Pattern

```typescript
// CRITICAL: Always pass entity IDs as parameters, NEVER extract from state.id

// CORRECT
export class EveCorporationDataDO extends DurableObject {
  async getMembers(corporationId: string): Promise<Member[]> {
    // corporationId parameter used in WHERE clause
    return db.query.members.findMany({
      where: eq(members.corporationId, corporationId)
    })
  }
}

// WRONG
export class EveCorporationDataDO extends DurableObject {
  constructor(state: DurableObjectState) {
    this.corporationId = state.id.name  // ❌ DON'T DO THIS
  }
  
  async getMembers(): Promise<Member[]> {
    // Missing WHERE clause - returns ALL corporations' data!
    return db.query.members.findMany()  // ❌ SECURITY BUG
  }
}
```

### 3. Database Schema Pattern

```typescript
// Each worker defines schema in src/db/schema.ts
// Shared pattern using Drizzle ORM with PostgreSQL

import { pgTable, text, integer, timestamp, serial } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  mainCharacterId: text('main_character_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})
```

### 4. Middleware Composition Pattern

```typescript
const app = new Hono<App>()
  .use('*', useWorkersLogger(...))  // Logging
  .use('*', sessionMiddleware())    // Session/auth
  .use('/api/*', csrfProtection()) // CSRF for state-changing
  .onError(withOnError())           // Error handler
  .notFound(withNotFound())         // 404 handler
  .route('/api/users', usersRoutes)
  // ... more routes
```

### 5. Two-Level Caching Pattern (EVE Token Store)

```typescript
// Level 1: SQLite in Durable Object (fast, local)
const cached = await this.state.storage.sql.exec<{response_data: string}>(
  `SELECT response_data FROM esi_cache WHERE cache_key = ?`,
  cacheKey
)

// Level 2: PostgreSQL in main database (shared, persistent)
// Not used for ESI caching, but available for data caching

// Cache Hierarchy:
// 1. In-memory (within request)
// 2. SQLite DO storage (within Durable Object)
// 3. PostgreSQL (shared across workers)
// 4. ESI API (source of truth)
```

### 6. Worker Configuration Pattern

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "worker-name",
  "main": "src/index.ts",
  "compatibility_date": "2025-04-28",
  "compatibility_flags": ["nodejs_compat"],
  
  // Database connection
  // (via DATABASE_URL env var)
  
  // Durable Objects bindings (for RPC)
  "durable_objects": {
    "bindings": [
      { "name": "INSTANCE_DO", "class_name": "ClassName", "script_name": "optional-for-external" }
    ]
  },
  
  // Service bindings (for RPC)
  "services": [
    { "binding": "CORE", "service": "core", "entrypoint": "CoreWorker" }
  ],
  
  // Queue bindings
  "queues": {
    "producers": [...],
    "consumers": [...]
  },
  
  // Migrations for Durable Objects with SQLite
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["ClassName"] }
  ],
  
  // Cron triggers
  "triggers": {
    "crons": ["0 * * * *"]  // hourly
  },
  
  // Workflows
  "workflows": [
    { "name": "workflow-name", "binding": "WORKFLOW", "class_name": "WorkflowClass" }
  ]
}
```

### 7. Error Handling Pattern

```typescript
// Always include error context in logging
logger.withTags({ characterId, operation: 'esi_fetch' })
  .error('ESI fetch failed', error)

// Return appropriate HTTP status codes
if (!response.ok) {
  return c.json(
    { error: error.message },
    { status: response.status }
  )
}

// For RPC errors, let them propagate (Cloudflare handles serialization)
throw new Error('User not found')
```

---

## Cloudflare Services Integration

### 1. Durable Objects
**Used By**: Every worker except UI, Orchestrator, EVE Static Data
**Pattern**: 
- Singleton instances: EVE_TOKEN_STORE, DISCORD, FLEETS, GROUPS, NOTIFICATIONS, FEATURES, BROADCASTS, BILLS, SKILLS
- Per-entity instances: EVE_CHARACTER_DATA (per character), EVE_CORPORATION_DATA (per corporation)

### 2. PostgreSQL (Neon Serverless)
**Connection**: DATABASE_URL environment variable
**Shared Database**: All workers access same PostgreSQL instance
**Schema**: ~30+ tables across all schemas

### 3. Workers KV
**Used By**: EVE_CORPORATION_DATA worker
**Purpose**: Directors cache (30-minute TTL) for performance
**Binding**: CACHE

### 4. Workers Queues
**Used By**: EVE_CORPORATION_DATA, EVE_CHARACTER_DATA
**Pattern**: 12+ specialized queues for different data refresh types
**Consumer Model**: Batch processing with configurable max batch size and timeout

### 5. Cloudflare Workflows
**Used By**: 
- Bills worker (approval workflows)
- Orchestrator worker (UserDiscordRefreshWorkflow)
**Features**:
- Durable execution
- Automatic retries with exponential backoff
- Step-based workflow definition

### 6. Cron Triggers
**Used By**: 
- EVE_CORPORATION_DATA: Hourly (`0 * * * *`)
- Orchestrator: Every 5 minutes (`*/5 * * * *`)
- EVE_CHARACTER_DATA: Per-character refresh cycles

### 7. Workers Static Assets
**Used By**: UI Worker
**Pattern**: SPA with single-page-application fallback mode
**Cache Control**: Smart headers based on file types

### 8. Service Bindings (RPC)
**Pattern**: `service: "service-name"` + `entrypoint: "ClassName"`
**Example**: 
```jsonc
{ "binding": "ADMIN", "service": "admin", "entrypoint": null }
{ "binding": "CORE", "service": "core", "entrypoint": "CoreWorker" }
```

---

## Database Schema Architecture

### Core Tables (PostgreSQL)

1. **Users & Authentication**
   - `users` - User accounts
   - `user_characters` - Character ownership
   - `user_sessions` - Session management
   - `user_discord_profile` - Discord linkage

2. **EVE Entity Mappings**
   - `eve_characters` - Character definitions
   - `eve_tokens` - OAuth tokens (encrypted)
   - `user_corporations` - Corporation membership

3. **HR System**
   - `applications` - Job applications
   - `application_activity` - Application audit log
   - `character_blacklist` - Blacklisted characters
   - `user_blacklist` - Blacklisted users
   - `hr_notes` - HR internal notes
   - `hr_roles` - HR role definitions
   - `recommendations` - Character recommendations

4. **Operational Data**
   - `corporation_config` - Corporation settings
   - `corporation_members` - Member rosters
   - `corporation_wallets` - Wallet data
   - `corporation_assets` - Asset listings
   - `fleet_invitations` - Fleet joins
   - `group_members` - Group membership
   - Discord-related tables for linking

### Durable Object SQLite Storage

1. **EVE Token Store**
   - `esi_cache` - ESI response caching (with ETag, pagination support)
   - `entity_cache` - Name/ID resolution cache

2. **Fleets**
   - `fleet_invitations` - Quick-join tokens
   - `fleet_memberships` - Fleet member tracking
   - `fleet_state_cache` - Wing/squad structure cache

3. **Other DOs**
   - Various per-DO tables defined in migrations

---

## Development & Deployment

### Build & Deployment
- **Framework**: Turborepo for monorepo orchestration
- **Language**: TypeScript (all code)
- **Module Format**: ES modules (not Service Worker)
- **Build Tool**: Vite for bundling
- **Linter**: ESLint with shared config
- **Test Framework**: Vitest with `@cloudflare/vitest-pool-workers`

### Key Commands
```bash
just install          # Install dependencies
just dev              # Start development servers
just build            # Build all workers
just test             # Run tests
just check            # Check types, lint, format
just fix              # Auto-fix issues
just deploy           # Deploy to Cloudflare
```

### Database Migrations
```bash
just db-generate <app-name>    # Generate migration from schema
just db-migrate <app-name>     # Run migration
just db-studio <app-name>      # Open Drizzle Studio
# NEVER use db-push (use migrations instead)
```

### Generator Commands
```bash
just gen                       # Create new worker
just new-package              # Create new shared package
just new-durable-object       # Create new Durable Object
```

---

## Security Considerations

1. **Token Encryption**: EVE and Discord tokens encrypted with AES-GCM
2. **Entity ID Isolation**: Always pass entity IDs as RPC parameters (prevent data leakage)
3. **Session Management**: Secure cookie-based sessions validated on each request
4. **CSRF Protection**: X-Requested-With header validation on state-changing API calls
5. **Admin Authorization**: Admin-only RPC methods include adminUserId parameter for audit
6. **Blacklist System**: Character and user blacklists prevent unauthorized access
7. **Auth-Aware Deduplication**: Request deduplication hashes Authorization headers

---

## Performance Optimizations

1. **Two-Level Caching**: SQLite (fast) + PostgreSQL (shared)
2. **Request Deduplication**: Prevent duplicate concurrent ESI API calls
3. **Pagination Support**: Handle multi-page ESI responses efficiently
4. **Connection Pooling**: Neon serverless handles connection management
5. **Batch Queue Processing**: Group operations for efficiency
6. **Jitter Distribution**: Spread load over time to prevent thundering herd

---

## Monitoring & Observability

1. **Logging**: Tagged logging via `workers-tagged-logger`
2. **Sentry Integration**: Error tracking and performance monitoring
3. **Logpush**: Enabled for core and eve-corporation-data workers
4. **Observability**: Head sampling rate = 1.0 for detailed tracing
5. **Release Tracking**: Sentry release versions tracked

---

## Future Extensibility

### Adding New Workers
1. Use `just gen` to scaffold
2. Define RPC interface in `@repo/package-name`
3. Implement Durable Object or Service Entrypoint
4. Register bindings in core worker's wrangler.jsonc
5. Add cross-worker communication via stubs

### Adding New Data Types
1. Define schema in worker's `src/db/schema.ts`
2. Create migrations
3. Add queue consumers if async processing needed
4. Implement RPC methods for access

### Adding New Scheduled Tasks
1. Add cron trigger to wrangler.jsonc
2. Implement scheduled handler export
3. Use queue system for batch operations

