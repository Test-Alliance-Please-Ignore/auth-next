import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	esbuild: {
		target: 'ES2022',
	},
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: `./wrangler.test.jsonc` },
			},
		},
		include: ['src/test/integration/**/*.test.ts'],
	},
})
