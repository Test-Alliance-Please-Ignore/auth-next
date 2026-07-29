import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		exclude: ['**/node_modules/**', 'src/test/integration/**'],
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
					},
				},
			},
		},
	},
})
