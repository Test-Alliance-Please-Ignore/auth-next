import { OAuthProvider } from '@cloudflare/workers-oauth-provider'

import { THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT } from './oauth-contract'
import { isOAuthHttpRoute as isOAuthHttpRoutePath } from './oauth-routes'
import { THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS } from './oauth-api-handler'
import type { Env } from './context'

const oauthProvider = new OAuthProvider(THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS)
const LOCAL_DEV_UI_ORIGIN = 'http://127.0.0.1:5173'

function isLocalHttpUrl(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname.endsWith('.localhost'))
	)
}

export function isOAuthHttpRoute(request: Request): boolean {
	return isOAuthHttpRoutePath(new URL(request.url).pathname)
}

function buildOAuthDiscoveryResponse(request: Request): Response {
	const requestUrl = new URL(request.url)
	const tokenEndpoint = `${requestUrl.origin}${THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT.tokenEndpoint}`
	const authorizationEndpoint =
		isLocalHttpUrl(requestUrl)
			? `${LOCAL_DEV_UI_ORIGIN}${THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT.authorizeEndpoint}`
			: `${requestUrl.origin}${THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT.authorizeEndpoint}`

	return Response.json({
		issuer: requestUrl.origin,
		authorization_endpoint: authorizationEndpoint,
		token_endpoint: tokenEndpoint,
		scopes_supported: THIRD_PARTY_APPS_OAUTH_PROVIDER_CONTRACT.scopesSupported,
		response_types_supported: ['code'],
		response_modes_supported: ['query'],
		grant_types_supported: ['authorization_code', 'refresh_token'],
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
		revocation_endpoint: tokenEndpoint,
		code_challenge_methods_supported: ['plain', 'S256'],
	})
}

export async function handleThirdPartyAppsHttpRequest(
	request: Request,
	env: Env,
	ctx: ExecutionContext
): Promise<Response | null> {
	if (!isOAuthHttpRoute(request)) {
		return null
	}

	const url = new URL(request.url)
	if (url.pathname === '/.well-known/oauth-authorization-server') {
		return buildOAuthDiscoveryResponse(request)
	}

	return await oauthProvider.fetch(request, env, ctx)
}
