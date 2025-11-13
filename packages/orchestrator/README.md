# @repo/orchestrator

Shared utilities and helpers for the Orchestrator package.

## Installation

This is an internal workspace package. Add it to your worker or package:

```bash
pnpm -F your-worker add '@repo/orchestrator@workspace:*'
```

## Usage

### Workflow instance helpers

```typescript
import { createWorkflowInstanceUpdater } from '@repo/orchestrator'

const updater = createWorkflowInstanceUpdater(workflowId, env.DATABASE_URL)

await updater.markRunning()

try {
	// run workflow steps
	await updater.markCompleted()
} catch (error) {
	await updater.markFailed(error)
	throw error
}
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
