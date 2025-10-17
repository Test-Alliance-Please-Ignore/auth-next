import { defineWorkersProject } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersProject({
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: `${__dirname}/wrangler.jsonc` },
				miniflare: {
					bindings: {
						ENVIRONMENT: 'VITEST',
						ADMIN_API_TOKENS: 'test-admin-token',
						ESI_SSO_CLIENT_ID: 'test-client-id',
						ESI_SSO_CLIENT_SECRET: 'test-client-secret',
						ESI_SSO_CALLBACK_URL: 'https://example.com/esi/callback',
					},
					serviceBindings: {},
				},
			},
		},
	},
})
