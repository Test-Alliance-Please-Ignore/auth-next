import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			miniflare: {
				compatibilityDate: '2025-03-07',
				compatibilityFlags: ['nodejs_compat'],
				bindings: {
					ENVIRONMENT: 'VITEST',
				},
				durableObjects: {
					UNIVERSE: 'UniverseDO',
				},
			},
		}),
	],

	test: {},
})
