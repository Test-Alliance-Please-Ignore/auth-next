import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		name: 'hr-integration',
		include: ['src/test/integration/**/*.test.ts'],
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.test.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
					},
				},
			},
		},
	},
})
