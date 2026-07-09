# mailroom

Inbound-email worker for **pleaseignore.app**. Receives mail via Cloudflare Email
Routing and processes it through a small, modular routing framework. Its first feature
posts mail sent to `markeedragon@` into a Discord channel. Outbound sending, replies, and
persistence are deferred by design (all easy to add; see [Extending](#extending)).

## How inbound email reaches this worker

Cloudflare delivers inbound mail to the exported `email()` handler — there is **no
`wrangler.jsonc` binding for receiving**. Delivery is wired by an Email Routing rule:

1. `pleaseignore.app` must have **Email Routing** enabled (Dashboard → the domain's zone →
   Email → Email Routing).
2. Add a rule (or the **catch-all**) with the action **"Send to a Worker" → `mailroom`**
   (Dashboard → Email Routing → Routing Rules, or the Email Routing API).

Only then does mail flow to the deployed worker. Deploy with `just deploy` /
`pnpm -F mailroom deploy` first, then point the rule at it.

## Architecture

```
Email Routing rule ──▶ email(message, env, ctx)          src/index.ts
                          └─ createEmailHandler(emailRouter, …)   src/email/handler.ts
                               ├─ createEmailContext(message)     src/email/context.ts
                               │    └─ parsed() → postal-mime     src/email/parse.ts   (lazy)
                               ├─ emailRouter.route(ctx)          src/routes.ts + src/email/router.ts
                               │    └─ matchers                   src/email/matchers.ts
                               └─ applyDisposition / fallback     src/email/handler.ts
```

- **`src/email/`** — the reusable framework. It imports no app modules (only ambient
  Workers types + `postal-mime`), so it can be lifted into `@repo/email` when a second
  worker needs it.
- **`src/routes.ts`** — the app's routing table (`emailRouter`). Add behaviour here.
- **`src/index.ts`** — wires the Hono health app + the `email()` handler and exports both
  through Sentry.

### Routing model

`emailRouter` is an ordered list of `{ match, handle }` routes:

- Each matching route's handler runs; the **first terminal disposition wins**.
- A handler returning `next` (or nothing) falls through to later routes — use this for
  side-effect routes (logging, persistence) that shouldn't decide the message's fate.
- If no route is terminal, the `otherwise` policy decides (default: permanent reject).

Dispositions (`src/email/dispositions.ts`):

| Disposition      | Effect                                                            |
| ---------------- | ----------------------------------------------------------------- |
| `forward(to)`    | Forward to a **verified** Email Routing destination (no binding). |
| `reject(reason)` | **Permanent** SMTP bounce. Deliberate policy only.                |
| `consume`        | Accept and intentionally discard (the only sanctioned no-op).     |
| `next`           | Not terminal — continue to the next route.                        |

### Current routes (`src/routes.ts`)

1. **log-inbound** — structured-logs every message (`sideEffect`, non-terminal).
2. **markeedragon-to-discord** — mail to `markeedragon@` is posted to a Discord channel via
   the shared Discord Durable Object (`@repo/discord`, reached with `forDO`), then
   `consume`d. The Discord send is awaited inline, so a failure surfaces (Sentry +
   forward-to-fallback) instead of the notification being silently lost. See
   `src/notify-discord.ts`.
3. **forward-team** — example alias forward, active only when `FORWARD_TEAM_TO` is set.
4. **otherwise** — unknown recipients get a permanent reject.

### Safety: no silent drops

Dropping mail is the cardinal sin of an email worker, and `setReject` is **always a
permanent bounce**. So `createEmailHandler` enforces an invariant instead of trusting
platform behaviour:

- Exactly **one** terminal action (`forward`/`setReject`) runs on every code path, and the
  handler **never rethrows**.
- On an **internal** failure (bad MIME, a handler throwing, a forward failing) it
  **forwards to `FALLBACK_FORWARD_ADDRESS`** rather than permanently bouncing legitimate
  mail. If that isn't configured or also fails, the absolute last resort is a reject.
- A **matcher** that throws is fail-open (its route is skipped). A **side-effect** handler
  wrapped in `sideEffect(...)` swallows its own errors and continues.

## Configuration (`wrangler.jsonc` vars)

| Var                                     | Required    | Purpose                                                  |
| --------------------------------------- | ----------- | -------------------------------------------------------- |
| `NAME`, `ENVIRONMENT`, `SENTRY_RELEASE` | yes         | Standard worker vars.                                    |
| `FALLBACK_FORWARD_ADDRESS`              | no          | Verified mailbox that receives mail on internal failure. |
| `FORWARD_TEAM_TO`                       | no          | Example: destination for the `team@` alias route.        |
| `DISCORD_GUILD_ID`                      | for Discord | Guild the bot posts to for the `markeedragon@` route.    |
| `MARKEE_DISCORD_CHANNEL_ID`             | for Discord | Channel that receives mail sent to `markeedragon@`.      |

Set forwarding targets to **verified Email Routing destination addresses** — an unverified
address makes `forward()` fail (which then hits the fallback path).

The `markeedragon@` → Discord route also needs the `DISCORD` binding (a cross-worker binding
to `apps/discord`, already in `wrangler.jsonc`), the `discord` worker deployed in the same
account, and the Discord **bot** to be a member of the guild with permission to post in the
channel. Until `DISCORD_GUILD_ID` + `MARKEE_DISCORD_CHANNEL_ID` are set, mail to
`markeedragon@` errors to the fallback/last-resort path rather than posting.

## Extending

Add a route in `src/routes.ts`:

```ts
// Forward alerts to ops
.on(subjectMatches(/^\[ALERT]/), (ctx) => forward('ops@pleaseignore.app'), 'forward-alerts')

// Act on the decoded body (parses lazily, only when reached)
.on(recipientLocalPartIs('commands'), async (ctx) => {
	const { text, attachments } = await ctx.parsed()
	ctx.executionCtx.waitUntil(process(text, attachments))
	return consume
}, 'commands')
```

Deferred by design (each is a small, isolated addition):

- **Replies** — binding-free via `message.reply(new EmailMessage(...))` + `mimetext`. Add a
  `reply` disposition and the `mimetext` dep.
- **Outbound send** (`env.EMAIL.send()`) — needs a `send_email` binding **and** the domain
  onboarded to Email Sending (a DNS/operator step).
- **Persistence** — add a `sideEffect` route that writes to a Durable Object (SQLite),
  Neon, R2, or a Queue.

## Development & testing

```bash
pnpm -F mailroom dev      # local dev; POST /cdn-cgi/handler/email triggers email()
pnpm -F mailroom test     # unit + integration tests (Workers pool)
pnpm -F mailroom check:types
```

Tests fabricate a `ForwardableEmailMessage` (see `src/test/make-message.ts`) and call the
framework directly — no live email needed. In local dev, Wrangler exposes
`POST /cdn-cgi/handler/email?from=…&to=…` with the raw MIME as the body to invoke `email()`.
