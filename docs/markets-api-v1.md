# Markets API v1 Documentation

## Table of Contents

- [Overview](#overview)
- [Base URL](#base-url)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Caching](#caching)
- [Response Format](#response-format)
- [Error Handling](#error-handling)
- [Endpoints](#endpoints)
  - [Get Batch Prices](#get-batch-prices)
  - [Get Location Snapshots](#get-location-snapshots)
  - [Get Refresh Status](#get-refresh-status)
- [Data Models](#data-models)
- [Examples](#examples)

---

## Overview

The Markets API v1 provides access to EVE Online market data captured as time-series snapshots. This API is designed for:

- **Batch price lookups** - Query up to 500 items efficiently (20-50ms response times)
- **Historical market data** - Access snapshots with time-range queries
- **Real-time refresh status** - Monitor when market data will be updated
- **Region and structure support** - Query both public region markets and player structures

---

## Base URL

```
https://api.pleaseignore.app/v1/markets
```

All v1 API endpoints are prefixed with `/v1` and routed through the `markets` Cloudflare Worker.

**Production Route:**

```
api.pleaseignore.app/v1/markets/*
```

---

## Authentication

### API Key (Required)

All v1 API endpoints require authentication using an API key passed in the `Authorization` header.

**Header Format:**

```http
Authorization: Bearer YOUR_API_KEY
```

**Authentication Flow:**

1. Extract bearer token from `Authorization` header
2. Validate against database (with 5-minute in-memory cache)
3. Check if key is active
4. Track usage statistics (request count, last used timestamp)

**Error Responses:**

Missing or invalid format:

```json
{
  "error": "Authorization header is required",
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

Status: `401 Unauthorized`

Invalid API key:

```json
{
  "error": "Invalid API key",
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

Status: `403 Forbidden`

Inactive API key:

```json
{
  "error": "API key is inactive",
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

Status: `403 Forbidden`

---

## Caching

The API uses Cloudflare Cache API with path-specific TTL values:

| Endpoint Pattern | Cache TTL  | Notes                                 |
| ---------------- | ---------- | ------------------------------------- |
| `/prices`        | 5 minutes  | Price data updates frequently         |
| `/orders`        | 1 hour     | Historical order data                 |
| `/snapshots`     | 15 minutes | Snapshot metadata                     |
| `/refresh`       | 1 minute   | Refresh status changes frequently     |
| `/types/*`       | 30 minutes | Type information is relatively static |

**Cache Headers:**

Response includes cache status:

```http
X-Cache: HIT
Cache-Control: public, max-age=300
```

- `X-Cache: HIT` - Response served from cache
- `X-Cache: MISS` - Response generated fresh, now cached

**Cache Key Generation:**

- Version + endpoint path + sorted query parameters
- POST requests include body parameters (e.g., typeIds array)
- Arrays are hashed to keep cache keys short

---

## Response Format

All API responses follow a consistent JSON structure.

### Success Response

```json
{
  "data": {
    /* response data */
  },
  "meta": {
    "requestId": "unique-request-id",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

### Paginated Response

```json
{
  "data": [
    /* array of items */
  ],
  "pagination": {
    "total": 1500,
    "limit": 100,
    "nextCursor": "eyJpZCI6InV1aWQtaGVyZSJ9"
  },
  "meta": {
    "requestId": "unique-request-id",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

### Error Response

```json
{
  "error": "Error message",
  "errors": [
    /* optional: detailed validation errors */
  ],
  "meta": {
    "requestId": "unique-request-id",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

---

## Error Handling

### Standard HTTP Status Codes

| Status Code                 | Meaning             | Common Causes                                      |
| --------------------------- | ------------------- | -------------------------------------------------- |
| `200 OK`                    | Success             | Request processed successfully                     |
| `400 Bad Request`           | Invalid input       | Missing parameters, invalid IDs, validation errors |
| `401 Unauthorized`          | Auth required       | Missing Authorization header                       |
| `403 Forbidden`             | Access denied       | Invalid or inactive API key                        |
| `404 Not Found`             | Resource not found  | Location has no snapshots, no data available       |
| `500 Internal Server Error` | Server error        | Database error, service unavailable                |
| `503 Service Unavailable`   | Service unavailable | Database not configured, binding missing           |

### Validation Errors

Validation errors include detailed field-level information:

```json
{
  "error": "Request validation failed",
  "errors": ["typeIds: Array must contain at least 1 element(s)", "snapshotId: Invalid uuid"],
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

---

## Endpoints

### Get Batch Prices

Get price information for a batch of item types at a specific location.

**Endpoint:**

```
POST /v1/markets/locations/:locationId/prices
```

**Path Parameters:**

| Parameter    | Type   | Required | Description                                           |
| ------------ | ------ | -------- | ----------------------------------------------------- |
| `locationId` | string | Yes      | EVE Online region ID or structure ID (numeric string) |

**Request Body:**

```json
{
  "typeIds": ["34", "35", "36"],
  "snapshotId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| Field        | Type     | Required | Constraints                  | Description                                              |
| ------------ | -------- | -------- | ---------------------------- | -------------------------------------------------------- |
| `typeIds`    | string[] | Yes      | 1-500 items, numeric strings | Array of EVE item type IDs                               |
| `snapshotId` | string   | No       | Valid UUID                   | Specific snapshot to query (defaults to latest complete) |

**Response:**

```json
{
  "data": [
    {
      "typeId": "34",
      "snapshotId": "550e8400-e29b-41d4-a716-446655440000",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "bestBuyPrice": "9500.00",
      "bestBuyOrderId": "123456789",
      "bestBuyLocation": "60003760",
      "bestBuyVolume": "1000000",
      "totalBuyVolume": "5000000",
      "buyOrderCount": 42,
      "bestSellPrice": "9550.00",
      "bestSellOrderId": "987654321",
      "bestSellLocation": "60003760",
      "bestSellVolume": "500000",
      "totalSellVolume": "3000000",
      "sellOrderCount": 38,
      "spreadAmount": "50.00",
      "spreadPercent": "0.53"
    }
  ],
  "missingTypeIds": ["36"],
  "meta": {
    "locationId": "10000002",
    "locationType": "region",
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:00:00.000Z",
    "version": "1"
  }
}
```

**Response Fields:**

| Field              | Type         | Description                                     |
| ------------------ | ------------ | ----------------------------------------------- |
| `typeId`           | string       | Item type ID                                    |
| `snapshotId`       | string       | UUID of the snapshot                            |
| `snapshotTime`     | string       | ISO 8601 timestamp of snapshot                  |
| `bestBuyPrice`     | string\|null | Highest buy order price (ISK)                   |
| `bestBuyOrderId`   | string\|null | ID of the best buy order                        |
| `bestBuyLocation`  | string\|null | Station/structure ID of best buy order          |
| `bestBuyVolume`    | string\|null | Volume available at best buy price              |
| `totalBuyVolume`   | string       | Total volume of all buy orders                  |
| `buyOrderCount`    | number       | Number of buy orders                            |
| `bestSellPrice`    | string\|null | Lowest sell order price (ISK)                   |
| `bestSellOrderId`  | string\|null | ID of the best sell order                       |
| `bestSellLocation` | string\|null | Station/structure ID of best sell order         |
| `bestSellVolume`   | string\|null | Volume available at best sell price             |
| `totalSellVolume`  | string       | Total volume of all sell orders                 |
| `sellOrderCount`   | number       | Number of sell orders                           |
| `spreadAmount`     | string\|null | Difference between best sell and best buy (ISK) |
| `spreadPercent`    | string\|null | Spread as percentage of best buy price          |
| `missingTypeIds`   | string[]     | Type IDs with no market data in this location   |

**Notes:**

- Prices are stored as strings to avoid JavaScript BigInt serialization issues
- `null` values indicate no orders of that type exist
- Optimized for batch lookups (up to 500 items in ~20-50ms)
- Uses materialized view (`latest_market_prices`) for performance

**Error Responses:**

Invalid locationId:

```json
{
  "error": "locationId must be a numeric ID",
  "meta": {
    /* ... */
  }
}
```

Status: `400`

No snapshots available:

```json
{
  "error": "No complete snapshots found for this location",
  "meta": {
    /* ... */
  }
}
```

Status: `404`

**Example:**

```bash
curl -X POST "https://api.pleaseignore.app/v1/markets/locations/10000002/prices" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "typeIds": ["34", "35", "36", "37", "38"]
  }'
```

---

### Get Location Snapshots

Get all snapshots for a specific location with filtering and pagination.

**Endpoint:**

```
GET /v1/markets/locations/:locationId/snapshots
```

**Path Parameters:**

| Parameter    | Type   | Required | Description                                           |
| ------------ | ------ | -------- | ----------------------------------------------------- |
| `locationId` | string | Yes      | EVE Online region ID or structure ID (numeric string) |

**Query Parameters:**

| Parameter      | Type   | Required | Default | Constraints                        | Description                |
| -------------- | ------ | -------- | ------- | ---------------------------------- | -------------------------- |
| `locationType` | string | No       | -       | `region` or `structure`            | Filter by location type    |
| `status`       | string | No       | -       | `pending`, `complete`, or `failed` | Filter by snapshot status  |
| `limit`        | number | No       | 100     | 1-500                              | Number of results per page |
| `cursor`       | string | No       | -       | Base64 encoded                     | Pagination cursor          |

**Response:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "locationId": "10000002",
      "locationType": "region",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "status": "complete",
      "orderCount": 15432,
      "fetchDurationMs": 1234,
      "errorMessage": null,
      "createdAt": "2025-11-04T12:00:05.000Z",
      "updatedAt": "2025-11-04T12:01:20.000Z"
    }
  ],
  "pagination": {
    "total": 1500,
    "limit": 100,
    "nextCursor": "eyJpZCI6IjU1MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9"
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

**Response Fields:**

| Field             | Type         | Description                                     |
| ----------------- | ------------ | ----------------------------------------------- |
| `id`              | string       | UUID of the snapshot                            |
| `locationId`      | string       | Region or structure ID                          |
| `locationType`    | string       | `region` or `structure`                         |
| `snapshotTime`    | string       | ISO 8601 timestamp when snapshot was taken      |
| `status`          | string       | `pending`, `complete`, or `failed`              |
| `orderCount`      | number       | Total orders captured in snapshot               |
| `fetchDurationMs` | number\|null | Time taken to fetch data (milliseconds)         |
| `errorMessage`    | string\|null | Error details if status is `failed`             |
| `createdAt`       | string       | ISO 8601 timestamp when record was created      |
| `updatedAt`       | string       | ISO 8601 timestamp when record was last updated |

**Pagination:**

Use the `nextCursor` value from the response in the next request:

```bash
GET /v1/markets/locations/10000002/snapshots?cursor=eyJpZCI6IjU1MGU4NDAwIn0
```

The cursor is base64 encoded JSON containing the pagination state.

**Error Responses:**

Invalid locationId:

```json
{
  "error": "locationId must be a numeric ID",
  "meta": {
    /* ... */
  }
}
```

Status: `400`

Invalid cursor:

```json
{
  "error": "Invalid pagination cursor",
  "meta": {
    /* ... */
  }
}
```

Status: `400`

No snapshots found:

```json
{
  "error": "No snapshots found for this location",
  "meta": {
    /* ... */
  }
}
```

Status: `404`

**Example:**

```bash
# Get all snapshots for Jita (The Forge region)
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/snapshots?limit=50" \
  -H "Authorization: Bearer YOUR_API_KEY"

# Filter by status
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/snapshots?status=complete&limit=100" \
  -H "Authorization: Bearer YOUR_API_KEY"

# Paginate through results
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/snapshots?cursor=eyJpZCI6IjU1MGU4NDAwIn0" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

### Get Refresh Status

Get next refresh time and last snapshot information for a location.

**Endpoint:**

```
GET /v1/markets/locations/:locationId/refresh
```

**Path Parameters:**

| Parameter    | Type   | Required | Description                                           |
| ------------ | ------ | -------- | ----------------------------------------------------- |
| `locationId` | string | Yes      | EVE Online region ID or structure ID (numeric string) |

**Response:**

```json
{
  "data": {
    "locationId": "10000002",
    "locationType": "region",
    "isActive": true,
    "nextRefreshTime": "2025-11-04T13:00:00.000Z",
    "nextRefreshTimestamp": 1730725200000,
    "lastSnapshotTime": "2025-11-04T12:00:00.000Z",
    "lastSnapshotStatus": "complete",
    "lastSnapshotOrderCount": 15432
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

**Response Fields:**

| Field                    | Type         | Description                                                 |
| ------------------------ | ------------ | ----------------------------------------------------------- |
| `locationId`             | string       | Region or structure ID                                      |
| `locationType`           | string       | `region` or `structure`                                     |
| `isActive`               | boolean      | Whether hourly snapshots are currently active               |
| `nextRefreshTime`        | string\|null | ISO 8601 timestamp of next scheduled snapshot               |
| `nextRefreshTimestamp`   | number\|null | Unix timestamp (milliseconds) of next snapshot              |
| `lastSnapshotTime`       | string       | ISO 8601 timestamp of most recent snapshot                  |
| `lastSnapshotStatus`     | string       | Status of last snapshot: `pending`, `complete`, or `failed` |
| `lastSnapshotOrderCount` | number       | Number of orders in last snapshot                           |

**Notes:**

- `nextRefreshTime` is `null` if monitoring is not active
- Refresh times are based on Durable Object alarm scheduling (typically hourly)
- This endpoint is useful for monitoring market data freshness

**Error Responses:**

Invalid locationId:

```json
{
  "error": "locationId must be a numeric ID",
  "meta": {
    /* ... */
  }
}
```

Status: `400`

Location not found:

```json
{
  "error": "Location not found (no snapshots exist)",
  "meta": {
    /* ... */
  }
}
```

Status: `404`

**Example:**

```bash
# Check refresh status for Jita (The Forge region)
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/refresh" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

---

## Data Models

### Location Types

| Type        | Description                                      | ID Format                              |
| ----------- | ------------------------------------------------ | -------------------------------------- |
| `region`    | Public region market (e.g., The Forge, Domain)   | Numeric string (e.g., "10000002")      |
| `structure` | Player-owned structure (requires authentication) | Numeric string (e.g., "1000000000001") |

**Major Trade Hubs:**

| Location Name | Region ID | Primary Hub Station                                   |
| ------------- | --------- | ----------------------------------------------------- |
| Jita          | 10000002  | Jita IV - Moon 4 - Caldari Navy Assembly Plant        |
| Amarr         | 10000043  | Amarr VIII (Oris) - Emperor Family Academy            |
| Dodixie       | 10000032  | Dodixie IX - Moon 20 - Federation Navy Assembly Plant |
| Rens          | 10000030  | Rens VI - Moon 8 - Brutor Tribe Treasury              |
| Hek           | 10000042  | Hek VIII - Moon 12 - Boundless Creation Factory       |

### Snapshot Status

| Status     | Description                                  |
| ---------- | -------------------------------------------- |
| `pending`  | Snapshot initiated but not yet complete      |
| `complete` | Snapshot successfully captured and processed |
| `failed`   | Snapshot failed (check `errorMessage` field) |

### Price Data Format

All price and volume fields are stored as **strings** to avoid JavaScript BigInt serialization issues with large ISK values.

**Example:**

```json
{
  "bestBuyPrice": "9500.00",
  "totalBuyVolume": "5000000"
}
```

To perform calculations, convert to `Number` or use a decimal library:

```typescript
const price = Number(data.bestBuyPrice)
const volume = Number(data.totalBuyVolume)
const totalValue = price * volume
```

### Request ID

Every response includes a unique `requestId` in the `meta` object. This ID is useful for:

- Debugging and tracing requests
- Correlating logs across distributed systems
- Support inquiries

---

## Examples

### Example 1: Get Current Prices for Multiple Items

Query prices for Tritanium, Pyerite, and Mexallon in Jita:

```bash
curl -X POST "https://api.pleaseignore.app/v1/markets/locations/10000002/prices" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "typeIds": ["34", "35", "36"]
  }'
```

**Response:**

```json
{
  "data": [
    {
      "typeId": "34",
      "snapshotId": "abc-123",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "bestBuyPrice": "6.50",
      "bestSellPrice": "6.55",
      "totalBuyVolume": "5000000000",
      "totalSellVolume": "3000000000",
      "buyOrderCount": 150,
      "sellOrderCount": 120,
      "spreadAmount": "0.05",
      "spreadPercent": "0.77"
    },
    {
      "typeId": "35",
      "snapshotId": "abc-123",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "bestBuyPrice": "15.00",
      "bestSellPrice": "15.10",
      "totalBuyVolume": "2000000000",
      "totalSellVolume": "1500000000",
      "buyOrderCount": 85,
      "sellOrderCount": 70,
      "spreadAmount": "0.10",
      "spreadPercent": "0.67"
    },
    {
      "typeId": "36",
      "snapshotId": "abc-123",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "bestBuyPrice": "75.00",
      "bestSellPrice": "76.00",
      "totalBuyVolume": "500000000",
      "totalSellVolume": "400000000",
      "buyOrderCount": 60,
      "sellOrderCount": 55,
      "spreadAmount": "1.00",
      "spreadPercent": "1.33"
    }
  ],
  "missingTypeIds": [],
  "meta": {
    "locationId": "10000002",
    "locationType": "region",
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

---

### Example 2: Get Recent Snapshots for a Location

Query the last 10 snapshots for The Forge region:

```bash
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/snapshots?limit=10&status=complete" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "locationId": "10000002",
      "locationType": "region",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "status": "complete",
      "orderCount": 15432,
      "fetchDurationMs": 1234,
      "errorMessage": null,
      "createdAt": "2025-11-04T12:00:05.000Z",
      "updatedAt": "2025-11-04T12:01:20.000Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440000",
      "locationId": "10000002",
      "locationType": "region",
      "snapshotTime": "2025-11-04T11:00:00.000Z",
      "status": "complete",
      "orderCount": 15398,
      "fetchDurationMs": 1189,
      "errorMessage": null,
      "createdAt": "2025-11-04T11:00:05.000Z",
      "updatedAt": "2025-11-04T11:01:15.000Z"
    }
  ],
  "pagination": {
    "total": 1500,
    "limit": 10,
    "nextCursor": "eyJpZCI6IjY2MGU4NDAwLWUyOWItNDFkNC1hNzE2LTQ0NjY1NTQ0MDAwMCJ9"
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

---

### Example 3: Check Next Refresh Time

Check when Jita market data will be refreshed next:

```bash
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/refresh" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

**Response:**

```json
{
  "data": {
    "locationId": "10000002",
    "locationType": "region",
    "isActive": true,
    "nextRefreshTime": "2025-11-04T13:00:00.000Z",
    "nextRefreshTimestamp": 1730725200000,
    "lastSnapshotTime": "2025-11-04T12:00:00.000Z",
    "lastSnapshotStatus": "complete",
    "lastSnapshotOrderCount": 15432
  },
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

---

### Example 4: Query Prices from a Specific Snapshot

Query prices from a specific historical snapshot:

```bash
curl -X POST "https://api.pleaseignore.app/v1/markets/locations/10000002/prices" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "typeIds": ["34", "35"],
    "snapshotId": "550e8400-e29b-41d4-a716-446655440000"
  }'
```

This allows you to:

- Compare prices across different time periods
- Analyze historical trends
- Reconstruct market state at a specific point in time

---

### Example 5: Handle Missing Type IDs

Query prices for items with no market activity:

```bash
curl -X POST "https://api.pleaseignore.app/v1/markets/locations/10000002/prices" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "typeIds": ["34", "35", "99999"]
  }'
```

**Response:**

```json
{
  "data": [
    {
      "typeId": "34",
      "snapshotId": "abc-123",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "bestBuyPrice": "6.50",
      "bestSellPrice": "6.55",
      "totalBuyVolume": "5000000000",
      "totalSellVolume": "3000000000",
      "buyOrderCount": 150,
      "sellOrderCount": 120,
      "spreadAmount": "0.05",
      "spreadPercent": "0.77"
    },
    {
      "typeId": "35",
      "snapshotId": "abc-123",
      "snapshotTime": "2025-11-04T12:00:00.000Z",
      "bestBuyPrice": "15.00",
      "bestSellPrice": "15.10",
      "totalBuyVolume": "2000000000",
      "totalSellVolume": "1500000000",
      "buyOrderCount": 85,
      "sellOrderCount": 70,
      "spreadAmount": "0.10",
      "spreadPercent": "0.67"
    }
  ],
  "missingTypeIds": ["99999"],
  "meta": {
    "locationId": "10000002",
    "locationType": "region",
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

The `missingTypeIds` array indicates which items have no market data available.

---

### Example 6: Error Handling - Validation

Invalid request with too many items:

```bash
curl -X POST "https://api.pleaseignore.app/v1/markets/locations/10000002/prices" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "typeIds": ["1", "2", "3", ... 501 items]
  }'
```

**Response:**

```json
{
  "error": "Request validation failed",
  "errors": ["typeIds: Maximum 500 type IDs per request"],
  "meta": {
    "requestId": "abc123",
    "timestamp": "2025-11-04T12:05:00.000Z",
    "version": "1"
  }
}
```

Status: `400 Bad Request`

---

### Example 7: Pagination

Paginate through all snapshots:

```bash
# First page
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/snapshots?limit=100" \
  -H "Authorization: Bearer YOUR_API_KEY"

# Use nextCursor from response for second page
curl "https://api.pleaseignore.app/v1/markets/locations/10000002/snapshots?limit=100&cursor=eyJpZCI6IjU1MGU4NDAwIn0" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Continue using the `nextCursor` value until it's `null` (indicating no more pages).

---

## CORS Support

The API supports Cross-Origin Resource Sharing (CORS) for browser-based applications:

**Allowed Origins:** `*` (all origins)
**Allowed Methods:** `GET`, `POST`, `OPTIONS`
**Allowed Headers:** `Content-Type`, `Authorization`
**Max Age:** 86400 seconds (24 hours)

Preflight requests are automatically handled:

```bash
curl -X OPTIONS "https://api.pleaseignore.app/v1/markets/locations/10000002/refresh" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Authorization"
```

---

## Best Practices

### 1. Use Batch Endpoints

Instead of making multiple individual requests:

```typescript
// DON'T DO THIS
for (const typeId of typeIds) {
  await fetch(`/locations/${locationId}/prices`, {
    body: JSON.stringify({ typeIds: [typeId] }),
  })
}

// DO THIS
await fetch(`/locations/${locationId}/prices`, {
  body: JSON.stringify({ typeIds: typeIds }),
})
```

### 2. Respect Cache Headers

Check the `X-Cache` header and use cached responses when possible:

```typescript
const response = await fetch(url)
const cacheStatus = response.headers.get('X-Cache')
if (cacheStatus === 'HIT') {
  console.log('Served from cache')
}
```

### 3. Handle Missing Data Gracefully

Always check the `missingTypeIds` array:

```typescript
const response = await fetch(url, {
  body: JSON.stringify({ typeIds }),
})
const { data, missingTypeIds } = await response.json()

if (missingTypeIds.length > 0) {
  console.log('No market data for:', missingTypeIds)
}
```

### 4. Store Numeric Values Correctly

Convert string prices to numbers for calculations:

```typescript
const price = Number(data.bestBuyPrice)
const volume = Number(data.totalBuyVolume)

if (isNaN(price) || isNaN(volume)) {
  // Handle null or invalid values
  console.warn('Invalid price data')
}
```

### 5. Monitor Refresh Status

Before querying prices, check when data was last updated:

```typescript
const refreshStatus = await fetch(`/locations/${locationId}/refresh`)
const { data } = await refreshStatus.json()

console.log('Last updated:', data.lastSnapshotTime)
console.log('Next refresh:', data.nextRefreshTime)
```

### 6. Implement Retry Logic

For transient errors (500, 503), implement exponential backoff:

```typescript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const response = await fetch(url, options)

    if (response.ok) {
      return response
    }

    if (response.status >= 500 && i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, i) * 1000))
      continue
    }

    throw new Error(`HTTP ${response.status}`)
  }
}
```
