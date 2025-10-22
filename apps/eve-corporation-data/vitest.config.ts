import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
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
