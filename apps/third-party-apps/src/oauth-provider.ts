import { THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT } from './oauth-contract'
import {
	OAUTH_INTERNAL_AUTHORIZE_PREVIEW_PATH,
	OAUTH_INTERNAL_AUTHORIZE_RESOLVE_PATH,
} from './oauth-routes'
import type { Env } from './context'
import { previewOAuthAuthorization, resolveOAuthAuthorization } from './services/oauth.service'

export const THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS = {
	...THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT,
	defaultHandler: {
		fetch: async (request: Request, env: unknown, _ctx: ExecutionContext) => {
			const url = new URL(request.url)
			const typedEnv = env as Env
			if (url.pathname === OAUTH_INTERNAL_AUTHORIZE_PREVIEW_PATH && request.method === 'POST') {
				const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
				const requestUrl = typeof body.requestUrl === 'string' ? body.requestUrl : ''
				const expectedOrigin = typeof body.expectedOrigin === 'string' ? body.expectedOrigin : ''
				return Response.json(await previewOAuthAuthorization(typedEnv, requestUrl, expectedOrigin))
			}
			if (url.pathname === OAUTH_INTERNAL_AUTHORIZE_RESOLVE_PATH && request.method === 'POST') {
				const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
				const requestUrl = typeof body.requestUrl === 'string' ? body.requestUrl : ''
				const expectedOrigin = typeof body.expectedOrigin === 'string' ? body.expectedOrigin : ''
				const user = body.user as Parameters<typeof resolveOAuthAuthorization>[3] | undefined
				const action = body.action as Parameters<typeof resolveOAuthAuthorization>[4] | undefined
				if (!user || !action) {
					return Response.json(null)
				}
				return Response.json(await resolveOAuthAuthorization(typedEnv, requestUrl, expectedOrigin, user, action))
			}
			return new Response('Not found', { status: 404 })
		},
	},
	scopesSupported: [...THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT.scopesSupported],
}
