import { defineConfig } from 'vitest/config'

if (process.env.CI || process.env.GITHUB_ACTIONS) {
	throw new Error('Bills PostgreSQL integration tests are local-only and cannot run in CI')
}

export default defineConfig({
	test: {
		name: 'bills-integration',
		environment: 'node',
		include: ['src/test/integration/**/*.int.test.ts'],
		pool: 'forks',
		fileParallelism: false,
		maxWorkers: 1,
		testTimeout: 60_000,
		hookTimeout: 120_000,
	},
})
