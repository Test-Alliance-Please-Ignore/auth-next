import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		name: 'prediction-markets-unit',
		// Pure-lib unit tests run in the workers pool. The Node-environment integration tests
		// (src/test/integration) run separately via vitest.config.node.ts — exclude them here.
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
