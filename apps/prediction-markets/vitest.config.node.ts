import { defineConfig } from 'vitest/config'

/**
 * Node-environment project for the money-flow INTEGRATION tests (real Postgres).
 *
 * Auto-discovered by the shared `run-vitest` wrapper (which runs this alongside the workers-pool
 * `vitest.config.ts`). The tests run against a fresh ephemeral Neon branch provisioned by
 * `globalSetup`; they skip themselves when NEON creds are absent, so this project is a no-op in
 * environments without secrets.
 *
 * Single-fork + generous timeouts: one shared DB (no parallel writers), and the first query after
 * branch provisioning pays a cold-start cost.
 */
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
