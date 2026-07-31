import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
			miniflare: {
				bindings: {
					ENVIRONMENT: 'VITEST',
				},
			},
		}),
	],

	test: {
		name: 'prediction-markets-unit',
		exclude: ['**/node_modules/**', 'src/test/integration/**'],
	},
})
