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

**Correct Pattern:**
```typescript
import { getStub } from '@repo/do-utils'
import type { EveTokenStore } from '@repo/eve-token-store'

// Using a named ID
const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, 'default')

// Using a dynamic ID
const stub = getStub<EveTokenStore>(c.env.EVE_TOKEN_STORE, `user-${userId}`)

// Call methods on the stub
const token = await stub.getAccessToken(characterId)
```

**Incorrect Pattern (DO NOT USE):**
```typescript
// ❌ NEVER do this
const id = c.env.EVE_TOKEN_STORE.idFromName('default')
const stub = c.env.EVE_TOKEN_STORE.get(id)
```

**Benefits:**
- **Type Safety:** The generic parameter provides full TypeScript typing for stub methods
- **Consistency:** Single pattern used across the entire codebase
- **Simplicity:** Handles both string IDs and DurableObjectId instances automatically
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
  "logpush": true,
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
