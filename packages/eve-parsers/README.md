# @repo/eve-parsers

Shared utilities and helpers for the EveParsers package.

## Installation

This is an internal workspace package. Add it to your worker or package:

```bash
pnpm -F your-worker add '@repo/eve-parsers@workspace:*'
```

## Usage

Import functions from this package:

```typescript
import { example } from '@repo/eve-parsers'

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
