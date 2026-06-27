import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		exclude: ['src/test/unit/workflows/wallet-fanout.test.ts'],
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
						DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
					},
					workers: [
						{
							name: 'core',
							modules: true,
							script: `
								export class CoreWorker {
									fetch() {
										return new Response('Mock Core Worker')
									}
								}
								export default {
									fetch() {
										return new Response('Mock Core Worker')
									}
								}
							`,
						},
						{
							name: 'corporation-tax',
							modules: true,
							script: `
								export default {
									fetch() {
										return new Response('Mock CorporationTax Worker')
									}
								}
							`,
						},
						{
							name: 'universe',
							modules: true,
							script: `
								export default {
									fetch() {
										return new Response('Mock Universe Worker')
									}
								}
							`,
						},
						{
							name: 'esi',
							modules: true,
							script: `
								export default {
									fetch() {
										return new Response('Mock ESI Worker')
									}
								}
							`,
						},
						{
							name: 'eve-token-store',
							modules: true,
							script: `
								export class EveTokenStore {
									constructor(state, env) {}
									async fetch(request) {
										return new Response('Mock EveTokenStore')
									}
									async getAccessToken() {
										return 'mock-token'
									}
								}
								export default {
									fetch: () => new Response('Mock EveTokenStore Worker')
								}
							`,
						},
					],
				},
			},
		},
	},
})
