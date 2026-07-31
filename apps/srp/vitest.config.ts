import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const stubWorker = (name: string) => ({
	name,
	modules: true,
	script: `export default { fetch() { return new Response('stub') } }`,
})

export default defineConfig({
	plugins: [
		cloudflareTest({
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
		}),
	],

	test: {},
})
