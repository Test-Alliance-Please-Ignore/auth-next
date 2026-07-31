import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: `${__dirname}/wrangler.test.jsonc` },
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
						name: 'eve-token-store',
						modules: true,
						script: `
                        import { DurableObject } from 'cloudflare:workers'

                        export class EveTokenStore extends DurableObject {
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
		}),
	],

	test: {
		exclude: ['**/node_modules/**', '**/.git/**', 'src/test/unit/workflows/wallet-fanout.test.ts'],
	},
})
