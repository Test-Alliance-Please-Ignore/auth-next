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
					serviceBindings: {
						// Mock SOCIAL_AUTH service for testing
						SOCIAL_AUTH: async (request: Request) => {
							// Mock service that returns basic responses
							const url = new URL(request.url)
							if (url.pathname === '/api/session/verify') {
								return Response.json({
									success: true,
									session: { socialUserId: 'test-social-user-id' },
								})
							}
							if (url.pathname.startsWith('/api/characters/') && url.pathname.endsWith('/link')) {
								return Response.json({
									socialUserId: 'test-social-user-id',
									linkId: 'test-link-id',
								})
							}
							if (url.pathname === '/api/characters/link') {
								return Response.json({ success: true })
							}
							return new Response('Not Found', { status: 404 })
						},
					},
				},
			},
		},
	},
})
