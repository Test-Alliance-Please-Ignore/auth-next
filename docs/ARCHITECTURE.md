# Architecture Documentation

This document describes the major architectural decisions, patterns, and design principles used throughout the TAPI Workers monorepo.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Architectural Principles](#core-architectural-principles)
3. [Critical Patterns](#critical-patterns)
4. [Worker Architecture](#worker-architecture)
5. [Database Architecture](#database-architecture)
6. [Security Architecture](#security-architecture)
7. [Queue-Based Processing](#queue-based-processing)
8. [RPC Worker Pattern](#rpc-worker-pattern)
9. [Notable Implementations](#notable-implementations)
10. [Testing Strategy](#testing-strategy)
11. [Performance Considerations](#performance-considerations)
12. [Migration Paths](#migration-paths)

---

## Architecture Overview

### System Design

```
                           User Requests
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                        Cloudflare Edge Network                      │
│                                                                     │
│  HTTP Workers (Public-Facing)                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │   Core   │  │EveToken  │  │    UI    │  │EveStatic │          │
│  │  Worker  │  │  Store   │  │  Worker  │  │   Data   │          │
│  │  (RPC)   │  │  Worker  │  │  (SPA)   │  │  Worker  │          │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────────┘          │
│       │             │                                               │
│       │             │    RPC Workers (Service Bindings Only)       │
│       │             │    ┌──────────┐                              │
│       │             │    │  Admin   │                              │
│       │             │    │  Worker  │                              │
│       │             │    │  (RPC)   │                              │
│       │             │    └──────────┘                              │
└───────┼─────────────┼───────────────────────────────────────────────┘
        │             │
        │             └──────────────┐
        │                            │
        ▼                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                      Durable Objects Layer                          │
│                                                                     │
│  Singleton DOs (Shared State)                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ EveTokenStore│  │EveCharacter  │  │EveCorporation│            │
│  │      DO      │  │   Data DO    │  │   Data DO    │            │
│  │  (default)   │  │  (default)   │  │  (per corp)  │            │
│  │              │  │              │  │              │            │
│  │ SQLite Cache │  │ SQLite Cache │  │ PostgreSQL   │            │
│  └──────────────┘  └──────────────┘  └──────┬───────┘            │
│                                              │                     │
│  Per-User DOs (Isolated State)              │ Queue Producers     │
│  ┌──────────────┐  ┌──────────────┐         ▼                     │
│  │    Groups    │  │Notifications │  ┌──────────────┐            │
│  │      DO      │  │      DO      │  │   Queues     │            │
│  │  (per user)  │  │  (per user)  │  │ (Corp Data   │            │
│  │              │  │              │  │  Refresh)    │            │
│  │  PostgreSQL  │  │  PostgreSQL  │  └──────────────┘            │
│  └──────────────┘  └──────────────┘                               │
│                                                                     │
│  Service DOs (Isolated Services)                                   │
│  ┌──────────────┐                                                  │
│  │   Discord    │                                                  │
│  │      DO      │                                                  │
│  │  (per user)  │                                                  │
│  │              │                                                  │
│  │  PostgreSQL  │                                                  │
│  └──────────────┘                                                  │
└────────────────────────────────────────────────────────────────────┘
          │                            │
          ▼                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                         Storage Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │  PostgreSQL  │  │  Workers KV  │  │ DO SQLite    │            │
│  │    (Neon)    │  │  (Cache)     │  │ (Durable)    │            │
│  │              │  │              │  │              │            │
│  │ • Core DB    │  │ • Groups KV  │  │ • EVE tokens │            │
│  │ • Groups DB  │  │ • ESI cache  │  │ • ESI cache  │            │
│  │ • Discord DB │  │              │  │ • Discord    │            │
│  │ • Admin DB   │  │              │  │              │            │
│  │ • Notif DB   │  │              │  │              │            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
└────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

- **Platform:** Cloudflare Workers (Edge Compute)
- **Framework:** Hono (Fast web framework)
- **Database:** PostgreSQL via Neon (Serverless)
- **ORM:** Drizzle ORM (Type-safe SQL)
- **State Management:** Durable Objects (Strongly consistent)
- **Caching:** Workers KV (Global key-value store)
- **Build System:** Turborepo + pnpm workspaces
- **Bundler:** Vite (Workers) / Vite (React SPA)
- **Language:** TypeScript (100%)
- **Testing:** Vitest + @cloudflare/vitest-pool-workers

---

## Core Architectural Principles

### 1. **Edge-First Architecture**

All computation happens at Cloudflare's edge, as close to users as possible:

- **Zero cold starts** for most requests (Workers are pre-warmed)
- **Global distribution** across 300+ locations
- **Sub-10ms latency** for static content and cached data
- **Automatic scaling** without configuration

**Design Implication:** Workers must be stateless; all state goes into Durable Objects or databases.

### 2. **Service-Oriented Design**

Each worker is a microservice with a single responsibility:

**HTTP Workers (Public Routes):**

- **core**: Authentication, user management, API orchestration, HTTP + RPC endpoints
- **eve-token-store**: EVE Online OAuth token lifecycle, callback handling
- **eve-static-data**: EVE static database (SDE) API, KV-cached lookups
- **ui**: React SPA static asset server with intelligent caching

**RPC Workers (Service Bindings Only):**

- **admin**: Administrative operations (user deletion, character transfers, audit logging)

**Durable Object Workers (Both DO Implementations + Optional HTTP):**

- **discord**: Discord OAuth and guild management (per-user DO, PostgreSQL)
- **groups**: Group/category/membership management (per-user DO, PostgreSQL + KV cache)
- **notifications**: Real-time WebSocket notifications (per-user DO, PostgreSQL)
- **eve-character-data**: EVE character wallet/assets/orders (singleton DO, SQLite cache)
- **eve-corporation-data**: EVE corporation data aggregation (per-corp DO, PostgreSQL + Queues)

**Benefits:**

- Independent deployment and scaling
- Clear service boundaries and responsibilities
- Type-safe RPC via shared packages (`@repo/*`)
- Hybrid HTTP + RPC workers for flexibility
- RPC-only workers for sensitive operations

### 3. **Type Safety Everywhere**

TypeScript is used throughout with strict configuration:

- **No `any` types** (except during migrations)
- **Shared type packages** for Durable Object interfaces
- **Database schema** generates TypeScript types
- **API contracts** defined in shared packages

**Example:**

```typescript
import { getStub } from '@repo/do-utils'

import type { EveTokenStore } from '@repo/eve-token-store'

const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
const token = await stub.getAccessToken(characterId) // Fully typed!
```

### 4. **Security by Design**

Security is built into the architecture, not added later:

- **No hardcoded secrets** - all via environment variables
- **Encryption at rest** - sensitive data encrypted in database
- **Least privilege** - Durable Objects have minimal permissions
- **Token rotation** - automatic OAuth token refresh
- **Audit logging** - comprehensive activity tracking

---

## Critical Patterns

### Pattern 1: Durable Object Access via `getStub()`

**Decision:** All Durable Object access MUST use the `getStub()` helper from `@repo/do-utils`.

**Why:**

- **Type safety:** Generic parameter provides full TypeScript typing
- **Consistency:** Single pattern across entire codebase
- **Simplicity:** Handles both string IDs and DurableObjectId instances
- **Maintainability:** Easy to update if Cloudflare changes DO APIs

**Correct Pattern:**

```typescript
import { getStub } from '@repo/do-utils'

import type { EveTokenStore } from '@repo/eve-token-store'

// Using a named ID
const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')

// Using a dynamic ID
const stub = getStub<Notifications>(env.NOTIFICATIONS, userId)

// Call methods with full type safety
const token = await stub.getAccessToken(characterId)
```

**Anti-Pattern (NEVER DO THIS):**

```typescript
// ❌ WRONG - No type safety, violates standards
const id = env.EVE_TOKEN_STORE.idFromName('default')
const stub = env.EVE_TOKEN_STORE.get(id)

// ❌ WRONG - Casting defeats the purpose
const stub = getStub<Notifications>(
  this.notificationsStub as unknown as DurableObjectNamespace,
  adminId
)
```

**Implementation:** See `packages/do-utils/src/index.ts`

### Pattern 2: Durable Object Method Pattern - Always Pass Entity IDs

**Decision:** NEVER rely on `state.id` for entity ID resolution. ALWAYS pass entity IDs explicitly as parameters to RPC methods.

**Why:**

While Durable Objects are scoped by ID (via `getStub`), extracting IDs from `state.id.name` is unreliable and leads to critical bugs:

- Database queries without WHERE clauses will return data from ALL entities
- This causes data leakage where one entity sees another entity's data
- Entity ID must be passed both to `getStub()` AND to every method call
- This is a common source of bugs in DO-based architectures

**Correct Pattern:**

```typescript
// ✅ ALWAYS pass entity IDs as parameters to all RPC methods
export class EveCorporationDataDO extends DurableObject implements EveCorporationData {
  // DO NOT store corporationId as instance property from state.id

  async getMembers(corporationId: string): Promise<Member[]> {
    // Always filter by the entity ID parameter
    return await this.db.query.members.findMany({
      where: eq(members.corporationId, corporationId),
    })
  }

  async fetchData(corporationId: string): Promise<void> {
    // Pass entity ID to all internal methods
    await this.fetchAndStoreMembers(corporationId)
  }
}

// ✅ Caller provides the ID to both stub creation AND method calls
const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corpId)
const members = await stub.getMembers(corpId) // Pass ID again!
```

**Anti-Pattern (NEVER DO THIS):**

```typescript
// ❌ NEVER extract entity ID from state
export class EveCorporationDataDO extends DurableObject {
  private corporationId: string

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.corporationId = state.id.name // ❌ DON'T DO THIS!
  }

  // ❌ Methods without entity ID parameters
  async getMembers(): Promise<Member[]> {
    // ❌ Missing WHERE clause - returns ALL corporations' data!
    return await this.db.query.members.findMany()
  }
}
```

**Key Rules:**

1. Every RPC method must accept entity ID as first parameter (after `this`)
2. Every database query must include WHERE clause filtering by that entity ID
3. Never trust `state.id` for entity identification in queries
4. Callers must pass entity ID even though it was used in `getStub()`

**Implementation:** See CLAUDE.md for full pattern documentation.

### Pattern 3: Database Patterns - Avoiding BigInt Issues

**Decision:** Avoid `bigint` column types; use `text` for large numbers or `integer` when safe.

**Why:**
The Neon serverless driver with Drizzle ORM has serialization issues with JavaScript `BigInt`:

- BigInt values cannot be directly serialized to JSON
- Must be converted to strings before API responses
- Inserting with `BigInt()` wrapper causes driver errors

**Correct Pattern:**

```typescript
// Schema - use text for large numbers
export const characterWalletJournal = pgTable('character_wallet_journal', {
  journalId: text('journal_id').notNull(), // Large EVE ID as string
  amount: text('amount').notNull(), // ISK amount as string
  balance: text('balance').notNull(), // ISK balance as string
})

// Insert - pass values directly, no BigInt() wrapper
await db.insert(characterWalletJournal).values({
  journalId: entry.id, // ✅ Direct assignment
  amount: entry.amount.toString(), // ✅ Convert to string
  balance: entry.balance.toString(),
})

// Query - values come back as strings
const results = await db.query.characterWalletJournal.findMany()
return results.map((r) => ({
  journalId: r.journalId, // Already a string
  amount: r.amount, // Already a string
}))
```

**Anti-Pattern (NEVER DO THIS):**

```typescript
// ❌ WRONG - Wrapping with BigInt() causes errors
await db.insert(characterWalletJournal).values({
  journalId: BigInt(entry.id), // ❌ WRONG!
})
```

**Exception:** When `bigint` is unavoidable, use `{ mode: 'number' }` and ensure values fit in JavaScript's safe integer range (±2^53).

**Implementation:** See `apps/eve-corporation-data/src/db/schema.ts` for examples of text-based large numbers.

### Pattern 4: HTTP Request Deduplication

**Decision:** Use `@repo/fetch-utils` for HTTP request deduplication in Durable Objects to prevent duplicate concurrent requests.

**Why:**

- Prevents redundant API calls when multiple concurrent requests hit the same endpoint
- Authorization-aware to prevent data leakage between users (BLAKE3 hash of auth headers)
- Reduces load on external APIs (EVE ESI, Discord API)
- Improves response times and reduces costs

**Correct Pattern:**

```typescript
import { DedupedFetch } from '@repo/fetch-utils'

export class MyDurableObject extends DurableObject {
  private dedupedFetch: DedupedFetch

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    // Initialize with default auth-aware configuration
    this.dedupedFetch = new DedupedFetch()
  }

  async fetchData(url: string, token: string) {
    // Multiple concurrent calls with same URL and token = 1 fetch
    return this.dedupedFetch.fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
  }
}
```

**Custom Configuration:**

```typescript
// For authenticated POST requests with body awareness
this.dedupedFetch = new DedupedFetch({
  keyGenerator: bodyAndAuthAwareKeyGenerator,
  shouldDedupe: (input, init) => {
    const method = init?.method?.toUpperCase() || 'GET'
    return ['GET', 'POST'].includes(method)
  },
  debug: false, // Enable for debugging deduplication
})

// Monitor deduplication effectiveness
const stats = this.dedupedFetch.getStats()
console.log(`Cache hits: ${stats.hits}, misses: ${stats.misses}`)
```

**Key Features:**

- By default, only GET requests are deduplicated (safest for idempotent operations)
- Authorization headers are hashed using BLAKE3 to prevent storing sensitive credentials
- Response bodies are cloned so each caller can consume them independently
- Configurable key generation strategies (default, body-aware, custom)
- Statistics tracking for monitoring

**Benefits:**

- Reduces API call volume by 50-90% in typical scenarios
- Improves response times (cache hits are instant)
- Prevents rate limit exhaustion
- Authorization-aware prevents security issues

**Implementation:** See `packages/fetch-utils/src/index.ts` for full implementation.

### Pattern 5: Worker Structure - Hono Framework

**Decision:** All workers use Hono framework with standard middleware chain.

**Why:**

- **Performance:** Hono is one of the fastest web frameworks
- **Type safety:** First-class TypeScript support
- **Composability:** Middleware chain is clean and extensible
- **Developer experience:** Consistent patterns across all workers

**Standard Pattern:**

```typescript
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withNotFound, withOnError } from '@repo/hono-helpers'

import type { App } from './context'

const app = new Hono<App>()
  .use('*', (c, next) =>
    useWorkersLogger(c.env.NAME, {
      environment: c.env.ENVIRONMENT,
      release: c.env.SENTRY_RELEASE,
    })(c, next)
  )
  .onError(withOnError()) // ✅ Required
  .notFound(withNotFound()) // ✅ Required
  .get('/', handler)
  .post('/api/endpoint', handler)

export default app // ✅ Export Hono app, not { fetch }
```

**Context Pattern:**

```typescript
// context.ts
import type { HonoApp, SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers'

export interface Env extends SharedHonoEnv {
  // Bindings
  EVE_TOKEN_STORE: DurableObjectNamespace
  NOTIFICATIONS: DurableObjectNamespace

  // Environment variables
  DATABASE_URL: string
}

export interface Variables extends SharedHonoVariables {
  db: DbClient<typeof schema>
}

export interface App extends HonoApp {
  Bindings: Env
  Variables: Variables
}
```

**Benefits:**

- Error handling is consistent
- Logging is automatic
- Type safety for environment and variables
- Easy to add middleware

**Implementation:** See `apps/core/src/index.ts` for reference implementation.

### Pattern 6: WebSocket Hibernation API

**Decision:** All WebSocket handling uses Durable Objects with the Hibernation API.

**Why:**

- **Scale to millions:** Hibernation API allows DOs to handle many connections
- **Automatic state management:** Cloudflare manages connection state
- **Reliable delivery:** Built-in message queuing and retry

**Correct Pattern:**

```typescript
// Durable Object class
export class NotificationsDO implements DurableObject {
  async fetch(request: Request): Promise<Response> {
    // Validate WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade')
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }

    // Create WebSocket pair
    const { 0: client, 1: server } = new WebSocketPair()

    // ✅ CORRECT: Use this.ctx.acceptWebSocket()
    this.ctx.acceptWebSocket(server)

    // Store metadata with the connection
    server.serializeAttachment({
      userId,
      metadata: { connectedAt: new Date() },
    })

    return new Response(null, { status: 101, webSocket: client })
  }

  // ✅ CORRECT: Define handler methods
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    const attachment = ws.deserializeAttachment()
    // Handle message
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    // Handle disconnect
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    // Handle error
  }
}
```

**Anti-Pattern (NEVER DO THIS):**

```typescript
// ❌ WRONG - Don't call server.accept()
server.accept()

// ❌ WRONG - Don't use addEventListener in DOs
ws.addEventListener('message', handler)
```

**Implementation:** See `apps/notifications/src/durable-object.ts` for full implementation.

### Pattern 7: Service Boundaries and RPC

**Decision:** Workers communicate via Durable Object RPC, not HTTP.

**Why:**

- **Type safety:** Shared TypeScript interfaces
- **Performance:** Direct RPC is faster than HTTP
- **Reliability:** Built-in retry and error handling
- **Developer experience:** Feels like local function calls

**Pattern:**

```typescript
// Step 3: Use from another worker
// apps/core/src/services/auth.ts
import { getStub } from '@repo/do-utils'

import type { EveTokenStore } from '@repo/eve-token-store'

// Step 1: Define interface in shared package
// packages/eve-token-store/src/index.ts
export interface EveTokenStore {
  getAccessToken(characterId: number): Promise<string | null>
  refreshToken(characterId: number): Promise<boolean>
}

// Step 2: Implement in Durable Object
// apps/eve-token-store/src/durable-object.ts
export class EveTokenStoreDO implements DurableObject, EveTokenStore {
  async getAccessToken(characterId: number): Promise<string | null> {
    // Implementation
  }
}

const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
const token = await stub.getAccessToken(characterId)
```

**Benefits:**

- No manual HTTP request construction
- No manual response parsing
- Compile-time type checking
- Automatic serialization/deserialization

**Note:** For cross-service database access, this is a **temporary** pattern. Long-term, migrate to RPC:

```typescript
// ⚠️ TEMPORARY (MVP):
// groups worker directly queries core database tables
const users = await db.query.users.findMany()

// ✅ FUTURE:
// Create RPC methods in core worker
const users = await coreStub.lookupUsersByCharacter(characterId)
```

---

## Worker Architecture

### Request Flow

```
Request → Worker → Middleware Chain → Route Handler → Response
            ↓
       Logging
            ↓
       Auth Check
            ↓
       Validation
            ↓
       Business Logic
            ↓
       DO/Database
```

### Middleware Stack

1. **Logging** (`useWorkersLogger`) - Structured logging with context
2. **Authentication** (`sessionMiddleware`) - Optional session validation
3. **Authorization** (`requireAuth`, `requireAdmin`) - Route protection
4. **Validation** (`zValidator`) - Request/response validation
5. **Error Handling** (`withOnError`) - Global error handler
6. **404 Handler** (`withNotFound`) - Not found responses

### Service Layer Pattern

Workers use a service layer to separate concerns:

```typescript
// services/auth.service.ts
export class AuthService {
  constructor(
    private db: DbClient,
    private env: Env
  ) {}

  async createSession(userId: string): Promise<Session> {
    // Business logic
  }
}

// index.ts
const authService = new AuthService(db, env)
const session = await authService.createSession(userId)
```

**Benefits:**

- Testable business logic
- Reusable across routes
- Clear dependency injection

### Static Asset Serving Pattern

**Decision:** UI worker serves React SPA with intelligent cache control.

**Implementation:**

```typescript
.get('*', async (c) => {
  const url = new URL(c.req.url)
  const response = await c.env.ASSETS.fetch(c.req.raw)
  const newResponse = new Response(response.body, response)

  // HTML: Never cache
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    newResponse.headers.set('Cache-Control', 'no-cache, must-revalidate')
  }
  // Hashed assets: Cache forever
  else if (/\.[a-z0-9]{8,}\.(js|css)$/i.test(url.pathname)) {
    newResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  }
  // Other assets: Cache with revalidation
  else {
    newResponse.headers.set('Cache-Control', 'public, max-age=86400, must-revalidate')
  }

  return newResponse
})
```

**Why this works:**

- HTML always fresh → users see new deployments immediately
- Hashed assets cached forever → safe because hash changes with content
- Balance performance and freshness

---

## Database Architecture

### Database Strategy

The system uses a **multi-tier storage architecture** optimized for different access patterns and data durability requirements:

**1. PostgreSQL (Neon Serverless) - Durable Shared State**

- **Type safety:** Drizzle ORM generates TypeScript types from schema
- **Performance:** Connection pooling, prepared statements
- **Serverless:** Auto-scaling, zero maintenance
- **Location:** Centralized (not edge) for strong consistency
- **Used by:** core, groups, discord, notifications, admin, eve-corporation-data

**Database per Worker:**

- `core`: users, userCharacters, userSessions, managedCorporations, discordServers, etc.
- `groups`: categories, groups, groupMembers, groupAdmins, groupInvitations, permissions
- `discord`: discordUsers, guildMembers (per-user isolation)
- `notifications`: notifications, notificationAcknowledgements (per-user isolation)
- `admin`: adminOperationsLog (audit trail)
- `eve-corporation-data`: corporation public data, members, wallets, assets, etc. (per-corp isolation)

**2. Durable Object SQLite - Transient Cache**

- **Use case:** ESI API response caching with ETags
- **Durability:** Durable Object storage (persistent across restarts)
- **Isolation:** Per-DO instance (singleton or per-entity)
- **Used by:** eve-token-store, eve-character-data

**SQLite Schema Example:**

```typescript
// EVE Token Store DO - SQLite for encrypted tokens
await this.sql.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    characterId INTEGER PRIMARY KEY,
    accessToken TEXT NOT NULL,
    refreshToken TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    characterOwnerHash TEXT NOT NULL
  )
`)

// EVE Character Data DO - SQLite for ESI cache
await this.sql.exec(`
  CREATE TABLE IF NOT EXISTS esi_cache (
    path TEXT PRIMARY KEY,
    etag TEXT,
    data TEXT,
    expiresAt INTEGER
  )
`)
```

**3. Workers KV - Global Edge Cache**

- **Use case:** Frequently accessed, rarely changing data
- **Pattern:** Cache-aside with TTL
- **Invalidation:** Manual on mutations
- **Used by:** eve-static-data (EVE SDE lookups), groups (category cache)

**Example:**

```typescript
// Try KV cache first
const cached = await env.EVE_SDE_CACHE.get(key, { type: 'json' })
if (cached) return cached

// Fallback to external API
const data = await fetch(`https://esi.evetech.net${path}`)

// Update cache with long TTL
await env.EVE_SDE_CACHE.put(key, JSON.stringify(data), { expirationTtl: 86400 })

return data
```

### Storage Decision Matrix

| Data Type                 | Storage    | Reason                                    |
| ------------------------- | ---------- | ----------------------------------------- |
| User accounts, characters | PostgreSQL | Durable, relational, needs joins          |
| Groups, memberships       | PostgreSQL | Complex relationships, ACLs               |
| Discord state (per user)  | PostgreSQL | Per-user isolation, relational            |
| EVE OAuth tokens          | DO SQLite  | Encrypted, low-latency, singleton access  |
| ESI API cache             | DO SQLite  | Transient, ETag-based, per-DO instance    |
| EVE Static Data (SDE)     | Workers KV | Globally cacheable, rarely changes        |
| Group category cache      | Workers KV | Frequently read, rarely written           |
| Notifications (real-time) | PostgreSQL | Durable, needs ordering, per-user         |
| Corp data (ESI)           | PostgreSQL | Large datasets, complex queries, per-corp |

### Database Isolation Patterns

**Singleton Pattern (Shared State):**

```typescript
// One instance for all users - use for shared resources
const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
const stub = getStub<EveCharacterData>(env.EVE_CHARACTER_DATA, 'default')
```

**Per-User Pattern (Isolated State):**

```typescript
// One instance per user - use for user-specific data
const stub = getStub<Notifications>(env.NOTIFICATIONS, userId)
const stub = getStub<Discord>(env.DISCORD, userId)
const stub = getStub<Groups>(env.GROUPS, userId)
```

**Per-Entity Pattern (Isolated Resources):**

```typescript
// One instance per entity - use for entity-specific data
const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
```

### Schema Design Principles

1. **Explicit types over inference**

   ```typescript
   // ✅ Good
   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()

   // ❌ Bad
   createdAt: timestamp('created_at')
   ```

2. **Always include timestamps**

   ```typescript
   createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
   updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
   ```

3. **Indexes for foreign keys and queries**

   ```typescript
   ;(table) => [
     index().on(table.userId),
     index().on(table.groupId),
     unique().on(table.userId, table.groupId),
   ]
   ```

4. **Cascade deletes where appropriate**
   ```typescript
   groupId: uuid('group_id')
     .notNull()
     .references(() => groups.id, { onDelete: 'cascade' })
   ```

### Migration Pattern

```bash
# Generate migration from schema changes
just db-generate <app-name>

# Apply migrations (production)
just db-migrate <app-name>

# Push schema (development only)
just db-push <app-name>
```

**Important:** Never modify generated migrations manually. Change schema and regenerate.

### Connection Pattern

```typescript
// db/index.ts
import { createDbClient } from '@repo/db-utils'

import * as schema from './schema'

export function createDb(databaseUrl: string) {
  return createDbClient(databaseUrl, schema)
}

// Usage in worker/DO
const db = createDb(env.DATABASE_URL)
```

---

## Security Architecture

### Authentication Flow

```
User → EVE SSO → Authorization Code
  ↓
Core Worker → Exchange Code for Token
  ↓
EveTokenStore DO → Encrypt & Store Token
  ↓
Core Worker → Create Session
  ↓
User ← Session Cookie
```

### Token Management

**EVE Online Tokens:**

- Stored in `eve-token-store` Durable Object
- Encrypted at rest using AES-GCM
- Automatic refresh via Durable Object alarms
- Character owner hash tracked to detect transfers

**Discord Tokens:**

- Stored in `discord` Durable Object
- Encrypted at rest using AES-GCM
- Linked to core user ID
- Manual refresh on demand

### Session Management

**Implementation:**

- Cookie-based sessions
- Stored in core database
- Session expiration tracked
- CSRF protection via state parameter

**Middleware:**

```typescript
// Optional authentication
.use('*', sessionMiddleware())

// Required authentication
.use('/api/admin/*', requireAuth())

// Required admin role
.use('/api/admin/users', requireAdmin())
```

### Encryption Pattern

```typescript
// Encrypt sensitive data before storage
async function encrypt(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded)

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return btoa(String.fromCharCode(...combined))
}
```

### Environment Variables

**Never commit secrets to repository.**

```bash
# Set via wrangler
wrangler secret put EVE_SSO_CLIENT_SECRET
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put ENCRYPTION_KEY
```

**Access in code:**

```typescript
const clientSecret = env.EVE_SSO_CLIENT_SECRET
```

---

## Queue-Based Processing

### Overview

The `eve-corporation-data` worker uses Cloudflare Queues for background data refresh operations. This pattern decouples data fetching from API requests and enables reliable, retryable background processing.

### Architecture

```
API Request → DO Method → Queue Producer → Queue Message
                                 ↓
                          Queue Consumer (batch)
                                 ↓
                          DO Method (actual work)
                                 ↓
                          PostgreSQL Storage
```

### Queue Configuration

The worker defines **12 specialized queues** for different ESI endpoints:

```jsonc
// wrangler.jsonc
{
  "queues": {
    "producers": [
      { "queue": "corp-public-refresh", "binding": "corp-public-refresh" },
      { "queue": "corp-members-refresh", "binding": "corp-members-refresh" },
      { "queue": "corp-wallet-journal-refresh", "binding": "corp-wallet-journal-refresh" },
      // ... 9 more queues
    ],
    "consumers": [
      { "queue": "corp-public-refresh", "max_batch_size": 10, "max_batch_timeout": 30 },
      { "queue": "corp-members-refresh", "max_batch_size": 10, "max_batch_timeout": 30 },
      // ... with varying batch sizes and timeouts
    ],
  },
}
```

### Implementation Pattern

**Producer (from DO method):**

```typescript
// In Durable Object method
async queueRefreshPublicData(corporationId: string): Promise<void> {
  await this.env['corp-public-refresh'].send({
    corporationId,
    timestamp: Date.now()
  })
}
```

**Consumer (in worker index.ts):**

```typescript
// apps/eve-corporation-data/src/index.ts
import * as queueConsumers from './queue/consumers'

const queueHandlers = {
  'corp-public-refresh': queueConsumers.publicRefreshQueue,
  'corp-members-refresh': queueConsumers.membersRefreshQueue,
  // ... map all queues to handlers
}

export default {
  fetch: app.fetch.bind(app),
  async queue(batch: MessageBatch, env: Env, ctx: ExecutionContext): Promise<void> {
    const queueName = batch.queue as keyof typeof queueHandlers
    const handler = queueHandlers[queueName]

    if (!handler) {
      console.error(`No handler found for queue: ${batch.queue}`)
      return
    }

    await handler(batch, env, ctx)
  },
}
```

**Queue Consumer Handler:**

```typescript
// apps/eve-corporation-data/src/queue/consumers/public-refresh.ts
import { z } from 'zod'

import { createQueueConsumer } from '@repo/queue-utils'

const messageSchema = z.object({
  corporationId: z.string(),
  timestamp: z.number(),
})

export const publicRefreshQueue = createQueueConsumer(messageSchema, async (message, metadata) => {
  const stub = getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, message.corporationId)
  await stub.refreshPublicData(message.corporationId)
})
```

### Type-Safe Queue Utils

The `@repo/queue-utils` package provides:

- **Zod v4 Schema Validation**: Type-safe message schemas
- **Multiple Consumer Patterns**: Class-based and functional
- **Built-in Error Handling**: Automatic retry logic with configurable strategies
- **Batch Processing**: Concurrent message processing with configurable limits
- **Producer Utilities**: Type-safe message sending with validation
- **Lifecycle Hooks**: Hooks for batch start/complete and message success/error

**Example with Queue Utils:**

```typescript
// Type-safe producer
const producer = createQueueProducer(env.CHARACTER_UPDATE_QUEUE, messageSchema)
await producer.send({ characterId: '123', type: 'update' })

// Class-based consumer with hooks
class CharacterUpdateConsumer extends QueueConsumer {
  constructor() {
    super({
      schema: messageSchema,
      onBatchStart: (batch) => console.log(`Processing ${batch.messages.length} messages`),
      onMessageSuccess: (message) => console.log(`Processed ${message.characterId}`),
    })
  }

  async handleMessage(message, metadata) {
    // Process message
  }
}
```

### Benefits

- **Decoupled Processing**: API responds immediately, work happens in background
- **Automatic Retries**: Failed messages automatically retried with exponential backoff
- **Rate Limiting**: Batch size and timeout prevent overwhelming ESI API
- **Scalability**: Queues automatically scale with load
- **Observability**: Built-in statistics and logging
- **Type Safety**: Zod schemas ensure message validity

### Queue Strategy

Different queues have different batch configurations based on data characteristics:

- **High-frequency, small data** (public info, members): `max_batch_size: 10, max_batch_timeout: 30`
- **Low-frequency, large data** (assets): `max_batch_size: 5, max_batch_timeout: 60`
- **Medium frequency** (wallet journal, orders): `max_batch_size: 10, max_batch_timeout: 30`

**Implementation:** See `apps/eve-corporation-data/src/queue/` and `packages/queue-utils/`

---

## RPC Worker Pattern

### Overview

The system uses **WorkerEntrypoint** with **service bindings** to create RPC-only workers that expose methods callable from other workers. This pattern is used for sensitive operations that should not be exposed via HTTP.

### Pattern Components

1. **WorkerEntrypoint Class**: Extends Cloudflare's `WorkerEntrypoint` to define RPC methods
2. **Service Bindings**: Configure in `wrangler.jsonc` to allow worker-to-worker calls
3. **Shared Interface Package**: Define TypeScript interfaces in `@repo/*` packages
4. **RPC Service Layer**: Business logic separated into service classes

### Architecture

```
Core Worker (HTTP) → Service Binding → Admin Worker (RPC) → Core Database
                                              ↓
                                        AdminService
                                              ↓
                                        Durable Objects
```

### Implementation Pattern

**Step 1: Define Interface in Shared Package**

```typescript
// packages/admin/src/index.ts
export interface AdminWorker {
  deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult>
  transferCharacterOwnership(
    characterId: string,
    newUserId: string,
    adminUserId: string
  ): Promise<TransferCharacterResult>
  searchUsers(params: SearchUsersParams, adminUserId: string): Promise<SearchUsersResult>
}
```

**Step 2: Implement WorkerEntrypoint**

```typescript
// apps/admin/src/index.ts
import { WorkerEntrypoint } from 'cloudflare:workers'

import type { AdminWorker as IAdminWorker } from '@repo/admin'

export class AdminWorkerEntrypoint extends WorkerEntrypoint<Env> implements IAdminWorker {
  private getAdminService(): AdminService {
    const db = createDb(this.env.DATABASE_URL)
    const eveTokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
    return new AdminService(db, eveTokenStore, this.env.CORE)
  }

  async deleteUser(userId: string, adminUserId: string): Promise<DeleteUserResult> {
    const service = this.getAdminService()
    return await service.deleteUser(userId, adminUserId)
  }

  // Implement other methods...

  // Fetch handler - Required for deployment but not used
  override async fetch(): Promise<Response> {
    return new Response('Admin Worker - RPC only, not accessible via HTTP', {
      status: 404,
    })
  }
}

export default AdminWorkerEntrypoint
```

**Step 3: Configure Service Binding**

```jsonc
// apps/core/wrangler.jsonc
{
  "services": [
    {
      "binding": "ADMIN",
      "service": "admin",
      "entrypoint": "AdminWorkerEntrypoint", // Optional if worker exports single entrypoint
    },
  ],
}
```

**Step 4: Call from Another Worker**

```typescript
// apps/core/src/routes/admin.ts
import type { AdminWorker } from '@repo/admin'

app.delete('/api/admin/users/:userId', requireAdmin(), async (c) => {
  const userId = c.req.param('userId')
  const adminUserId = c.get('user').id

  // Call admin worker via RPC
  const result = await (c.env.ADMIN as AdminWorker).deleteUser(userId, adminUserId)

  return c.json(result)
})
```

### Hybrid Pattern: HTTP + RPC

The `core` worker demonstrates a hybrid approach - it exposes both HTTP endpoints AND RPC methods:

```typescript
// apps/core/src/index.ts
const app = new Hono<App>().get('/', handler).post('/api/auth', handler)
// ... HTTP routes

export default app // HTTP handler

// RPC entrypoint
export class CoreWorker extends WorkerEntrypoint<Env> {
  private service: CoreRpcService | null = null

  async searchUsers(params: SearchUsersParams): Promise<SearchUsersResult> {
    return this.getService().searchUsers(params)
  }

  async getUserDetails(userId: string): Promise<UserDetails | null> {
    return this.getService().getUserDetails(userId)
  }
  // ... RPC methods
}
```

### Benefits

- **Security**: Sensitive operations not exposed via HTTP
- **Type Safety**: Full TypeScript typing across service boundaries
- **Performance**: Direct RPC faster than HTTP (no serialization overhead)
- **Clean Separation**: Business logic isolated in service classes
- **Testability**: RPC methods easy to unit test
- **Audit Trail**: All admin operations logged with actor information

### When to Use RPC Pattern

**Use RPC Workers when:**

- Operations should not be publicly accessible
- Need type-safe cross-worker communication
- Implementing admin/privileged operations
- Service-to-service communication (no public API)

**Use HTTP Workers when:**

- Need public API endpoints
- Serving static assets
- OAuth callbacks
- User-facing routes

**Implementation:** See `apps/admin/` and `apps/core/src/services/core-rpc.service.ts`

---

## Notable Implementations

### 1. Director Manager (eve-corporation-data)

**Problem:** Accessing EVE corporation data requires a director-level character, but directors can go offline or revoke access.

**Solution:** Multi-director system with automatic failover.

```typescript
class DirectorManager {
  private directors: Map<number, DirectorHealth>

  async executeWithFailover<T>(operation: (characterId: number) => Promise<T>): Promise<T> {
    const healthyDirectors = this.getHealthyDirectors()

    for (const director of healthyDirectors) {
      try {
        const result = await operation(director.characterId)
        this.recordSuccess(director.characterId)
        return result
      } catch (error) {
        this.recordFailure(director.characterId)
        // Try next director
      }
    }

    throw new Error('All directors failed')
  }
}
```

**Features:**

- Health tracking (3 failures = unhealthy)
- Automatic recovery after success
- Round-robin with priority support
- Comprehensive error logging

**Implementation:** `apps/eve-corporation-data/src/director-manager.ts`

### 2. Batch Query Optimization (groups)

**Problem:** N+1 queries when listing groups with membership data.

**Solution:** Batch all related queries and map in-memory.

```typescript
async listGroups(categoryId: string, userId: string) {
  const groupIds = groups.map(g => g.id)

  // Batch query 1: All memberships
  const memberships = await db.query.groupMembers.findMany({
    where: inArray(groupMembers.groupId, groupIds)
  })

  // Batch query 2: All admin roles
  const admins = await db.query.groupAdmins.findMany({
    where: inArray(groupAdmins.groupId, groupIds)
  })

  // Batch query 3: Member counts
  const counts = await db
    .select({ groupId, count: count() })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds))
    .groupBy(groupMembers.groupId)

  // Map in memory
  return groups.map(group => ({
    ...group,
    isMember: memberships.some(m => m.groupId === group.id),
    isAdmin: admins.some(a => a.groupId === group.id),
    memberCount: counts.find(c => c.groupId === group.id)?.count ?? 0
  }))
}
```

**Result:** O(1) database queries instead of O(n).

**Implementation:** `apps/groups/src/durable-object.ts:298-347`

### 3. WebSocket Notification System

**Problem:** Need real-time notifications for group invites, member joins, etc.

**Solution:** Per-user Durable Objects with WebSocket Hibernation API.

**Features:**

- Multi-connection support (web + mobile)
- Acknowledgment tracking with retry
- Alarm-based retry for offline users
- Automatic cleanup on disconnect

**Message Flow:**

```
Action (e.g., invite) → NotificationService.send()
  ↓
Notifications DO → Store in database
  ↓
WebSocket → Send to client(s)
  ↓
Client → Acknowledge
  ↓
DO → Mark as read
```

**Implementation:** `apps/notifications/src/durable-object.ts`

### 4. ESI Caching with ETags (eve-corporation-data, eve-character-data)

**Problem:** EVE's ESI API rate limits aggressively.

**Solution:** ETags + conditional requests with SQLite caching.

```typescript
async fetchEsi<T>(path: string, characterId: number): Promise<EsiResponse<T>> {
  // Get cached ETag
  const cached = await this.getEsiCache(path)

  // Make conditional request
  const headers = cached?.etag
    ? { 'If-None-Match': cached.etag }
    : {}

  const response = await fetch(`https://esi.evetech.net${path}`, { headers })

  if (response.status === 304) {
    // Not modified - use cache
    return JSON.parse(cached.data)
  }

  // Update cache
  const data = await response.json()
  await this.setEsiCache(path, {
    etag: response.headers.get('ETag'),
    data: JSON.stringify(data),
    expiresAt: new Date(response.headers.get('Expires'))
  })

  return data
}
```

**Benefits:**

- Reduced API calls
- Faster responses
- Respects ESI caching directives

**Implementation:** `apps/eve-corporation-data/src/durable-object.ts`

---

## Testing Strategy

### Integration Testing Pattern

**Framework:** Vitest with `@cloudflare/vitest-pool-workers`

**Benefits:**

- Real Workers environment
- Real Durable Objects
- Real bindings
- Fast execution

**Pattern:**

```typescript
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getStub } from '@repo/do-utils'

import worker from '../../index'

import type { Groups } from '@repo/groups'

describe('Groups Worker', () => {
  it('creates a category', async () => {
    const request = new Request('http://example.com/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test Category' }),
    })

    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty('id')
  })
})

describe('Groups Durable Object', () => {
  it('can create category via RPC', async () => {
    const stub = getStub<Groups>(env.GROUPS, 'test-category')

    const category = await stub.createCategory(userId, {
      name: 'Test Category',
      description: 'Test Description',
    })

    expect(category).toHaveProperty('id')
    expect(category.name).toBe('Test Category')
  })
})
```

### Test Data Management

**Strategy:** Unique IDs per test to avoid collisions.

```typescript
const testId = `test-${Date.now()}-${Math.random()}`
const stub = getStub<Groups>(env.GROUPS, testId)
```

### Mocking Strategy

**Generally avoid mocks.** Use real Workers environment when possible.

**When to mock:**

- External APIs (EVE ESI, Discord API)
- Long-running operations
- Paid services

---

## Performance Considerations

### Edge Performance

**Workers are fast:**

- ~0.5ms CPU time for simple requests
- ~5-50ms for database queries (depends on location)
- ~100-500ms for ESI API calls (depends on endpoint)

**Optimization strategies:**

1. **Cache at the edge (KV)**

   ```typescript
   const cached = await env.CACHE.get(key)
   if (cached) return cached // <10ms
   ```

2. **Batch database queries**

   ```typescript
   // ❌ Bad - N queries
   for (const id of ids) {
     await db.query.items.findFirst({ where: eq(items.id, id) })
   }

   // ✅ Good - 1 query
   await db.query.items.findMany({ where: inArray(items.id, ids) })
   ```

3. **Parallel operations**

   ```typescript
   // ✅ Good - parallel
   const [characters, corporations] = await Promise.all([fetchCharacters(), fetchCorporations()])
   ```

4. **Pagination for large datasets**
   ```typescript
   const PAGE_SIZE = 100
   const results = await db.query.items.findMany({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
   ```

### Database Performance

**Indexes are critical:**

```typescript
;(table) => [
  index().on(table.userId), // For WHERE clauses
  index().on(table.createdAt), // For ORDER BY
  unique().on(table.userId, table.groupId), // Composite unique
]
```

**Query optimization:**

- Use `findFirst()` when you only need one row
- Use `inArray()` for batch lookups
- Avoid `count()` on large tables (cache counts)

### Durable Objects Performance

**Singleton pattern for stateless operations:**

```typescript
// ✅ Good - single instance
const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')

// ❌ Bad - one instance per user (if not needed)
const stub = getStub<EveTokenStore>(env.EVE_TOKEN_STORE, userId)
```

**Per-user pattern for stateful operations:**

```typescript
// ✅ Good - isolated state
const stub = getStub<Notifications>(env.NOTIFICATIONS, userId)
```

---

## Migration Paths

### Current State → Future State

#### 1. Cross-Service Database Access

**Current (Temporary):**

```typescript
// groups worker directly queries core database
const users = await db.query.users.findMany()
```

**Future (Planned):**

```typescript
// Add RPC methods to core worker
export interface Core {
  lookupUserByCharacter(characterId: number): Promise<User | null>
  lookupCharactersByUser(userId: string): Promise<Character[]>
}

// Use service binding from groups worker
const user = await coreStub.lookupUserByCharacter(characterId)
```

**Migration steps:**

1. Add methods to `packages/core/src/index.ts`
2. Implement in `apps/core/src/durable-object.ts`
3. Add CORE service binding to groups worker
4. Update groups to use RPC instead of direct DB
5. Remove core table definitions from groups

#### 2. Service Bindings vs Durable Objects

**Current:** Most inter-service communication via Durable Objects

**Future:** Consider Workers-to-Workers service bindings for:

- Synchronous request/response
- High throughput
- No state needed

**Example:**

```typescript
// wrangler.jsonc
{
  "services": [
    { "binding": "CORE", "service": "core", "environment": "production" }
  ]
}

// Usage
const response = await env.CORE.fetch(request)
```

**When to use Service Bindings:**

- No state needed
- High request rate
- Synchronous only

**When to use Durable Objects:**

- Need state management
- Need coordination
- Need WebSocket support

#### 3. Observability Improvements

**Current:** Basic logging with `workers-tagged-logger`

**Future:** Add structured observability:

- Sentry for error tracking
- Workers Analytics Engine for metrics
- Tail workers for log aggregation
- Distributed tracing

---

## Decision Log

### Why Cloudflare Workers?

**Alternatives considered:** AWS Lambda, Google Cloud Functions, Vercel Edge Functions

**Decision:** Cloudflare Workers

**Reasons:**

1. **Global edge network** - 300+ locations
2. **Zero cold starts** - always warm
3. **Durable Objects** - unique strong consistency primitive
4. **Cost efficiency** - free tier is generous, paid tier is cheap
5. **Developer experience** - excellent local development (wrangler)
6. **Performance** - industry-leading edge performance

### Why Hono over other frameworks?

**Alternatives considered:** Itty Router, Worktop, raw Workers

**Decision:** Hono

**Reasons:**

1. **Performance** - fastest web framework for Workers
2. **TypeScript** - first-class TS support with excellent inference
3. **Middleware** - clean, composable middleware system
4. **Compatibility** - works on Workers, Node, Bun, Deno
5. **Developer experience** - feels like Express but faster
6. **Type-safe routing** - route parameters are fully typed

### Why Drizzle ORM?

**Alternatives considered:** Prisma, Kysely, raw SQL

**Decision:** Drizzle ORM

**Reasons:**

1. **Type safety** - generates types from schema
2. **Performance** - minimal overhead, uses prepared statements
3. **Serverless-first** - designed for edge/serverless
4. **SQL-like** - chainable API that feels like SQL
5. **No code generation** - just TypeScript, no build step
6. **Migrations** - built-in migration system

### Why PostgreSQL (Neon)?

**Alternatives considered:** D1, Turso, PlanetScale

**Decision:** Neon PostgreSQL

**Reasons:**

1. **PostgreSQL** - industry standard, proven reliability
2. **Serverless** - auto-scaling, zero maintenance
3. **Cost** - competitive pricing with generous free tier
4. **Performance** - connection pooling, fast queries
5. **Compatibility** - works with all PostgreSQL tools
6. **Branching** - database branches for development

### Why pnpm + Turborepo?

**Alternatives considered:** npm workspaces, Yarn, Lerna

**Decision:** pnpm + Turborepo

**Reasons:**

1. **Disk efficiency** - pnpm saves massive disk space
2. **Speed** - fastest package manager
3. **Strict** - enforces proper dependency declaration
4. **Turborepo** - intelligent caching and parallel execution
5. **Monorepo support** - excellent workspace support
6. **Developer experience** - fast, reliable, predictable

---

## Appendix

### Useful Commands

```bash
# Development
just dev                    # Start dev servers (context-aware)
just dev <app-name>         # Start specific app dev server

# Testing
just test                   # Run all tests
just test <app-name>        # Run specific app tests

# Database
just db-generate <app>      # Generate migrations
just db-migrate <app>       # Run migrations
just db-studio <app>        # Open Drizzle Studio

# Code Quality
just check                  # Check everything
just fix                    # Auto-fix issues

# Deployment
just deploy                 # Deploy all workers
just deploy <app-name>      # Deploy specific worker

# Monitoring
just tail-all               # Tail logs for all workers
just tail <app-name>        # Tail specific worker logs
```

### Directory Structure

```
tapi-workers/
├── apps/                      # Worker applications
│   ├── admin/                 # Admin RPC worker (user/character management)
│   ├── core/                  # Main HTTP + RPC worker (auth, orchestration)
│   ├── discord/               # Discord OAuth DO worker (per-user)
│   ├── eve-character-data/    # EVE character data DO worker (singleton)
│   ├── eve-corporation-data/  # EVE corp data DO worker (per-corp, queues)
│   ├── eve-static-data/       # EVE SDE API worker (KV cache)
│   ├── eve-token-store/       # EVE token DO worker (singleton, SQLite)
│   ├── groups/                # Groups DO worker (per-user, PostgreSQL)
│   ├── notifications/         # WebSocket notifications DO worker (per-user)
│   └── ui/                    # React SPA static assets worker
├── packages/                  # Shared packages
│   ├── admin/                 # Admin RPC interface types
│   ├── db-utils/              # Database utilities (Drizzle ORM helpers)
│   ├── discord/               # Discord RPC interface types
│   ├── do-utils/              # Durable Object utilities (getStub helper)
│   ├── eslint-config/         # Shared ESLint configuration
│   ├── eve-character-data/    # EVE character data RPC types
│   ├── eve-corporation-data/  # EVE corporation data RPC types
│   ├── eve-token-store/       # EVE token store RPC types
│   ├── eve-types/             # Shared EVE Online type definitions
│   ├── fetch-utils/           # HTTP request deduplication utilities
│   ├── groups/                # Groups RPC interface types
│   ├── hazmat/                # Low-level utilities (encryption, etc.)
│   ├── hono-helpers/          # Hono middleware and utilities
│   ├── notifications/         # Notifications RPC interface types
│   ├── queue-utils/           # Type-safe Cloudflare Queues utilities
│   ├── static-auth/           # Static authentication middleware
│   ├── tools/                 # CLI development tools
│   ├── typescript-config/     # Shared TypeScript configurations
│   ├── worker-utils/          # Worker-specific utilities
│   └── workspace-dependencies/# Dependency management
├── turbo/                     # Turborepo configuration and generators
│   └── generators/
│       └── templates/
│           ├── durable-object-package/    # DO interface package template
│           ├── durable-object-worker/     # DO worker template
│           ├── package/                   # Generic package template
│           └── worker/                    # Generic worker template
├── docs/                      # Documentation
│   └── ARCHITECTURE.md        # This file
├── CLAUDE.md                  # Development guidelines for Claude Code
├── justfile                   # Just task runner commands
├── package.json               # Root workspace configuration
├── pnpm-workspace.yaml        # pnpm workspace definition
├── turbo.json                 # Turborepo pipeline configuration
└── README.md                  # Project overview and getting started
```

### Additional Resources

- [CLAUDE.md](./CLAUDE.md) - Development guidelines and patterns
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Documentation](https://hono.dev/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [Turborepo Docs](https://turbo.build/repo)

---

**Last Updated:** 2025-10-26
**Maintained By:** Development Team
