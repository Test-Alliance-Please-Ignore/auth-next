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
					},
					serviceBindings: {
						// Mock SOCIAL_AUTH service
						SOCIAL_AUTH: async (request: Request) => {
							const url = new URL(request.url)

							// Mock session verification
							if (url.pathname === '/api/session/verify') {
								return Response.json({
									success: true,
									session: { socialUserId: 'test-social-user-id', isAdmin: false },
								})
							}

							// Mock get user characters
							if (url.pathname.startsWith('/api/users/') && url.pathname.endsWith('/characters')) {
								return Response.json({
									success: true,
									characters: [
										{ characterId: 93123456, characterName: 'Test Character 1', isPrimary: true },
										{ characterId: 93123457, characterName: 'Test Character 2', isPrimary: false },
									],
								})
							}

							// Mock primary character name
							if (url.pathname.includes('/primary-character')) {
								return Response.json({
									success: true,
									characterName: 'Test Character',
								})
							}

							return new Response('Not Found', { status: 404 })
						},
						// Mock ESI service
						ESI: async (request: Request) => {
							const url = new URL(request.url)

							// Mock character data
							if (url.pathname.includes('/esi/characters/')) {
								const characterId = parseInt(url.pathname.split('/').pop() || '0')
								return Response.json({
									characterId,
									name: `Test Character ${characterId}`,
									corporationId: 98000001,
									allianceId: 99000001,
								})
							}

							// Mock corporation data
							if (url.pathname.includes('/esi/corporations/')) {
								const corpId = parseInt(url.pathname.split('/').pop() || '0')
								return Response.json({
									corporationId: corpId,
									name: 'Test Corporation',
									ticker: 'TEST',
									memberCount: 100,
								})
							}

							return new Response('Not Found', { status: 404 })
						},
					},
				},
			},
		},
	},
})
