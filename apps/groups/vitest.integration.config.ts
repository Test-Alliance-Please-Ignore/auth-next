import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { neonTesting } from 'neon-testing/vite'
import { defineConfig } from 'vitest/config'

if (process.env.CI || process.env.GITHUB_ACTIONS) {
	throw new Error('Groups Neon integration tests are local-only and cannot run in CI')
}

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
			miniflare: {
				bindings: {
					ENVIRONMENT: 'VITEST',
					DATABASE_URL: process.env.DATABASE_URL || '',
				},
			},
		}),
		neonTesting(),
	],
})
