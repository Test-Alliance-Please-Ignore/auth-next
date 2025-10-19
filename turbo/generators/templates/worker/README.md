# {{ name }}

A Cloudflare Workers application using Hono and Vite

## Development

### Run in dev mode

```sh
pnpm turbo dev -F {{ name }}
```

### Run in preview mode

```sh
pnpm turbo preview -F {{ name }}
```

### Run tests

```sh
pnpm test
```

### Deploy

```sh
pnpm turbo deploy -F {{ name }}
```

## Database

### Generate migrations

```sh
just db-generate {{ name }}
```

### Run migrations

```sh
just db-migrate {{ name }}
```

### Open Drizzle Studio

```sh
just db-studio {{ name }}
```
