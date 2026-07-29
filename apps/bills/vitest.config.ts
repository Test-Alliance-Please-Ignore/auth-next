import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	esbuild: {
		// Required for `using` support
		target: 'ES2022',
	},
	test: {
		setupFiles: ['./src/test/setup.ts'],
		poolOptions: {
			workers: {
				singleWorker: true,
				isolatedStorage: false,
				wrangler: {
					configPath: './wrangler.jsonc',
				},
			},
		},
	},
})
