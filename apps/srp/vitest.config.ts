import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const stubWorker = (name: string, durableObjectClasses: string[]) => ({
	name,
	modules: true,
	script: [
		"import { DurableObject } from 'cloudflare:workers'",
		...durableObjectClasses.map(
			(className) => `export class ${className} extends DurableObject {}`
		),
		"export default { fetch() { return new Response('stub') } }",
	].join('\n'),
	durableObjects: Object.fromEntries(
		durableObjectClasses.map((className) => [className, className])
	),
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
					stubWorker('markets', ['Markets']),
					stubWorker('eve-character-data', ['EveCharacterData']),
					stubWorker('eve-corporation-data', ['EveCorporationData']),
					stubWorker('eve-token-store', ['EveTokenStore']),
					stubWorker('esi', ['Esi', 'EsiTypeResolver']),
					stubWorker('universe', ['Universe']),
					stubWorker('discord', ['Discord']),
				],
			},
		}),
	],

	test: {},
})
