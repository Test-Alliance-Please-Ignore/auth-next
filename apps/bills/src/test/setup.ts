import { env } from 'cloudflare:test'
import { makeNeonTesting } from 'neon-testing'

import { createDbClientRaw, migrate } from '@repo/db-utils'

/**
 * Test setup for bills integration tests
 *
 * Uses neon-testing to provide database branching for isolated test environments.
 * Each test file gets its own database branch.
 *
 * Requires NEON_API_KEY and NEON_PROJECT_ID environment variables.
 */
if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) {
	throw new Error('NEON_API_KEY and NEON_PROJECT_ID must be set')
}

export const withNeonTestBranch = makeNeonTesting({
	apiKey: env.NEON_API_KEY!,
	projectId: env.NEON_PROJECT_ID!,
	// Recommended for Neon WebSocket drivers to automatically close connections:
	autoCloseWebSockets: true,
})
