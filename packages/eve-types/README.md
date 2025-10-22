# @repo/eve-types

Shared utilities and helpers for the EveTypes package.

## Installation

This is an internal workspace package. Add it to your worker or package:

```bash
pnpm -F your-worker add '@repo/eve-types@workspace:*'
```

## Usage

Import functions from this package:

```typescript
import { example } from '@repo/eve-types'

const result = example('hello')
console.log(result) // "Example: hello"
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
