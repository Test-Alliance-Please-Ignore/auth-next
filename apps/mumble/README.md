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
| `MURMUR_CONTROL_API_URL` | secret | Base URL of the murmur-control API |
| `MURMUR_CONTROL_MTLS` | mTLS binding | Optional outbound client certificate for murmur-control |
| `MURMUR_CONTROL_TOKEN` | secret | Optional bearer token for murmur-control |

```bash
pnpm -F mumble wrangler mtls-certificate upload --cert cert.pem --key key.pem --name murmur-control-client
pnpm -F mumble wrangler secret put MURMUR_CONTROL_API_URL
pnpm -F mumble wrangler secret put MURMUR_CONTROL_TOKEN
```

When `MURMUR_CONTROL_MTLS` is configured, outbound murmur-control requests use
that binding’s `fetch()` method. When it is absent, the client falls back to
plain `fetch()`.

The bearer token is optional in either mode and is only attached when
`MURMUR_CONTROL_TOKEN` is present in the environment.

In production-like environments, the client requires:
- an `https://` murmur-control base URL
- at least one auth mechanism: mTLS binding or bearer token

`MURMUR_CONTROL_API_URL` is provided as a Cloudflare secret rather than
hardcoded in `wrangler.jsonc`.
`SENTRY_RELEASE` is declared in the static Wrangler config to match the
currently deployed release; the deploy tooling still injects the build release
at deploy time.

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
