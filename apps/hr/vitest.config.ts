import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
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
