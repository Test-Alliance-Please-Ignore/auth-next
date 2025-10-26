# @repo/hazmat

Cryptographically secure random utilities for Cloudflare Workers.

This package provides Web Crypto API-based utilities that work in Cloudflare Workers environments.

## Installation

This is an internal workspace package. Add it to your worker or package:

```bash
pnpm -F your-worker add '@repo/hazmat@workspace:*'
```

## Usage

### Generate Random Shard Key

Generate a random integer in a specific range for distributed systems:

```typescript
import { generateShardKey } from '@repo/hazmat'

// Generate a random number in range [0, 9] (inclusive)
const shardKey = generateShardKey(0, 9)
console.log(shardKey) // Can be: 0, 1, 2, 3, 4, 5, 6, 7, 8, or 9

// Common use case: Discord proxy port selection
// If ports are 10001-10007 (7 ports total)
const port = generateShardKey(10001, 10007)
console.log(port) // Can be: 10001, 10002, 10003, 10004, 10005, 10006, or 10007

// Discord bot sharding (0-4 for 5 shards)
const shard = generateShardKey(0, 4)
```

### Generate Random Bytes

Generate cryptographically secure random bytes:

```typescript
import { generateRandomBytes } from '@repo/hazmat'

// Generate 32 random bytes
const bytes = generateRandomBytes(32)
console.log(bytes) // Uint8Array(32) [...]
```

## Development

```bash
# Run type checking
pnpm check:types

# Run linting
pnpm check:lint

# Run tests
pnpm test
```
