# orchestrator

A Cloudflare Workers application using Hono and Vite

## Development

### Run in dev mode

```sh
pnpm turbo dev -F orchestrator
```

### Run in preview mode

```sh
pnpm turbo preview -F orchestrator
```

### Run tests

```sh
pnpm test
```

### Deploy

```sh
pnpm turbo deploy -F orchestrator
```

## Database

### Generate migrations

```sh
just db-generate orchestrator
```

### Run migrations

```sh
just db-migrate orchestrator
```

### Open Drizzle Studio

```sh
just db-studio orchestrator
```
