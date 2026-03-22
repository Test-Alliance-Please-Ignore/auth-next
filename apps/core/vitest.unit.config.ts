import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			'cloudflare:workers': new URL('./src/test/mocks/cloudflare-workers.ts', import.meta.url)
				.pathname,
		},
	},
	test: {
		environment: 'node',
		include: ['src/routes/__tests__/**/*.test.ts'],
	},
})
