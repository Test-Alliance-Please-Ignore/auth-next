import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const stubWorker = (
	name: string,
	durableObjectClasses: string[],
	entrypointClasses: string[] = []
) => ({
	name,
	modules: true,
	script: [
		"import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers'",
		...durableObjectClasses.map(
			(className) => `export class ${className} extends DurableObject {}`
		),
		...entrypointClasses.map(
			(className) => `export class ${className} extends WorkerEntrypoint {}`
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
			wrangler: { configPath: `${__dirname}/wrangler.test.jsonc` },
			miniflare: {
				bindings: {
					ENVIRONMENT: 'VITEST',
				},
				r2Buckets: ['CHARACTER_REPORTS'],
				workers: [
					stubWorker('core', [], ['CoreWorker']),
					stubWorker('markets', ['Markets']),
					stubWorker('esi', ['Esi', 'EsiTypeResolver']),
					stubWorker('eve-token-store', ['EveTokenStore']),
					stubWorker('universe', ['Universe']),
					stubWorker('discord', ['Discord']),
					stubWorker('hr', ['Hr']),
				],
			},
		}),
	],

	test: {},
})
