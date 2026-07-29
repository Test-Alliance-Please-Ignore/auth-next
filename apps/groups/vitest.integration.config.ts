import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { neonTesting } from 'neon-testing/vite'

if (process.env.CI || process.env.GITHUB_ACTIONS) {
	throw new Error('Groups Neon integration tests are local-only and cannot run in CI')
}

export default defineWorkersProject({
	plugins: [neonTesting()],
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
						DATABASE_URL: process.env.DATABASE_URL || '',
					},
				},
			},
		},
	},
})
