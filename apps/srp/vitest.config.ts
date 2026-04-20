import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

const stubWorker = (name: string) => ({
	name,
	modules: true,
	script: `export default { fetch() { return new Response('stub') } }`,
})

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
					},
					workers: [
						stubWorker('markets'),
						stubWorker('eve-character-data'),
						stubWorker('eve-corporation-data'),
						stubWorker('eve-token-store'),
						stubWorker('esi'),
					],
				},
			},
		},
	},
})
