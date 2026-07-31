import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

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
	],

	test: {
		exclude: ['**/node_modules/**', 'src/test/integration/**'],
	},
})
