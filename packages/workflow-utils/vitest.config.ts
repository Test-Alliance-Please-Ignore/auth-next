import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

// This package's sources import `cloudflare:workflows` / `cloudflare:workers`, which only
// resolve inside the workers runtime — plain node vitest cannot collect these suites.
export default defineWorkersConfig({
	test: {
		globals: true,
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
			},
		},
	},
})
