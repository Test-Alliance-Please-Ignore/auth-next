import { env } from 'cloudflare:test'
import { afterAll, beforeAll } from 'vitest'

import { TestBranchManager } from '@repo/db-utils'

if (!env.NEON_API_KEY || !env.NEON_PROJECT_ID) {
	throw new Error('NEON_API_KEY and NEON_PROJECT_ID must be set')
}

/**
 * Test setup for bills integration tests
 *
 * Uses neon-testing to provide database branching for isolated test environments.
 * Each test file gets its own database branch.
 *
 * Requires NEON_API_KEY and NEON_PROJECT_ID environment variables.
 */

export const testBranchManager = new TestBranchManager({
	NEON_API_KEY: env.NEON_API_KEY!,
	NEON_PROJECT_ID: env.NEON_PROJECT_ID!,
})

beforeAll(async () => {
	// Get the actual Bills Durable Object stub from the test environment
	const databaseUrl = await testBranchManager.beforeAll()
	console.log('databaseUrl', databaseUrl)
	Object.assign(env, { DATABASE_URL: databaseUrl })
	Object.assign(process.env, { DATABASE_URL: databaseUrl })
})

afterAll(async () => {
	await testBranchManager.afterAll()
	env.DATABASE_URL = ''
})
