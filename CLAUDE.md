<cloudflare-workers-monorepo>

<title>Cloudflare Workers Monorepo Guidelines for Claude Code</title>

<setup>
## Local Development Setup

### Cloudflare Credentials (Required for Deployment)

To deploy workers locally using `just deploy`, you need to configure Cloudflare credentials:

1. **Copy the example environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Get your Cloudflare Account ID:**
   - Visit https://dash.cloudflare.com/
   - Copy your Account ID from the sidebar
   - Add to `.env`: `CLOUDFLARE_ACCOUNT_ID=your_account_id`

3. **Create a Cloudflare API Token:**
   - Visit https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use "Edit Cloudflare Workers" template or create custom token with Workers permissions
   - Copy the token
   - Add to `.env`: `CLOUDFLARE_API_TOKEN=your_api_token`

**Why this is needed:** Wrangler uses these credentials for authentication. Using API tokens instead of interactive OAuth allows parallel deployments to work correctly without port conflicts.

**Security:** The `.env` file is gitignored. Never commit credentials to the repository.
</setup>

<commands>
- `just install` - Install dependencies
- `just dev` - Run development servers (uses `bun runx dev` - context-aware)
- `just test` - Run tests with vitest (uses `bun vitest`)
- `just build` - Build all workers (uses `bun turbo build`)
- `just check` - Check code quality - deps, lint, types, format (uses `bun runx check`)
- `just fix` - Fix code issues - deps, lint, format, workers-types (uses `bun runx fix`)
- `just deploy` - Deploy all workers (uses `bun turbo deploy`)
- `just preview` - Run Workers in preview mode
- `just new-worker` (alias: `just gen`) - Create a new Cloudflare Worker
- `just new-package` - Create a new shared package
- `just new-durable-object` (alias: `just new-do`) - Create a new Durable Object with interface package
- `just migration-create <worker> <do-name> <description>` - Create a new migration file for a DO
- `just migration-status <worker> <do-name>` - Show migration status for a specific DO
- `just migration-validate` - Validate all migration files for syntax and sequence
- `just update deps` (alias: `just up deps`) - Update dependencies across the monorepo
- `just update pnpm` - Update pnpm version
- `just update turbo` - Update turbo version
- `just cs` - Create a changeset for versioning
- `bun turbo -F worker-name dev` - Start specific worker
- `bun turbo -F worker-name test` - Test specific worker
- `bun turbo -F worker-name deploy` - Deploy specific worker
- `bun vitest path/to/test.test.ts` - Run a single test file
- `pnpm -F @repo/package-name add dependency` - Add dependency to specific package
</commands>

<architecture>
- Cloudflare Workers monorepo using pnpm workspaces and Turborepo
- `apps/` - Individual Cloudflare Worker applications
- `packages/` - Shared libraries and configurations
  - `@repo/eslint-config` - Shared ESLint configuration
  - `@repo/typescript-config` - Shared TypeScript configuration
  - `@repo/hono-helpers` - Hono framework utilities
  - `@repo/tools` - Development tools and scripts
  - `@repo/do-utils` - Durable Object utilities (getStub helper)
  - `@repo/do-migrations` - Migration system for Durable Objects
  - `@repo/session-store` - SessionStore DO interface
  - `@repo/character-data-store` - CharacterDataStore DO interface
  - `@repo/user-token-store` - UserTokenStore DO interface
- Worker apps delegate scripts to `@repo/tools` for consistency
- Hono web framework with helpers in `@repo/hono-helpers`
- Vitest with `@cloudflare/vitest-pool-workers` for testing
- Syncpack ensures dependency version consistency
- Turborepo enables parallel task execution and caching
- Workers configured via `wrangler.jsonc` with environment variables
- Each worker has `context.ts` for typed environment bindings
- Integration tests in `src/test/integration/`
- Workers use `nodejs_compat` compatibility flag
- GitHub Actions deploy automatically on merge to main
- Changesets manage versions and changelogs
- Migration system manages DO SQLite schema evolution
</architecture>

<durable-objects>
## State Management with Durable Objects

This project uses Cloudflare Durable Objects for stateful operations with SQLite storage. Durable Objects provide strong consistency guarantees and can be accessed across workers.

### Creating New Durable Objects

Use the generator to scaffold new Durable Objects:

```bash
just new-durable-object  # or: just new-do
```

This creates:
1. A shared interface package in `packages/` (e.g., `@repo/my-store`)
2. The DO class implementation in the specified worker app
3. Proper wrangler.jsonc bindings configuration
4. Initial test files

The generator ensures the correct architecture pattern is followed automatically.

### Architecture Pattern

1. **Shared Interface Packages**: Each Durable Object type has a dedicated package exporting only TypeScript interfaces:
   - `@repo/session-store` - User sessions, OAuth, account/character linking
   - `@repo/character-data-store` - EVE character/corporation data tracking
   - `@repo/user-token-store` - EVE SSO token management

2. **Implementation**: Durable Object classes are defined in their respective worker apps (e.g., `apps/core/src/session-store.ts`)

3. **Cross-Worker Access**: Workers can access DOs from other workers using bindings with `script_name` in `wrangler.jsonc`

### Usage Pattern

Use the `getStub` helper from `@repo/do-utils` for type-safe DO access:

```typescript
import { getStub } from '@repo/do-utils'
import type { SessionStore } from '@repo/session-store'

// In your worker code
const stub = getStub<SessionStore>(c.env.USER_SESSION_STORE, 'global')
const session = await stub.getSession(sessionId)
```

### Key Principles

- **SQLite Storage Required**: ALL Durable Objects MUST use SQLite storage. Always use `new_sqlite_classes` in migrations, never `new_classes`. Using `new_classes` creates a non-SQLite DO that cannot be converted without deleting all data.
- **Wrangler Migrations**: DO NOT modify `migrations` in `wrangler.jsonc` unless specifically asked. These tags only control Durable Object creation/deletion, NOT SQL migrations. SQL migrations are handled by the DO migration system.
- **Untyped Namespaces**: Environment bindings use `DurableObjectNamespace` (untyped) in `context.ts`
- **Type at Call Site**: Apply interface type when calling `getStub<T>()`
- **Shared Interfaces**: Import interface types from `@repo/*` packages, never from implementation files
- **Single Source of Truth**: DO interfaces are defined once in shared packages and used everywhere

### Example Configuration

In `wrangler.jsonc`:
```json
{
  "durable_objects": {
    "bindings": [
      {
        "name": "USER_SESSION_STORE",
        "class_name": "SessionStore",
        "script_name": "core"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["SessionStore"]
    }
  ]
}
```

In `context.ts`:
```typescript
export type Env = {
  USER_SESSION_STORE: DurableObjectNamespace  // Untyped
}
```

### Testing

Use `getStub` in tests with unique DO IDs per test:
```typescript
import { getStub } from '@repo/do-utils'
import type { SessionStore } from '@repo/session-store'

const stub = getStub<SessionStore>(env.USER_SESSION_STORE, 'test-unique-id')
```
</durable-objects>

<do-migrations>
## Durable Object Migration System

This project uses a SQL migration system for managing Durable Object SQLite schemas. Migrations are automatically applied when DOs initialize.

### Migration Files

Migrations are stored as SQL files in each worker:
- Location: `apps/[worker]/migrations/[DOClassName]/`
- Naming: `001_description.sql`, `002_description.sql`, etc.
- Format: Plain SQL statements

### Creating Migrations

When you need to modify a DO's schema (add tables, columns, indexes, etc.):

```bash
# Create a new migration file
just migration-create <worker> <DOClassName> <description>

# Example: Add OAuth fields to SessionStore
just migration-create core SessionStore add_oauth_fields
# Creates: apps/core/migrations/SessionStore/002_add_oauth_fields.sql
```

Then edit the created SQL file with your schema changes:
```sql
-- Migration: add_oauth_fields
-- Version: 2
-- Created: 2024-01-18

ALTER TABLE sessions ADD COLUMN oauth_provider TEXT;
ALTER TABLE sessions ADD COLUMN oauth_expires_at INTEGER;
CREATE INDEX idx_sessions_oauth ON sessions(oauth_provider, oauth_expires_at);
```

### Migration Commands

- `just migration-create <worker> <do-name> <description>` - Create new migration file
- `just migration-status <worker> <do-name>` - Check which migrations are pending
- `just migration-validate` - Validate all migrations for syntax and sequence

### How Migrations Work

1. **Automatic Execution**: Migrations run automatically when a DO initializes
2. **Tracking**: Applied migrations are tracked in a `_migrations` table with checksums
3. **Ordering**: Migrations run in numerical order (001, 002, 003, etc.)
4. **Safety**: Checksums prevent tampering with applied migrations
5. **Locking**: Concurrent migration attempts are prevented via locks

### DO Implementation Pattern

All DOs extend `MigratableDurableObject` and load migrations:

```typescript
import { MigratableDurableObject, loadMigrationsFromBuild } from '@repo/do-migrations'
import { sessionStoreMigrations } from './migrations'

export class SessionStore extends MigratableDurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, {
      migrationDir: 'SessionStore',
      autoMigrate: true,
      verbose: env.ENVIRONMENT === 'development',
    })
  }

  protected async loadMigrations() {
    return loadMigrationsFromBuild(sessionStoreMigrations)
  }
}
```

The `migrations.ts` file imports SQL files:
```typescript
// @ts-expect-error - Build tools handle ?raw imports
import migration001 from '../migrations/SessionStore/001_initial_schema.sql?raw'
import migration002 from '../migrations/SessionStore/002_add_oauth_fields.sql?raw'

export const sessionStoreMigrations: Record<string, string> = {
  '001_initial_schema.sql': migration001,
  '002_add_oauth_fields.sql': migration002,
}
```

### Important Migration Rules

1. **Sequential Numbering**: Never skip numbers (001, 002, 003...)
2. **No Modifications**: Never modify a migration after it's been deployed
3. **Forward Only**: No rollback support currently - migrations only go forward
4. **Test First**: Test migrations locally before deploying to production
5. **Small Changes**: Keep migrations focused on single changes when possible

### Adding Migrations to Existing DOs

When adding a new feature that requires schema changes:

1. Create the migration: `just migration-create worker DOName feature_name`
2. Write the SQL changes in the created file
3. Update the `migrations.ts` file to import the new SQL file
4. The migration will run automatically on next deployment

### New Durable Objects

The generator (`just new-durable-object`) automatically:
- Creates initial migration file (`001_initial_schema.sql`)
- Sets up `migrations.ts` file
- Extends `MigratableDurableObject`
- Creates migration directory structure

### Troubleshooting

- **Migration fails**: Check logs - the DO won't mark failed migrations as complete
- **Checksum errors**: Never modify applied migrations - create new ones instead
- **Missing migrations**: Ensure sequential numbering with no gaps
- **Type errors**: Run `pnpm install` after adding @repo/do-migrations dependency
</do-migrations>

<code-style>
- Use tabs for indentation, spaces for alignment
- Type imports use `import type`
- Workspace imports use `@repo/` prefix
- Import order: Built-ins → Third-party → `@repo/` → Relative
- Prefix unused variables with `_`
- Prefer `const` over `let`
- Use `array-simple` notation
- Explicit function return types are optional
</code-style>

<critical-notes>
- TypeScript configs MUST use fully qualified paths: `@repo/typescript-config/base.json` not `./base.json`
- Do NOT add 'WebWorker' to TypeScript config - types are in worker-configuration.d.ts or @cloudflare/workers-types
- For lint checking: First `cd` to the package directory, then run `bun turbo check:types check:lint`
- Use `workspace:*` protocol for internal dependencies
- Use `bun turbo -F` for build/test/deploy tasks
- Use `pnpm -F` for dependency management (pnpm is still used for package management)
- Commands delegate to `bun runx` which provides context-aware behavior
- Test commands use `bun vitest` directly, not through turbo
- NEVER create files unless absolutely necessary
- ALWAYS prefer editing existing files over creating new ones
- NEVER proactively create documentation files unless explicitly requested
</critical-notes>

<esi-api-reference>
## EVE Online ESI API Reference

When you need to interact with the EVE Online ESI (EVE Swagger Interface) API, refer to the `llms.esi.txt` file in the project root. This file contains comprehensive, LLM-optimized documentation for the ESI API.

### Using the ESI API Documentation

The `llms.esi.txt` file provides:
- Complete endpoint documentation with examples
- OAuth2 authentication flows and scopes
- Request/response formats
- Rate limiting guidelines
- Common workflows and patterns
- ID type references

### Key Points When Using ESI

1. **Always include the compatibility date header**:
   ```http
   X-Compatibility-Date: 2025-09-30
   ```

2. **Base URL for all requests**:
   ```
   https://esi.evetech.net
   ```

3. **Authentication**:
   - Public endpoints work without authentication
   - Private endpoints require OAuth2 tokens with specific scopes
   - Scopes follow pattern: `esi-{category}.{action}_{resource}.v1`

4. **Common Patterns**:
   - Use ETags for caching (`If-None-Match` header)
   - Implement exponential backoff on 420 (rate limit) responses
   - Paginate large result sets using `?page=` parameter
   - Batch ID lookups using `/universe/names` and `/universe/ids`

5. **When implementing ESI features**:
   - Check `llms.esi.txt` for the exact endpoint syntax
   - Verify required OAuth scopes for authenticated endpoints
   - Follow the caching guidelines to avoid unnecessary requests
   - Use the example workflows as implementation templates

### Example: Fetching Character Information

```typescript
// Public endpoint - no auth needed
const response = await fetch('https://esi.evetech.net/characters/90000001', {
  headers: {
    'X-Compatibility-Date': '2025-09-30'
  }
})

// Private endpoint - requires OAuth token and scope
const skillsResponse = await fetch('https://esi.evetech.net/characters/90000001/skills', {
  headers: {
    'X-Compatibility-Date': '2025-09-30',
    'Authorization': `Bearer ${accessToken}` // Requires esi-skills.read_skills.v1 scope
  }
})
```

For complete endpoint documentation, request/response formats, and implementation examples, always consult `llms.esi.txt`.
</esi-api-reference>

</cloudflare-workers-monorepo>
