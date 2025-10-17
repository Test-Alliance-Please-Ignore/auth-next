# Tags Worker

Automated tagging system for EVE Online users based on corporation and alliance membership.

## Features

- Automatic tag assignment based on ALL user characters
- Corporation tags (green): `urn:eve:corporation:<id>`
- Alliance tags (blue): `urn:eve:alliance:<id>`
- Hourly evaluation via Durable Object alarms
- Extensible rule system for future tag types

## Tag Structure

Each tag has:

- **URN**: Internal identifier (e.g., `urn:eve:corporation:98000001`)
- **Display Name**: Human-readable name (e.g., "Dreddit")
- **Type**: Used for UI color coding (`corporation` or `alliance`)
- **Metadata**: Additional info from ESI (ticker, member count, etc.)

## API Endpoints

### Public (requires auth)

- `GET /api/tags/:userId` - Get all tags for a user
- `GET /api/tags/:userId/display` - Get tags with display names and colors
- `GET /api/tags/:userId/detailed` - Get tags with source character info

### System (service-to-service)

- `POST /api/tags/onboard` - Character link notification
- `POST /api/tags/character-unlinked/:characterId` - Character unlink notification
- `POST /api/tags/evaluate/:userId` - Force evaluation

### Admin (requires admin auth)

- `GET /api/tags` - List all tags
- `GET /api/tags/:urn` - Get tag details
- `GET /api/tags/:urn/users` - List users with tag
- `POST /api/tags/sync-all` - Trigger full sync
