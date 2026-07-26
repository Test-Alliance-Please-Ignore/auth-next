import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `${__dirname}/wrangler.test.jsonc` },
			miniflare: {
				bindings: {
					ENVIRONMENT: 'VITEST',
				},
			},
		}),
	],

	test: {
		name: 'hr-integration',
		include: ['src/test/integration/**/*.test.ts'],
	},
})
