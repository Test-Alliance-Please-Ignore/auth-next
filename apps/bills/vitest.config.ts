import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

console.log('DATABASE_URL', process.env.DATABASE_URL)

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
