# Architecture Documentation

This document describes the major architectural decisions, patterns, and design principles used throughout the Next Auth monorepo.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Architectural Principles](#core-architectural-principles)
3. [Critical Patterns](#critical-patterns)
4. [Worker Architecture](#worker-architecture)
5. [Database Architecture](#database-architecture)
6. [Security Architecture](#security-architecture)
7. [Notable Implementations](#notable-implementations)
8. [Testing Strategy](#testing-strategy)
9. [Performance Considerations](#performance-considerations)
10. [Migration Paths](#migration-paths)

---

## Architecture Overview

### System Design

```
┌─────────────────────────────────────────────────────────────┐
│                        User Requests                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Edge                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │   Core   │  │ Discord  │  │  Groups  │  │    UI    │   │
│  │  Worker  │  │  Worker  │  │  Worker  │  │  Worker  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │             │              │              │          │
└───────┼─────────────┼──────────────┼──────────────┼─────────┘
        │             │              │              │
        ▼             ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Durable Objects Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ EveTokenStore│  │   Discord    │  │    Groups    │      │
│  │      DO      │  │      DO      │  │      DO      │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │EveCharacter  │  │EveCorporation│  │Notifications │      │
│  │   Data DO    │  │   Data DO    │  │      DO      │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Storage Layer                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  PostgreSQL  │  │  Workers KV  │  │      R2      │      │
│  │    (Neon)    │  │   (Cache)    │  │   (Future)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
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

- **core**: Authentication, user management, orchestration
- **discord**: Discord OAuth and guild management
- **groups**: Group/category/membership management
- **notifications**: Real-time WebSocket notifications
- **eve-token-store**: EVE Online OAuth token lifecycle
- **eve-character-data**: EVE character wallet/assets/orders
- **eve-corporation-data**: EVE corporation data aggregation
- **eve-static-data**: EVE static database (SDE) API
- **ui**: React SPA static asset server

**Benefits:**

- Independent deployment
- Clear boundaries
- Type-safe RPC via shared packages (`@repo/*`)

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

### Pattern 2: Database Patterns - Avoiding BigInt Issues

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

### Pattern 3: Worker Structure - Hono Framework

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

### Pattern 4: WebSocket Hibernation API

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

### Pattern 5: Service Boundaries and RPC

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

**Primary Database:** PostgreSQL (Neon Serverless)

- **Type safety:** Drizzle ORM generates TypeScript types from schema
- **Performance:** Connection pooling, prepared statements
- **Serverless:** Auto-scaling, zero maintenance
- **Location:** Centralized (not edge) for strong consistency

**Caching Strategy:** Workers KV

- **Use case:** Frequently accessed, rarely changing data
- **Pattern:** Cache-aside with TTL
- **Invalidation:** Manual on mutations

**Example:**

```typescript
// Try cache first
const cached = await env.CACHE.get(key, { type: 'json' })
if (cached) return cached

// Fallback to database
const data = await db.query.categories.findMany()

// Update cache
await env.CACHE.put(key, JSON.stringify(data), { expirationTtl: 300 })

return data
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
├── apps/                   # Worker applications
│   ├── core/              # Main orchestration worker
│   ├── discord/           # Discord OAuth worker
│   ├── groups/            # Groups management worker
│   ├── notifications/     # WebSocket notifications worker
│   ├── eve-token-store/   # EVE token management worker
│   ├── eve-character-data/# EVE character data worker
│   ├── eve-corporation-data/ # EVE corp data worker
│   ├── eve-static-data/   # EVE SDE API worker
│   └── ui/                # React SPA worker
├── packages/              # Shared packages
│   ├── db-utils/         # Database utilities
│   ├── do-utils/         # Durable Object utilities
│   ├── hono-helpers/     # Hono middleware
│   ├── tools/            # CLI tools
│   ├── core/             # Core RPC types
│   ├── discord/          # Discord RPC types
│   ├── groups/           # Groups RPC types
│   ├── notifications/    # Notifications RPC types
│   ├── eve-token-store/  # EVE token store RPC types
│   ├── eve-character-data/ # EVE character data RPC types
│   └── eve-corporation-data/ # EVE corp data RPC types
├── turbo/                # Turborepo generators
├── CLAUDE.md            # Development guidelines
├── ARCHITECTURE.md      # This file
└── README.md            # Getting started
```

### Additional Resources

- [CLAUDE.md](./CLAUDE.md) - Development guidelines and patterns
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Hono Documentation](https://hono.dev/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [Turborepo Docs](https://turbo.build/repo)

---

**Last Updated:** 2025-10-22
**Maintained By:** Development Team
**Questions?** Check CLAUDE.md or ask in team chat
