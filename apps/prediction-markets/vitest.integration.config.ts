import { defineConfig } from 'vitest/config'

if (process.env.CI || process.env.GITHUB_ACTIONS) {
	throw new Error('Prediction Markets Neon integration tests are local-only and cannot run in CI')
}

export default defineConfig({
	test: {
		name: 'prediction-markets-integration',
		environment: 'node',
		include: ['src/test/integration/**/*.int.test.ts'],
		globalSetup: ['./src/test/integration/global-setup.ts'],
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } },
		testTimeout: 60_000,
		hookTimeout: 120_000,
	},
})
