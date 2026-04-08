import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

if (!process.env.XDG_CONFIG_HOME) {
	process.env.XDG_CONFIG_HOME = '/tmp'
}

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.test.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
					},
				},
			},
		},
	},
})
