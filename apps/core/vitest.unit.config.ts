import { defineConfig } from 'vitest/config'

export default defineConfig({
	resolve: {
		alias: {
			'cloudflare:workers': new URL('./src/test/mocks/cloudflare-workers.ts', import.meta.url)
				.pathname,
			// @repo/workflow-utils re-exports NonRetryableError from
			// 'cloudflare:workflows', so any test that imports the shared step-config
			// presets fails to load without this. The shim exports NonRetryableError
			// already; point both virtual modules at it.
			'cloudflare:workflows': new URL('./src/test/mocks/cloudflare-workers.ts', import.meta.url)
				.pathname,
		},
	},
	test: {
		environment: 'node',
		include: [
			'src/routes/__tests__/**/*.test.ts',
			'src/services/__tests__/**/*.test.ts',
			'src/lib/__tests__/**/*.test.ts',
			'src/workflows/**/*.test.ts',
			'src/__tests__/**/*.test.ts',
		],
	},
})
