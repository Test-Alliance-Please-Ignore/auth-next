# Set up Miniflare development without Cloudflare login

The goal is to run `just dev-local`, have the UI and backend run on your
machine, and use local Cloudflare binding simulations without authenticating
to Cloudflare.

**Miniflare is already provided by the repository's Cloudflare Vite plugin.**
The setup needed here is to disable remote bindings and supply application
configuration locally. You do not need a separate Miniflare installation or a
Cloudflare account for local binding simulations.
[Cloudflare's local development documentation](https://developers.cloudflare.com/workers/local-development/)
explains how Vite and Wrangler use Miniflare.

## 1. Install the repository dependencies

Install Node.js 22.12 or later, Bun 1.2 or later, `just`, and the pnpm version
specified in [package.json](package.json) (currently `pnpm@11.18.0`).

From the repository root:

```bash
just install
```

This installs the project's Vite plugin, Wrangler, and their local runtime
dependencies. Do not run `wrangler login`, create Cloudflare resources, or
deploy anything as part of this setup.

## 2. Disable remote Cloudflare bindings

Open the **repository-root `.env`**. If it does not exist, create it. Add or
update these assignments, keeping any existing application secrets:

```dotenv
CLOUDFLARE_VITE_FORCE_LOCAL=true
ENVIRONMENT=development
VITE_API_BASE_URL=/api
SENTRY_DSN=''
SENTRY_RELEASE=local-dev
```

Use the exact value `true` for `CLOUDFLARE_VITE_FORCE_LOCAL`.

This is the setting that gets this repository to local Miniflare operation.
The installed Cloudflare Vite plugin, version 1.47.0, treats it as
`remoteBindings: false`. That prevents creation of the remote binding proxy
session which would require Cloudflare authentication. The plugin's
[`remoteBindings` option](https://developers.cloudflare.com/workers/vite-plugin/reference/api/)
controls whether remote bindings are enabled.

There is a concrete reason to set it in this repository:
[apps/fulcrum/wrangler.jsonc](apps/fulcrum/wrangler.jsonc) marks its
`CHARACTER_REPORTS` R2 bucket as `remote: true`. Core discovers Fulcrum as an
auxiliary Worker. Without a local override, starting core can therefore involve
a remote resource even though your application code runs on your laptop.

Keep the binding definitions: Miniflare needs them to create local resources.
The override makes the bucket local without changing its deployed configuration.

### Why the root file is sufficient

The committed [run-vite-dev](packages/tools/bin/run-vite-dev) script already
loads and exports the root `.env` before executing Vite. Both `core` and `ui`
use that script. The value reaches the plugin after Turbo has started the app
processes.

**This setup does not require the uncommitted changes to `Justfile`,
`turbo.jsonc`, or the development-tool scripts.** Those changes make
`dev-local` force the setting automatically; explicitly configuring it in
the root `.env` also works with the committed scripts.

For this path, put the value in the root `.env` rather than relying only on a
shell prefix such as `CLOUDFLARE_VITE_FORCE_LOCAL=true just dev-local`. The
committed Turbo configuration does not pass that shell variable through.

## 3. Supply the application's own configuration locally

Cloudflare login will not supply deployed secrets to the local Workers. Keep
the application's development credentials in your root `.env`.

For database-backed functionality and EVE sign-in, configure:

| Variable                  | Development value                                                                 |
| ------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Your development Neon database connection string.                                 |
| `DATABASE_URL_MIGRATIONS` | Migration connection to the same development database, if applying migrations.    |
| `SESSION_SECRET`          | A long random secret.                                                             |
| `IP_ADDRESS_HASH_SECRET`  | A separate random secret.                                                         |
| `ENCRYPTION_KEY`          | A stable 64-character hex key for token encryption.                               |
| `EVE_SSO_CLIENT_ID`       | Your development EVE application's client ID.                                     |
| `EVE_SSO_CLIENT_SECRET`   | Its client secret.                                                                |
| `EVE_SSO_CALLBACK_URL`    | `http://127.0.0.1:5173/auth/callback`, also registered with that EVE application. |

Generate a new secret with `openssl rand -hex 32`; run it separately for each
secret you need. Preserve an existing encryption key when reusing encrypted
tokens. Quote values containing shell characters because the root `.env` is
sourced by the development wrapper.

You can omit `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the local
environment. Do not replace them with dummy credentials. Do not commit secrets.

The wrapper sets `CLOUDFLARE_INCLUDE_PROCESS_ENV=true` so local Workers can
receive the root environment. If an app has its own `.dev.vars`, that file
takes priority for its Worker variables: maintain the required values there or
preserve and move it aside to use the root setup. Check auxiliary Workers too.
See [Cloudflare's environment variable documentation](https://developers.cloudflare.com/workers/configuration/environment-variables/).

These application dependencies remain external: Miniflare does not emulate Neon
or EVE SSO. A development Neon database must already contain the relevant
schemas, or you can apply the existing migrations to it:

```bash
just db-migrate core
```

Run the corresponding app's migrations for any additional features you use.
These commands write to `DATABASE_URL_MIGRATIONS`; use your development
database. Do not use `db-push` or generate new migrations for this setup.
Database setup is separate from enabling Miniflare.

## 4. Start the local Workers and UI

Stop any previous development session, then run from the repository root:

```bash
just dev-local
```

Keep auxiliary Worker discovery enabled. If you previously exported
`LOCAL_DEV_DISABLE_AUXILIARY_WORKERS=1`, unset it and remove that assignment
from local environment files before starting. Core needs its sibling Workers
for normal application functionality; disabling them is not what makes
development local.

The command starts:

- The UI at [http://127.0.0.1:5173](http://127.0.0.1:5173).
- Core at [http://127.0.0.1:8787](http://127.0.0.1:8787).
- Core's auxiliary Workers within its local Vite/Miniflare runtime.

Open the UI address in your browser. Its `/api` requests go through the local
proxy to core. Use Ctrl+C to stop the processes.

## 5. Check that you have reached the goal

Wait for both servers to report readiness. In another terminal:

```bash
curl --fail http://127.0.0.1:8787/
```

Core's health route should return:

```json
{ "status": "ok", "service": "core" }
```

Then open [the UI](http://127.0.0.1:5173). You should be able to reach its login
screen without a Cloudflare login prompt or creating a remote preview session.
EVE login in the application is a separate authentication flow and remains
necessary for protected pages.

Local R2, KV, and Durable Object state is separate from deployed Cloudflare
data. The installed Vite plugin stores its local state under the hosting app's
`.wrangler/state` directory. For core's auxiliaries, that is core's local
runtime. An initially empty local bucket is expected; see
[Cloudflare's local data documentation](https://developers.cloudflare.com/workers/local-development/local-data/).

At this point, Workers execute locally and supported bindings use Miniflare
simulations. Database and integration calls still use the configured external
services; a Discord send can still send a real message.

## If Cloudflare login is still requested

1. Confirm `CLOUDFLARE_VITE_FORCE_LOCAL=true` is in the **root `.env`**, with no
   later assignment setting it to `false`. Restart both servers.
2. Use `just dev-local` from the repository root. Do not add `--remote` or use
   a deployment command.
3. Check whether you started Vite directly and bypassed `run-vite-dev`. Direct
   Vite execution does not source the repository's root `.env` through that
   wrapper.
4. For an app started with Wrangler directly, use `wrangler dev --local`.
   `CLOUDFLARE_VITE_FORCE_LOCAL` is a Vite plugin setting, not a general
   Wrangler switch. Cloudflare documents the
   [Wrangler local override](https://developers.cloudflare.com/workers/local-development/#bindings-during-local-development).
5. If you maintain a custom Vite startup path, set `remoteBindings: false` in
   its existing `cloudflare({ ... })` plugin options, preserving the other
   options. Apply it to each Vite process you start, including both core and UI.
   This is the explicit configuration equivalent of the environment flag.

A missing database secret, EVE login failure, or unavailable sibling Worker is
a separate application setup problem. None requires logging in to Cloudflare
to make Miniflare run.
