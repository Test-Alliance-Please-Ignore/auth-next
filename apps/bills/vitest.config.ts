import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: {
				configPath: './wrangler.jsonc',
			},
		}),
	],

	esbuild: {
		// Required for `using` support
		target: 'ES2022',
	},

	test: {
		setupFiles: ['./src/test/setup.ts'],
	},
})
