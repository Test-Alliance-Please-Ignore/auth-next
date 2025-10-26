import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'
import { neonTesting } from 'neon-testing/vite'

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
