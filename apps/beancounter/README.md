# beancounter

Cloudflare Worker that coordinates structure monitoring workflows and per-structure Durable Objects.

## Features

- **Structure coordinator**: Hono worker that orchestrates scans across corporations and spawns Durable Object monitors
- **Per-structure Durable Object**: SQLite-backed Structure Monitor DO powered by Drizzle ORM for Durable Objects
- **Postgres (Neon)**: Tracks corporations, structures, monitor health, and watchdog metadata via Drizzle pg-core schema
- **Testing**: Vitest with Cloudflare Workers pool

## Development

```bash
# Start development server
just dev -F beancounter

# Run tests
pnpm test

# Deploy
just deploy -F beancounter
```

## CLI

Manage corporations and structures from the command line:

```bash
# List all corporations
pnpm -F beancounter cli corp list

# Add a new corporation
pnpm -F beancounter cli corp add --id 123456789 --name "My Corp" --ticker "MC"

# Update a corporation
pnpm -F beancounter cli corp update --id <uuid> --name "New Name"

# Toggle tracking for a corporation
pnpm -F beancounter cli corp toggle --id <uuid>

# List all structures
pnpm -F beancounter cli struct list

# List structures for a specific corporation
pnpm -F beancounter cli struct list --corp 123456789

# Add a new structure
pnpm -F beancounter cli struct add --corp-id 123456789 --id 9876543210 --name "My Structure"

# Toggle monitoring for a structure
pnpm -F beancounter cli struct toggle --id <uuid>

# Get help
pnpm -F beancounter cli --help
```

## Database

```bash
# Generate Postgres migrations (Drizzle Kit)
pnpm -F beancounter db:generate

# Run migrations
pnpm -F beancounter db:migrate

# Open Drizzle Studio
pnpm -F beancounter db:studio
```

- Neon/Postgres schema is defined in `src/db/schema.ts`.
- SQLite Durable Object schema lives in `src/structure-monitor/schema.ts` and follows the
  [Drizzle Durable Object guide](https://orm.drizzle.team/docs/get-started/do-new).
- Always use Drizzle Kit to generate migrations—never craft SQL files by hand.

## Structure Monitor Durable Object

- Available inside this worker as the `STRUCTURE_MONITOR` binding.
- RPC interface lives in `@repo/beancounter` (`StructureMonitor`, `StructureFuelSnapshotInput`, etc.).

### From within this worker

```ts
import type { StructureMonitor } from '@repo/beancounter'
import { getStub } from '@repo/do-utils'

const structureId = '1020999999990'
const monitor = getStub<StructureMonitor>(c.env.STRUCTURE_MONITOR, structureId)

await monitor.recordFuelSnapshot(structureId, {
	fuelExpiresAt: new Date().toISOString(),
})
```

### From other workers

1. Add the binding to `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "STRUCTURE_MONITOR",
           "class_name": "StructureMonitor",
           "script_name": "beancounter"
         }
       ]
     }
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/beancounter@workspace:*'
   ```

3. Extend your context bindings with `STRUCTURE_MONITOR` and call the RPC methods as needed.
