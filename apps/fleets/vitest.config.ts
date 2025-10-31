import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
						CORE_API_URL: 'https://pleaseignore.app',
					},
					durableObjects: {
						FLEETS: 'Fleets'
					},
				},
			},
		},
	},
})
