# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Cloudflare Workers monorepo built with:
- **pnpm workspaces** for package management
- **Turborepo** for build orchestration and caching
- **Hono** as the web framework for workers
- **Drizzle ORM** with Neon serverless PostgreSQL
- **Vitest** with `@cloudflare/vitest-pool-workers` for testing
- **Vite** for bundling worker applications

---

## Cloudflare Workers Guidelines

When working with Cloudflare Workers in this repository, follow these principles:

### Code Standards
- **TypeScript by default** - Generate code in TypeScript unless JavaScript is specifically requested
- **ES modules format exclusively** - NEVER use Service Worker format
- **Import everything** - You MUST import all methods, classes and types used in the code
- **Use shared date parsing utility** - For server/workflow date coercion, use `parseDateOrNull` from `@repo/worker-utils` instead of ad-hoc `new Date(...)` + `Number.isNaN(...)` checks or one-off wrappers like `toDate`/`toDateOrNull`
- **Use official SDKs** - If there is an official SDK or library for a service, use it to simplify implementation
- **Minimize external dependencies** - Avoid libraries with FFI/native/C bindings
- **Include error handling and logging** - Add proper error boundaries and meaningful error messages
- **Comment complex logic** - Include comments explaining non-trivial code

### Configuration Requirements
- **Always use wrangler.jsonc** (not wrangler.toml)
- **Set compatibility_date** = "2025-03-07" or later
- **Set compatibility_flags** = ["nodejs_compat"]

- **Only include used bindings** - Don't include bindings that aren't referenced in code
- **Do NOT include dependencies** in wrangler.jsonc

### Security Guidelines
- **Never bake secrets into code** - Use environment variables
- **Implement proper request validation**
- **Use appropriate security headers**
- **Handle CORS correctly** when needed
- **Implement rate limiting** where appropriate
- **Sanitize user inputs**
- **Follow least privilege principle** for bindings

### WebSocket Guidelines
- **Use Durable Objects WebSocket Hibernation API** when providing WebSocket handling code within a Durable Object
- **Use `this.ctx.acceptWebSocket(server)`** to accept the WebSocket connection (NOT `server.accept()`)
- **Define `async webSocketMessage()` handler** that is invoked when a message is received from the client
- **Define `async webSocketClose()` handler** that is invoked when the WebSocket connection is closed
- **Do NOT use `addEventListener` pattern** inside a Durable Object - use the handler methods instead
- **Handle WebSocket upgrade requests explicitly**, including validating the Upgrade header

### Durable Objects Access Pattern
**CRITICAL:** Always use the `getStub` helper from `@repo/do-utils` to access Durable Object stubs. NEVER directly call `.idFromName()`, `.idFromString()`, or `.get()` on the namespace.

**IMPORTANT:** Only stubs that return RpcTarget instances need disposal. Regular DurableObject stubs don't have a `dispose()` method and don't need the `using` keyword.

**Correct Pattern (Regular DurableObject stubs - no disposal needed):**
```typescript
import { getStub } from '@repo/do-utils'
import type { Groups } from '@repo/groups'

// Regular DurableObject stub - no disposal needed
const stub = getStub<Groups>(c.env.GROUPS, 'default')
const groups = await stub.listGroups()
return c.json(groups)
```

**Correct Pattern (RpcTarget stubs - disposal needed):**
```typescript
import { getStub } from '@repo/do-utils'
import type { EveCharacterData } from '@repo/eve-character-data'

// RpcTarget stub - needs disposal (only if stub has dispose method)
// Note: Most stubs don't need 'using' - only those that return RpcTargets
const stub = getStub<EveCharacterData>(c.env.EVE_CHARACTER_DATA, characterId)
const instance = await stub.getInstance(characterId) // Returns RpcTarget
// If instance is an RpcTarget, use 'using' for it:
using charInstance = instance
const data = await charInstance.getKillmails()
// charInstance.dispose() is automatically called here
```

**Incorrect Pattern (DO NOT USE):**
```typescript
// ❌ NEVER do this - accessing namespace directly
const id = c.env.GROUPS.idFromName('default')
const stub = c.env.GROUPS.get(id)

// ❌ NEVER do this - using 'using' on regular DurableObject stubs
using stub = getStub<Groups>(c.env.GROUPS, 'default') // Not needed!
const groups = await stub.listGroups()
```

**Benefits:**
- **Type Safety:** The generic parameter provides full TypeScript typing for stub methods
- **Automatic Resource Management:** `getStub()` automatically adds `Symbol.dispose` only for RpcTarget stubs
- **No Memory Leaks:** RpcTarget stubs are properly disposed when needed
- **Simplicity:** Regular stubs work like normal variables - no special handling required
- **Consistency:** Single pattern used across the entire codebase
- **Maintainability:** Easier to update if Durable Object access patterns change

### Durable Objects Method Pattern
**CRITICAL:** NEVER rely on `state.id` for entity ID resolution. ALWAYS pass entity IDs explicitly as parameters to RPC methods.

**Why This Matters:**
- While Durable Objects are scoped by ID (via `getStub`), extracting IDs from `state.id.name` is unreliable
- Database queries without WHERE clauses will return data from ALL entities, causing data leakage
- This is a common source of bugs where one entity sees another entity's data

**Correct Pattern:**
```typescript
// ✅ ALWAYS pass entity IDs as parameters to all RPC methods
export class EveCorporationDataDO extends DurableObject implements EveCorporationData {
  // DO NOT store corporationId as instance property from state.id

  async getMembers(corporationId: string): Promise<Member[]> {
    // Always filter by the entity ID parameter
    return await this.db.query.members.findMany({
      where: eq(members.corporationId, corporationId)
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

**Incorrect Pattern (DO NOT USE):**
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
1. **Every RPC method must accept entity ID as first parameter** (after `this`)
2. **Every database query must include WHERE clause** filtering by that entity ID
3. **Never trust `state.id`** for entity identification in queries
4. **Callers must pass entity ID** even though it was used in `getStub()`

### Durable Objects SQLite Storage Pattern

**Overview:**
Durable Objects can use SQLite via `drizzle-orm/durable-sqlite` for structured, queryable persistent state. This provides type-safe database operations with migrations, going beyond simple KV storage.

**Benefits:**
- **Structured queries** - Use SQL to filter, join, and aggregate data
- **Type safety** - Full TypeScript typing with Drizzle ORM
- **Migrations** - Version-controlled schema changes
- **Performance** - SQLite is fast for reads and writes within a Durable Object
- **Persistence** - Data persists beyond the object's lifetime, stored in Durable Object storage

**File Structure:**
```
apps/your-app/
├── src/
│   ├── durable-object.ts          # Your Durable Object class
│   └── storage/
│       ├── index.ts                # Exports DB helpers and types
│       ├── schema.ts               # SQLite table definitions
│       ├── state.ts                # DB creation and migration runner
│       └── migrations/
│           ├── 0000_initial.sql    # Generated migration files
│           ├── migrations.js       # Migration bundle for Vite
│           └── meta/
│               ├── _journal.json   # Migration metadata
│               └── 0000_snapshot.json
├── drizzle-sqlite.config.ts        # Drizzle config for SQLite
└── package.json
```

**Step 1: Define Your Schema** (`src/storage/schema.ts`)
```typescript
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  value: integer('value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
```

**Step 2: Create Database Helpers** (`src/storage/state.ts`)
```typescript
import { drizzle } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'

import migrations from './migrations/migrations.js'
import * as schema from './schema'

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'

export type MyDb = DrizzleSqliteDODatabase<typeof schema>

export function createDb(storage: DurableObjectStorage): MyDb {
  return drizzle(storage, { schema, logger: false })
}

export async function runMigrations(db: MyDb): Promise<void> {
  migrate(db, migrations)
}
```

**Step 3: Export from Index** (`src/storage/index.ts`)
```typescript
import * as schema from './schema'
import { createDb, runMigrations } from './state'

import type { Item, NewItem } from './schema'
import type { MyDb } from './state'

export { createDb, runMigrations, schema, type Item, type MyDb, type NewItem }

// Re-export common Drizzle operators for convenience
export { eq, lt, lte, gt, gte, ne, inArray, notInArray, between, like, ilike } from 'drizzle-orm'
```

**Step 4: Configure Drizzle Kit** (`drizzle-sqlite.config.ts`)
```typescript
import 'dotenv/config'

import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './src/storage/migrations',
  schema: './src/storage/schema.ts',
  dialect: 'sqlite',
  driver: 'durable-sqlite',
  verbose: true,
  strict: true,
})
```

**Step 5: Add Package Scripts** (`package.json`)
```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate --config drizzle-sqlite.config.ts"
  }
}
```

**Step 6: Generate Initial Migration**
```bash
pnpm -F your-app db:generate
```

This creates migration files in `src/storage/migrations/`. You must create a `migrations.js` file to bundle them:

**Step 7: Create Migration Bundle** (`src/storage/migrations/migrations.js`)
```javascript
import m0000 from './0000_initial.sql?raw'
import journal from './meta/_journal.json'

export default {
  journal,
  migrations: {
    m0000,
  },
}
```

**IMPORTANT:** The `?raw` suffix tells Vite to import the SQL file as a raw string. Update this file every time you generate new migrations.

**Step 8: Use in Durable Object** (`src/durable-object.ts`)
```typescript
import { DurableObject } from 'cloudflare:workers'
import { createDb, runMigrations, eq } from './storage'
import type { MyDb, Item, NewItem } from './storage'
import type { Env } from './context'

export class MyDO extends DurableObject<Env> {
  private db: MyDb

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Create database instance
    this.db = createDb(state.storage)

    // Run migrations once during initialization
    // CRITICAL: Use blockConcurrencyWhile to ensure migrations complete before handling requests
    state.blockConcurrencyWhile(async () => {
      await runMigrations(this.db)
    })
  }

  async addItem(entityId: string, item: NewItem): Promise<Item> {
    const [inserted] = await this.db.insert(items)
      .values(item)
      .returning()
    return inserted
  }

  async getItems(entityId: string): Promise<Item[]> {
    // CRITICAL: Always filter by entity ID to prevent data leakage
    return await this.db.query.items.findMany({
      where: eq(items.id, entityId)
    })
  }

  async updateItem(entityId: string, id: string, updates: Partial<NewItem>): Promise<Item> {
    const [updated] = await this.db.update(items)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(items.id, id))
      .returning()
    return updated
  }

  async deleteItem(entityId: string, id: string): Promise<void> {
    await this.db.delete(items)
      .where(eq(items.id, id))
  }
}
```

**Migration Workflow:**

1. **Modify schema** in `src/storage/schema.ts`
2. **Generate migration**: `pnpm -F your-app db:generate`
3. **Update migration bundle**: Add new migration to `migrations.js`:
   ```javascript
   import m0000 from './0000_initial.sql?raw'
   import m0001 from './0001_add_column.sql?raw'  // New migration
   import journal from './meta/_journal.json'

   export default {
     journal,
     migrations: {
       m0000,
       m0001,  // Add here
     },
   }
   ```
4. **Deploy** - Migrations run automatically on first request to each Durable Object instance

**Key Differences from PostgreSQL Pattern:**

| Aspect | PostgreSQL (`@repo/db-utils`) | SQLite (Durable Objects) |
|--------|-------------------------------|--------------------------|
| **Driver** | `drizzle-orm/neon-serverless` | `drizzle-orm/durable-sqlite` |
| **Config** | `drizzle.config.ts` with `dialect: 'postgresql'` | `drizzle-sqlite.config.ts` with `dialect: 'sqlite'` and `driver: 'durable-sqlite'` |
| **Storage** | External Neon database | Durable Object storage (local to instance) |
| **Migration Import** | File paths in migration config | Raw SQL strings bundled with `?raw` suffix |
| **Migration Execution** | Separate migration script/command | Runs in `blockConcurrencyWhile` during DO initialization |
| **Scope** | Global, shared across all workers | Per Durable Object instance |

**CRITICAL: Migration Bundle Maintenance**
- Every time you run `drizzle-kit generate`, you must manually update `migrations.js` to include the new migration file
- Use sequential naming: `m0000`, `m0001`, `m0002`, etc.
- The `?raw` suffix is required for Vite to bundle SQL files correctly
- Forgetting to update `migrations.js` will cause migrations to not run

**Common Patterns:**

**Querying with Relations:**
```typescript
// Define relations in schema.ts
import { relations } from 'drizzle-orm'

export const itemsRelations = relations(items, ({ many }) => ({
  tags: many(itemTags),
}))

// Query with relations
const itemsWithTags = await this.db.query.items.findMany({
  with: { tags: true }
})
```

**Transactions:**
```typescript
await this.db.transaction(async (tx) => {
  await tx.insert(items).values(newItem)
  await tx.insert(logs).values(logEntry)
})
```

**Batch Operations:**
```typescript
// Insert multiple rows
await this.db.insert(items).values([item1, item2, item3])

// Delete multiple
await this.db.delete(items).where(inArray(items.id, idsToDelete))
```

**Reference Implementation:**
See `apps/esi/src/storage/` and `apps/esi/src/durable-object.ts` for a complete working example.

### Cloudflare Service Integrations

When data storage or specific capabilities are needed, integrate with appropriate Cloudflare services:

- **Workers KV** - Key-value storage for configuration data, user profiles, A/B testing
- **Durable Objects** - Strongly consistent state management, multiplayer coordination, agent use-cases, WebSocket handling
- **R2** - Object storage for structured data, AI assets, image assets, user-facing uploads
- **Queues** - Asynchronous processing and background tasks
- **Vectorize** - Store embeddings and support vector search (often with Workers AI)
- **Workers Analytics Engine** - Track user events, billing, metrics, high-cardinality analytics
- **Workers AI** - Default AI API for inference requests (use official SDKs for Claude or OpenAI if requested)
- **Browser Rendering** - Remote browser capabilities, web searching, Puppeteer APIs
- **Workers Static Assets** - Host frontend applications and static files
- **Workflows** - Durable execution, async tasks, human-in-the-loop workflows
- **Agents** - Build AI agents with state management and syncing APIs

---

## Repository-Specific Commands

### Development
```bash
# Install dependencies
just install
# or: pnpm install --child-concurrency=10

# Start dev servers (context-aware)
just dev
# or: bun runx dev

# Build all projects
just build
# or: bun turbo build

# Run tests
just test
# or: bun vitest
```

### Code Quality
```bash
# Check deps, lint, types, format
just check

# Auto-fix issues
just fix

# Check/fix specific aspects
just check -d    # deps only
just fix -d      # fix deps only
```

### Database Operations
```bash
# Generate migrations for all apps
just db-generate-all

# Generate for specific app
just db-generate <app-name>

# Run migrations
just db-migrate <app-name>

# Open Drizzle Studio
just db-studio <app-name>
```

**CRITICAL: NEVER USE `db-push` OR `drizzle-kit push`**
- **NEVER** run `just db-push` or `pnpm db:push` - not even in development
- **NEVER** run `drizzle-kit push` directly
- **ALWAYS** use migrations via `db:generate` and `db:migrate`
- **NEVER** run `db:generate` (or `just db-generate*`) automatically without an explicit user request in the current task
- Schema changes must be tracked in version control as migration files
- Using push bypasses migration history and can cause data loss

### Generators
```bash
# Create new worker
just gen
# or: just new-worker

# Create new package
just new-package

# Create new durable object
just new-durable-object
```

### Deployment
```bash
# Deploy all workers
just deploy
# or: bun turbo deploy
```

### Monitoring & Logs
```bash
# Tail logs for all workers (with auto-reconnect)
just tail-all

# Tail logs for specific worker
just tail <worker-name>
# or: pnpm -F <worker-name> tail
```

---

## Repository Architecture

### Workers (apps/)
Each worker application follows this structure:
- `src/index.ts` - Main Hono app export (default entry point)
- `src/context.ts` - TypeScript types for Hono app context (environment bindings)
- `src/test/integration/` - Integration tests using Vitest workers pool
- `wrangler.jsonc` - Cloudflare Workers configuration (JSON with comments)
- `vite.config.ts` - Vite bundler configuration
- `vitest.config.ts` - Test configuration with workers pool

### Shared Packages (packages/)

**Database & ORM (`@repo/db-utils`)**
- Drizzle ORM utilities for Neon serverless PostgreSQL
- `createDbClient(url, schema)` - Create typed database client
- `createDbClientRaw(url)` - Create client for raw SQL
- `migrate(db, config)` - Run Drizzle migrations
- Re-exports common Drizzle operators: `eq`, `and`, `or`, `like`, `inArray`, etc.

**Authentication (`@repo/static-auth`)**
- Static authentication middleware for Hono
- Shared authentication patterns for workers

**Durable Objects (`@repo/do-utils`)**
- Utilities and helpers for Cloudflare Durable Objects

**HTTP Request Optimization (`@repo/fetch-utils`)**
- Request deduplication to prevent duplicate concurrent HTTP requests
- Authorization-aware cache key generation using BLAKE3 hashing
- `DedupedFetch` class - Main deduplication implementation
- `defaultAuthAwareKeyGenerator()` - Secure key generation with hashed auth headers
- `bodyAndAuthAwareKeyGenerator()` - Includes request body in cache key
- Statistics tracking for monitoring deduplication effectiveness
- **Use case:** Optimize API calls in Durable Objects and Workers by preventing redundant concurrent requests to the same endpoint

**Web Framework (`@repo/hono-helpers`)**
- Common Hono middleware and utilities
- `withOnError()` - Error handler middleware
- `withNotFound()` - 404 handler middleware

**Development Tools (`@repo/tools`)**
- CLI tools and development scripts
- Scripts in `bin/` directory referenced by worker package.json files
- Provides commands like `run-vite-dev`, `run-wrangler-deploy`, `run-eslint`, `run-wrangler-tail`, etc.
- **Pattern for creating new utility scripts:**
  1. Create executable shell script in `packages/tools/bin/`
  2. Follow naming convention: `run-<tool>-<action>` (e.g., `run-wrangler-tail`)
  3. Use `#!/bin/sh` shebang and `set -eu` for error handling
  4. Make script executable: `chmod +x packages/tools/bin/run-<script-name>`
  5. Reference in worker package.json scripts section
  6. Add to generator templates for consistency across new projects

**Configuration Packages**
- `@repo/eslint-config` - Shared ESLint configuration
- `@repo/typescript-config` - Shared TypeScript configurations (base.json, tools.json, vite.json, nextjs.json)
- `@repo/workspace-dependencies` - Dependency management

---

## Important Patterns & Conventions

### TypeScript Configuration
**CRITICAL:** Always use fully-qualified package names when extending TypeScript configs:

Correct:
```json
{
  "extends": "@repo/typescript-config/base.json"
}
```

Incorrect:
```json
{
  "extends": "./base.json"
}
```

Relative paths fail to resolve across the monorepo structure.

### CSS Custom Properties for Colors
**CRITICAL:** Always use space-separated HSL format without explicit alpha for CSS custom properties.

**Correct Format:**
```css
:root {
  --primary: 205 85% 58%; /* ✅ Space-separated H S% L% */
  --muted: 220 14% 18%; /* ✅ Works with Tailwind filters */
  --background: 220 18% 8%; /* ✅ Default opacity is 1.0 */
}
```

**Incorrect Format (DO NOT USE):**
```css
:root {
  --primary: 205 85% 58% / 1; /* ❌ Explicit alpha breaks filters */
  --muted: hsl(220 14% 18%); /* ❌ Don't wrap in hsl() */
}
```

**Why This Matters:**
- Explicit alpha suffix (`/ 1`) breaks Tailwind filter utilities like `brightness-110`, `contrast-125`, etc.
- Tailwind's color system wraps custom properties with `hsl()` automatically
- Format: `hsl(var(--color))` becomes `hsl(205 85% 58%)` ✅
- Opacity modifiers still work: `bg-primary/50` applies 50% opacity correctly
- Filter utilities only work with the space-separated format without alpha

**Benefits:**
- Full compatibility with Tailwind's filter utilities (`brightness`, `contrast`, `saturate`, etc.)
- Opacity modifiers work as expected (`/50`, `/75`, etc.)
- Cleaner, more modern CSS syntax
- Consistent with CSS Color Module Level 4 specification

### Tailwind 4 Data-Attribute Variants
**IMPORTANT:** Tailwind CSS v4 supports data-attribute variants natively using bracket notation.

**Correct Syntax:**
```tsx
// Data-attribute variants work automatically in Tailwind v4
<button className="data-[state=checked]:bg-primary" />
<div className="data-[disabled]:opacity-50" />
<span className="data-[state=open]:rotate-180" />

// Can be combined with other modifiers
<button className="data-[state=checked]:hover:bg-primary/90" />
```

**Content Scanning Configuration:**
```typescript
// tailwind.config.ts
content: ['./index.html', './src/**/*.{html,js,jsx,ts,tsx}']
// Use broad patterns to ensure Tailwind discovers all variant usage
```

**How It Works:**
- Tailwind v4 automatically generates CSS for data-attribute variants
- No plugins or special configuration needed
- Bracket notation `data-[attribute=value]:utility` is converted to `[data-attribute=value] { ... }`
- Works seamlessly with Radix UI components that set data-state attributes

**Common Mistakes:**
- ❌ Content glob too narrow: `./src/client/**/*.{ts,tsx}` might miss files
- ❌ Using v3 syntax: `data-checked:bg-primary` (missing brackets)
- ❌ Adding custom variants manually (not needed in v4)

**If Variants Don't Work:**
1. Check content pattern in `tailwind.config.ts` is broad enough
2. Verify Tailwind is scanning the correct directories
3. Clear build cache and rebuild
4. Inspect compiled CSS for `[data-*]` selectors

### Database Pattern
Each worker app that uses a database:
1. Defines its schema using Drizzle ORM
2. Uses `@repo/db-utils` for client creation and migrations
3. Stores migrations in app-specific directories
4. Uses Neon serverless PostgreSQL via `@neondatabase/serverless`

**IMPORTANT: BigInt Handling**
- **Avoid using `bigint` column types unless absolutely necessary**
- The Neon serverless driver with Drizzle ORM has issues with JavaScript BigInt serialization
- Prefer `text` for storing large numbers as strings (e.g., ISK amounts, large IDs)
- Prefer `integer` for numeric IDs that fit within JavaScript's safe integer range (±2^53)
- If you must use `bigint`:
  - **NEVER wrap values with `BigInt()` when inserting** - pass the number directly
  - Values from the database will be returned as BigInt objects
  - Values must be converted to strings before JSON serialization

Database commands in apps should have these scripts:
- `db:generate` - Generate migrations from schema
- `db:migrate` - Run migrations
- `db:studio` - Open Drizzle Studio

**CRITICAL:** Never use `db:push` or `drizzle-kit push` even in development. Always use the migration workflow.

### Sentry Error Tracking Pattern

All workers use Sentry for error tracking via `@repo/hono-helpers`. Sentry automatically captures 5xx errors and unhandled exceptions with full request context.

**Configuration:**
- `SENTRY_DSN`: Set as Wrangler secret (not in wrangler.jsonc)
- `SENTRY_RELEASE`: Auto-populated with git SHA during deployment
- `ENVIRONMENT`: Set in wrangler.jsonc vars
- **Sampling:** 10% in production, 100% in development (automatic)
- **Filtering:** 4xx client errors are automatically excluded

**Usage in Workers:**
```typescript
import { withSentry, withOnError } from '@repo/hono-helpers'

const app = new Hono<App>()
  .onError(withOnError())  // Auto-captures errors to Sentry

// CRITICAL: Wrap app export with withSentry to initialize Sentry SDK
export default withSentry(app)
```

**Durable Objects:**
Automatic instrumentation is not supported in Cloudflare Workers. Use manual error capture in critical methods:
```typescript
import { captureException } from '@repo/hono-helpers'

export class MyDurableObject extends DurableObject<Env> {
  async criticalMethod(entityId: string) {
    try {
      // Business logic
      await this.performOperation(entityId)
    } catch (error) {
      // Capture error with context
      captureException(error as Error, {
        tags: {
          durableObject: 'MyDurableObject',
          method: 'criticalMethod',
          entityId
        },
        extra: { /* additional context */ }
      })
      throw error  // Re-throw to maintain error propagation
    }
  }
}
```

**Manual Error Capture:**
For capturing errors with additional context:
```typescript
import { captureException } from '@repo/hono-helpers'

try {
  await riskyOperation()
} catch (error) {
  captureException(error as Error, {
    tags: { operation: 'riskyOperation', userId: user.id },
    extra: { requestData: data }
  })
  throw error  // Re-throw to maintain error propagation
}
```

**Adding Sentry to New Workers:**
1. Add `SENTRY_DSN` secret via Wrangler: `pnpm -F worker-name wrangler secret put SENTRY_DSN`
2. Wrap Hono app export: `export default withSentry(app)`
3. For Durable Object workers, add manual error capture in critical methods using `captureException()`
4. Deploy and verify errors appear in Sentry dashboard

**IMPORTANT:** Generator templates (`just gen`) automatically include Sentry integration for new workers.

### HTTP Request Deduplication Pattern

When making external HTTP requests (especially in Durable Objects), use `@repo/fetch-utils` to prevent duplicate concurrent requests and improve performance.

**Key Benefits:**
- Prevents redundant API calls when multiple concurrent requests are made to the same endpoint
- Authorization-aware to prevent data leakage between users
- Reduces load on external APIs and improves response times
- Provides statistics for monitoring deduplication effectiveness

**Usage in Durable Objects:**

```typescript
import { DedupedFetch } from '@repo/fetch-utils'

export class MyDurableObject extends DurableObject {
  private dedupedFetch: DedupedFetch

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Initialize with default configuration
    this.dedupedFetch = new DedupedFetch()
    // Default uses auth-aware key generation with BLAKE3 hashing
  }

  async fetchData(url: string, token: string) {
    // Multiple concurrent calls with same URL and token = 1 fetch
    return this.dedupedFetch.fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
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
  debug: false // Enable for debugging deduplication
})
```

**Important Notes:**
- By default, only GET requests are deduplicated (safest for idempotent operations)
- Authorization headers are hashed using BLAKE3 to prevent storing sensitive credentials in cache keys
- Response bodies are cloned so each caller can consume them independently
- Use `getStats()` to monitor hits/misses for optimization insights

### Worker Development Pattern
Workers follow this structure:
```typescript
// src/index.ts
import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'
import { withNotFound, withOnError } from '@repo/hono-helpers'
import type { App } from './context'

const app = new Hono<App>()
  .use('*', middleware)
  .onError(withOnError())
  .notFound(withNotFound())
  .get('/', handler)

export default app
```

### Environment Variables
- **Never commit secrets to the repository**

### Package Scripts Convention
Workers and packages use standardized script names that reference `@repo/tools`:
- `dev` - Start development server (`run-vite-dev` or `run-wrangler-dev`)
- `build` - Build for production (`run-vite-build` or `run-wrangler-build`)
- `deploy` - Deploy to Cloudflare (`run-wrangler-deploy`)
- `tail` - Stream worker logs with auto-reconnect (`run-wrangler-tail`)
- `check:types` - Type checking (`run-tsc`)
- `check:lint` - Linting (`run-eslint`)
- `fix:workers-types` - Generate Cloudflare Worker types (`run-wrangler-types`)
- `test` - Run tests (`run-vitest`)

### Workspace Dependencies
- All internal packages use `@repo/` namespace
- Use `workspace:*` protocol for cross-package dependencies
- Use `pnpm -F <package-name>` for dependency management
- Use `pnpm turbo -F <package-name>` for build/test/deploy tasks

### Testing Pattern
Integration tests for workers:
```typescript
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../../index'

describe('Worker', () => {
  it('handles request', async () => {
    const request = new Request('http://example.com/')
    const ctx = createExecutionContext()
    const response = await worker.fetch(request, env, ctx)
    await waitOnExecutionContext(ctx)

    expect(response.status).toBe(200)
  })
})
```

---

## Code Style

- **Indentation:** Tabs for indentation, spaces for alignment
- **Imports:** Type imports use `import type`, workspace packages via `@repo/`
- **Import order:** Built-ins, Third-party, `@repo/`, Relative (enforced by Prettier)
- **Variables:** Prefix unused with `_`, prefer `const` over `let`
- **Worker Types:** Don't add 'WebWorker' lib to tsconfig or install `@cloudflare/workers-types` - types are generated by running `wrangler types` (via the `fix:workers-types` script) which creates `worker-configuration.d.ts` files

---

## React Development Guidelines

**CRITICAL: NEVER Silence React Lint Errors**

React lint rules exist to prevent serious bugs. **ALWAYS fix the underlying issue instead of silencing the warning.**

**Why This Matters:**
- ESLint rules like `react-hooks/rules-of-hooks` prevent violations of React's Rules of Hooks
- Silencing these errors with `// eslint-disable-next-line` masks bugs that cause unpredictable behavior
- React tracks hooks by call order - calling hooks conditionally or in loops breaks this system
- Symptoms: Random failures, inconsistent behavior, "works sometimes but not others"

**Common Mistakes:**

```typescript
// ❌ NEVER do this - silencing the error doesn't fix the bug!
const queries = characters.map((char) =>
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useCharacterMastery(...)  // Violates Rules of Hooks!
)
```

**Correct Approach:**

```typescript
// ✅ Fix the underlying issue - use useQueries for dynamic arrays
const queries = useQueries({
  queries: characters.map((char) => ({
    queryKey: skillPlanKeys.progress(planId, char.characterId),
    queryFn: () => api.checkProgress(planId, char.characterId),
    staleTime: 1000 * 60,
  })),
})
```

**Key Rules:**
1. **ALWAYS investigate and fix React lint errors** - they indicate real problems
2. **NEVER use `eslint-disable` for React hooks rules** - find the correct pattern instead
3. **Hooks must be called at the top level** - not inside loops, conditions, or nested functions
4. **Use React Query's `useQueries`** for dynamic arrays of queries
5. **Use `useMemo` or `useCallback`** for dynamic hook dependencies, not conditional calls

**When You See React Lint Errors:**
1. Read the error message carefully - it explains what rule was violated
2. Understand why the rule exists (usually to prevent bugs)
3. Research the correct React pattern to use instead
4. Refactor the code to follow React's rules
5. Only proceed when the lint error is genuinely resolved, not silenced

### Page Title Hook Usage

All navigable UI pages should set a browser tab title with `usePageTitle`.

- For every page route component that renders a navigable screen, import and call `usePageTitle(...)`.
- Use a stable fallback title for loading/error states and a dynamic title when entity data is available.
- Do **not** add `usePageTitle` to non-page wrappers such as layout routes, route-group containers, or dialog-only route files.

### EVE Online Image URLs

**CRITICAL: NEVER hardcode `images.evetech.net` URLs directly in UI components.**

All EVE image URLs must be constructed using the utility functions in `apps/ui/src/client/lib/eve-images.ts`. These route through the local proxy (`/images/...`) which provides 30-day Cloudflare edge caching for all image types.

**Available functions:**
```typescript
import {
  characterPortraitUrl,  // /images/characters/:id/portrait?size=N
  corporationLogoUrl,    // /images/corporations/:id/logo?size=N
  allianceLogoUrl,       // /images/alliances/:id/logo?size=N
  typeIconUrl,           // /images/types/:id/icon?size=N
  typeRenderUrl,         // /images/types/:id/render?size=N
  typeImageUrl,          // /images/types/:id/:variant?size=N  (for dynamic variants: bp, bpc)
} from '@/lib/eve-images'
```

**Correct:**
```tsx
<img src={characterPortraitUrl(characterId, 64)} />
<img src={corporationLogoUrl(corporationId, 32)} />
<img src={allianceLogoUrl(allianceId, 32)} />
<img src={typeIconUrl(typeId, 32)} />
<img src={typeRenderUrl(typeId, 512)} />
```

**Incorrect (DO NOT USE):**
```tsx
// ❌ Direct EVE image server URL
<img src={`https://images.evetech.net/characters/${id}/portrait?size=64`} />
// ❌ Inline proxy path string — use the function instead
<img src={`/images/characters/${id}/portrait?size=64`} />
```

The proxy routes are defined in `apps/core/src/routes/images.ts`.

### Form Controls And Dropdown UX

- **Do not use native `<select>` in UI routes/components** unless explicitly requested for a very specific platform behavior.
- **Use shared UI primitives**:
  - `Select` from `apps/ui/src/client/components/ui/select.tsx` for both standard dropdowns and searchable/async lookup dropdowns (`searchable` + `searchDelegate` when needed)
- **Keep popover list behavior/styling consistent** by relying on shared popover list styles/components in `apps/ui/src/client/components/ui/popover-list.tsx` (scroll buttons, item active/hover states, viewport).
- When migrating existing forms, prefer converting native selects to these shared components rather than introducing new one-off dropdown implementations.

---

## Dependency Management

### Syncpack
This project uses syncpack to ensure version consistency:
- All external dependencies are pinned (no semver ranges)
- Versions must be consistent across all packages
- Run `just check -d` to check for mismatches
- Run `just fix -d` to fix version issues

### Adding Dependencies
```bash
# To specific package (use pnpm -F for deps)
pnpm -F project-name add -D dev-dependency

# To root workspace
pnpm add -D tool-name
```

### Cross-Package Dependencies
```bash
# Add workspace package as dependency
pnpm -F worker-name add '@repo/package-name@workspace:*'
```

---

## Build Pipeline

Turborepo handles the build order defined in `turbo.json`:
1. Builds shared packages first (`^build` dependency)
2. Builds workers that depend on those packages
3. Uses topological sorting (`topo`) for correct order
4. Caches builds for speed

---

## Running Specific Workspaces

```bash
# Build specific package
pnpm turbo -F @repo/package-name build

# Run specific worker in dev mode
pnpm turbo -F worker-name dev

# Run command in all apps
pnpm turbo -F "./apps/*" dev
```

---

## CI/CD

GitHub Actions workflows:
- **branches.yml** - Runs on PRs: installs deps, runs checks/tests
- **release.yml** - Runs on main: tests, deploys all workers, creates release PRs with Changesets

Required secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

---

## Wrangler Configuration

Workers use `wrangler.jsonc` (JSON with comments). Standard configuration:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "worker-name",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "compatibility_flags": ["nodejs_compat"],
  "routes": [],
  "logpush": false,
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  "vars": {}
}
```

**Important:**
- Use `wrangler.jsonc` (not `wrangler.toml`)
- Set `compatibility_date` to "2025-03-07" or later
- Always include `compatibility_flags: ["nodejs_compat"]`
- Enable observability by default
- Do NOT include `dependencies` in wrangler.jsonc
- Only include bindings that are actually used in the code

---

## Context-Aware CLI

The `bun runx` command is context-aware:
- When run in a worker directory: executes worker-specific commands
- When run at root: executes workspace-wide commands
- Use `just dev` or `bun runx dev` to take advantage of this

---

## Generator Templates

Located in `turbo/generators/templates/`:
- `fetch-worker/` - Basic worker with Wrangler
- `fetch-worker-vite/` - Worker with Vite bundling
- `package/` - Shared package template

Use `just gen` to interactively create new workers or packages.

---

## Output Format for Code Generation

When generating new code:

1. **Use Markdown code blocks** to separate code from explanations
2. **Provide separate blocks for:**
   - Main worker code (index.ts/index.js)
   - Configuration (wrangler.jsonc)
   - Type definitions (if applicable)
   - Example usage/tests
3. **Always output complete files**, never partial updates or diffs
4. **Format code consistently** using standard TypeScript/JavaScript conventions

---

## Performance Guidelines

- **Optimize for cold starts** - Keep initialization lightweight
- **Minimize unnecessary computation**
- **Use appropriate caching strategies**
- **Consider Workers limits and quotas**
- **Implement streaming** where beneficial

---

## Error Handling

- **Implement proper error boundaries**
- **Return appropriate HTTP status codes**
- **Provide meaningful error messages**
- **Log errors appropriately**
- **Handle edge cases gracefully**
