<cloudflare-workers-monorepo>

<title>Cloudflare Workers Monorepo Guidelines for Claude Code</title>

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
</architecture>

<durable-objects>
## State Management with Durable Objects

This project uses Cloudflare Durable Objects for stateful operations with SQLite storage. Durable Objects provide strong consistency guarantees and can be accessed across workers.

### Architecture Pattern

1. **Shared Interface Packages**: Each Durable Object type has a dedicated package exporting only TypeScript interfaces:
   - `@repo/session-store` - User sessions, OAuth, account/character linking
   - `@repo/character-data-store` - EVE character/corporation data tracking
   - `@repo/user-token-store` - EVE SSO token management

2. **Implementation**: Durable Object classes are defined in their respective worker apps (e.g., `apps/social-auth/src/session-store.ts`)

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
        "script_name": "social-auth"
      }
    ]
  }
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

</cloudflare-workers-monorepo>
