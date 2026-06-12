# mumble

Cloudflare Worker that manages Mumble (Murmur) voice accounts via the external
[murmur-control](https://github.com/pleaseignore/murmur-control) control plane.

auth-next is the upstream desired-state authority: it owns accounts, enabled
state, deletions, and group memberships. This worker projects that state into
murmur-control over its REST API.

## Architecture

- **No public HTTP surface** — all access is via the `Mumble` Durable Object
  RPC interface defined in `@repo/mumble`. Public routes live in `core`
  (`/api/mumble/...`).
- **One DO instance per Murmur server** (instance name = `serverId`). All
  murmur-control writes funnel through it, serializing them and applying a
  token-bucket throttle to interactive operations (provision/password reset).
- **Stateless** — murmur-control is the authoritative store of account state;
  this worker keeps no local tables.
- `subjectId` = core user UUID (`users.id`). `loginName` is derived from the
  main character name by core; collisions are resolved here.
- Passwords are generated inside the DO, converted to PBKDF2-SHA256 verifier
  material (`src/hazmat.ts`), and returned exactly once — never stored.

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `MURMUR_CONTROL_API_URL` | var | Base URL of the murmur-control API |
| `MURMUR_CONTROL_TOKEN` | secret | Static bearer token for murmur-control |

```bash
pnpm -F mumble wrangler secret put MURMUR_CONTROL_TOKEN
```

The serverId and user-facing connection info (`MUMBLE_SERVER_ID`,
`MUMBLE_HOST`, `MUMBLE_PORT`) are configured on the core worker.

## Development

```bash
# Start development server
just dev -F mumble

# Run tests
pnpm test

# Deploy
just deploy -F mumble
```

## Using the Durable Object from other workers

1. Add the binding to `wrangler.jsonc`:

   ```jsonc
   {
     "durable_objects": {
       "bindings": [
         {
           "name": "MUMBLE",
           "class_name": "Mumble",
           "script_name": "mumble",
         },
       ],
     },
   }
   ```

2. Add the dependency:

   ```bash
   pnpm -F your-worker add '@repo/mumble@workspace:*'
   ```

3. Use it:

   ```typescript
   import { getStub } from '@repo/do-utils'

   import type { Mumble } from '@repo/mumble'

   const stub = getStub<Mumble>(env.MUMBLE, serverId)
   const account = await stub.getAccount(serverId, userId)
   ```
