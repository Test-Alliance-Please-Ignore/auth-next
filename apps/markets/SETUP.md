# Markets Worker - Setup Guide

This guide explains how to set up and manage hourly market snapshots for EVE Online trade hubs.

## Quick Start

### 1. Deploy the Markets Worker

```bash
# Build and deploy
bun turbo deploy --filter=markets
```

### 2. Run the Setup Script

The easiest way to start monitoring all major trade hubs:

```bash
# Via HTTP (after deployment)
curl -X POST https://markets.your-domain.workers.dev/setup

# Or using wrangler
wrangler tail markets --format pretty
# Then in another terminal:
curl -X POST http://localhost:8787/setup
```

This will automatically start hourly snapshots for:
- **The Forge** (Jita 4-4) - Region 10000002
- **Domain** (Amarr) - Region 10000043
- **Sinq Laison** (Dodixie) - Region 10000032
- **Metropolis** (Rens) - Region 10000042
- **Heimatar** (Hek) - Region 10000030

**Note:** The first snapshot for each region runs in the background and may take 30-60 seconds to complete. The API returns immediately after scheduling the work.

## API Endpoints

### Setup All Trade Hubs

```bash
POST /setup
```

Starts hourly snapshots for all 5 major trade hub regions.

**Response:**
```json
{
  "success": true,
  "message": "Trade hub monitoring setup initiated",
  "results": [
    {
      "regionId": "10000002",
      "name": "The Forge",
      "primaryHub": "Jita 4-4",
      "description": "Largest trade hub in EVE Online",
      "status": "success",
      "nextSnapshot": "2025-11-03T16:00:00.000Z"
    }
    // ... more regions
  ]
}
```

### Check Status

```bash
GET /status
```

Check the status of all trade hub alarms.

**Note:** This shows alarm status, not snapshot completion. To check if data is available, query the database:

```sql
SELECT region_id, MAX(snapshot_time) as latest, COUNT(*) as order_count
FROM market_orders
GROUP BY region_id;
```

**Response:**
```json
[
  {
    "regionId": "10000002",
    "name": "The Forge",
    "primaryHub": "Jita 4-4",
    "isActive": true,
    "nextAlarmTime": 1730649600000
  }
  // ... more regions
]
```

### Stop All Trade Hubs

```bash
POST /stop
```

Stops all trade hub alarms.

**Response:**
```json
{
  "success": true,
  "message": "All trade hub alarms stopped"
}
```

### Control Individual Region

You can also control individual regions directly:

```bash
# Start hourly snapshots for a specific region (no body needed)
curl -X POST https://markets.your-domain.workers.dev/region/10000002/alarm/start

# Check status of a specific region
curl https://markets.your-domain.workers.dev/region/10000002/alarm/status

# Stop a specific region
curl -X POST https://markets.your-domain.workers.dev/region/10000002/alarm/stop
```

## Region IDs Reference

| Region ID | Region Name | Primary Hub | Notes |
|-----------|-------------|-------------|-------|
| 10000002 | The Forge | Jita 4-4 | Largest trade hub |
| 10000043 | Domain | Amarr | Amarr Empire hub |
| 10000032 | Sinq Laison | Dodixie | Gallente hub |
| 10000042 | Metropolis | Rens | Minmatar hub |
| 10000030 | Heimatar | Hek | Secondary Minmatar hub |

## How It Works

1. **Durable Object per Region** - Each region gets its own DO instance
2. **SQLite Storage** - Configuration stored in DO's SQLite storage
3. **Hourly Alarms** - Cloudflare alarms trigger snapshot fetching
4. **PostgreSQL Storage** - Market data stored in Neon database
5. **Materialized Views** - Latest prices pre-computed for fast batch queries

## Monitoring

### View Logs

```bash
# Tail logs in real-time
wrangler tail markets --format pretty

# Or use just command
just tail markets
```

### Check Next Snapshot Times

```bash
curl https://markets.your-domain.workers.dev/status | jq '.[] | {name, nextAlarmTime}'
```

## Data Access

Once setup is complete, you can query market data:

### Single Item Query

```typescript
import { getStub } from '@repo/do-utils'
import type { Markets } from '@repo/markets'

const stub = getStub<Markets>(env.MARKETS, 'region-10000002')

// Get all Tritanium orders in Jita
const orders = await stub.getRegionMarketData({
  regionId: '10000002',
  typeId: '34',
  orderType: 'all'
})
```

### Batch Query (up to 500 items)

```typescript
// Get latest prices for multiple items
const { prices, missingTypeIds } = await stub.getBatchMarketData({
  regionId: '10000002',
  typeIds: ['34', '35', '36', ...] // up to 500
})
```

## Troubleshooting

### Alarm Not Triggering

Check the alarm status:
```bash
curl https://markets.your-domain.workers.dev/region/10000002/alarm/status
```

If `isActive: false`, restart it:
```bash
curl -X POST https://markets.your-domain.workers.dev/region/10000002/alarm/start
```

### Missing Data

If you're not seeing data, check:
1. Alarm is active (see above)
2. Database migrations are run: `just db-migrate markets`
3. Check logs for errors: `wrangler tail markets`

### Reset Everything

To completely reset and start fresh:

```bash
# Stop all alarms
curl -X POST https://markets.your-domain.workers.dev/stop

# Wait a moment, then setup again
curl -X POST https://markets.your-domain.workers.dev/setup
```

## Performance Expectations

- **Snapshot Duration**: 30-60 seconds per region
- **Data Size**: ~500KB-2MB per snapshot (depends on region)
- **Query Performance**:
  - Single item: 1-3ms
  - 100 items batch: 15-25ms
  - 500 items batch: 20-50ms

## Cost Estimates

Hourly snapshots for 5 regions:
- **Durable Object requests**: ~120/day (5 regions × 24 hours)
- **Database storage**: ~50MB/region/day
- **ESI API calls**: ~5-10/region/snapshot

Total monthly cost (estimate): ~$5-10 for all 5 regions
