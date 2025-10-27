import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'
import { neonTesting } from 'neon-testing/vite'

export default defineWorkersConfig({
	plugins: [neonTesting({ debug: true })],
	test: {
		setupFiles: ['./src/test/setup.ts'],
		poolOptions: {
			workers: {
				wrangler: {
					configPath: './wrangler.jsonc',
				},
			},
		},
	},
})
