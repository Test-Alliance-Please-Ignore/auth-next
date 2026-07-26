import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `./wrangler.test.jsonc` },
		}),
	],

	esbuild: {
		target: 'ES2022',
	},

	test: {
		include: ['src/test/integration/**/*.test.ts'],
	},
})
