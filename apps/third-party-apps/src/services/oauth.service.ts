import type {
	OAuthAuthorizationAction,
	OAuthAuthorizationPreview,
	OAuthAuthorizationResult,
	OAuthSessionUser,
	ThirdPartyAppScope,
} from '@repo/admin'
import type { CoreWorker } from '@repo/admin'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'
import type { Groups } from '@repo/groups'

import { proxyEsiRequest } from '../esi-proxy'
import {
	extractCharacterIdFromEsiPath,
	hasScope,
	isAllowedWritePath,
	isReadMethod,
	normalizeEsiProxyPath,
	requiredScopeForEsiRequest,
} from '../proxy-policy'
import { getClientMetadata, requestedScopesAreAllowed } from '../oauth-contract'
import type { EveTokenStoreClient, Env } from '../context'

type OAuthGrantProps = {
	sub: string
	scope: ThirdPartyAppScope[]
	clientId: string
}

function isLocalHttpOrigin(origin: string): boolean {
	try {
		const url = new URL(origin)
		return isAllowedLocalHttpUrl(url)
	} catch {
		return false
	}
}

function isAllowedLocalHttpUrl(url: URL): boolean {
	return (
		url.protocol === 'http:' &&
		(url.hostname === 'localhost' ||
			url.hostname === '127.0.0.1' ||
			url.hostname === '[::1]' ||
			url.hostname.endsWith('.localhost'))
	)
}

function validateAuthorizeRequestUrl(
	env: Env,
	requestUrl: string,
	expectedOrigin: string
): URL | null {
	try {
		const parsed = new URL(requestUrl)
		if (parsed.pathname !== '/authorize') {
			logger.warn('[ThirdPartyApps OAuth] Rejecting authorize request URL with unexpected pathname', {
				requestUrl,
				pathname: parsed.pathname,
				expectedOrigin,
				environment: env.ENVIRONMENT,
			})
			return null
		}
		if (isAllowedLocalHttpUrl(parsed) && isLocalHttpOrigin(expectedOrigin)) return parsed
		if (parsed.protocol === 'https:' && parsed.origin === expectedOrigin) return parsed
		logger.warn('[ThirdPartyApps OAuth] Rejecting authorize request URL with invalid origin or protocol', {
			requestUrl,
			origin: parsed.origin,
			protocol: parsed.protocol,
			expectedOrigin,
			environment: env.ENVIRONMENT,
		})
		return null
	} catch {
		logger.warn('[ThirdPartyApps OAuth] Rejecting authorize request URL that failed to parse', {
			requestUrl,
			expectedOrigin,
			environment: env.ENVIRONMENT,
		})
		return null
	}
}

function buildProps(user: OAuthSessionUser, scope: ThirdPartyAppScope[], clientId: string): OAuthGrantProps {
	return {
		sub: user.id,
		scope,
		clientId,
	}
}

function buildDeniedRedirect(redirectUri: string, state?: string | null): string {
	const redirect = new URL(redirectUri)
	redirect.searchParams.set('error', 'access_denied')
	if (state) redirect.searchParams.set('state', state)
	return redirect.toString()
}

async function parseAuthRequest(env: Env, requestUrl: string, expectedOrigin: string) {
	const validatedUrl = validateAuthorizeRequestUrl(env, requestUrl, expectedOrigin)
	if (!validatedUrl) {
		logger.warn('[ThirdPartyApps OAuth] Authorization request validation failed before provider parsing', {
			requestUrl,
			expectedOrigin,
			environment: env.ENVIRONMENT,
		})
		return null
	}

	let authRequest
	try {
		authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(validatedUrl))
	} catch (error) {
		logger.error('[ThirdPartyApps OAuth] Provider threw while parsing authorization request', {
			requestUrl: validatedUrl.toString(),
			expectedOrigin,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
			environment: env.ENVIRONMENT,
		})
		return null
	}
	if (!authRequest.clientId || !authRequest.scope || authRequest.scope.length === 0) {
		logger.warn('[ThirdPartyApps OAuth] Provider rejected authorization request during parsing', {
			requestUrl: validatedUrl.toString(),
			expectedOrigin,
			clientId: authRequest.clientId ?? null,
			scopeCount: authRequest.scope?.length ?? 0,
			redirectUri: authRequest.redirectUri ?? null,
			statePresent: Boolean(authRequest.state),
			responseType: authRequest.responseType ?? null,
			environment: env.ENVIRONMENT,
		})
		return null
	}

	const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId)
	if (!client) {
		logger.warn('[ThirdPartyApps OAuth] Authorization request client lookup failed', {
			requestUrl: validatedUrl.toString(),
			expectedOrigin,
			clientId: authRequest.clientId,
			redirectUri: authRequest.redirectUri ?? null,
			scope: authRequest.scope,
			environment: env.ENVIRONMENT,
		})
		return null
	}

	const metadata = await getClientMetadata(env, authRequest.clientId)
	if (!requestedScopesAreAllowed(authRequest.scope, metadata.scopes)) {
		logger.warn('[ThirdPartyApps OAuth] Authorization request requested disallowed scopes', {
			requestUrl: validatedUrl.toString(),
			expectedOrigin,
			clientId: authRequest.clientId,
			redirectUri: authRequest.redirectUri ?? null,
			requestedScopes: authRequest.scope,
			allowedScopes: metadata.scopes,
			environment: env.ENVIRONMENT,
		})
		return null
	}

	return { authRequest, client, metadata }
}

export async function tokenScopesAreStillAllowed(
	env: Env,
	props: OAuthGrantProps
): Promise<boolean> {
	const client = await env.OAUTH_PROVIDER.lookupClient(props.clientId)
	if (!client) {
		return false
	}
	const metadata = await getClientMetadata(env, props.clientId)
	return requestedScopesAreAllowed(props.scope, metadata.scopes)
}

export async function buildOAuthApiMeResponse(
	env: Env,
	props: OAuthGrantProps
): Promise<Record<string, unknown>> {
	const response: Record<string, unknown> = {
		sub: props.sub,
		clientId: props.clientId,
		scope: props.scope,
	}

	const includeProfile = hasScope(props.scope, 'profile')
	const includeGroups = hasScope(props.scope, 'groups')
	const includePermissions = hasScope(props.scope, 'permissions')
	if (!includeProfile && !includeGroups && !includePermissions) {
		return response
	}

	const core = env.CORE as CoreWorker
	const details = await core.getUserDetails(props.sub)
	if (!details) {
		return response
	}

	if (includeProfile) {
		response.mainCharacterId = details.mainCharacterId
		response.isAdmin = details.is_admin
		response.characters = details.characters.map((character) => ({
			characterId: character.characterId,
			characterName: character.characterName,
			isPrimary: character.is_primary,
			hasValidToken: character.hasValidToken,
		}))
	}

	if (includeGroups) {
		const sluggifiedGroupNames = Array.from(
			new Set(
				details.groupMemberships
					.map((membership) => membership.groupName.trim().toLowerCase().replace(/\s+/g, '-'))
					.filter((groupName) => groupName.length > 0)
			)
		)
		response.groupMemberships = details.groupMemberships.map((membership) => ({
			groupId: membership.groupId,
			groupName: membership.groupName,
			membershipLevel: membership.membershipLevel,
			joinedAt: membership.joinedAt.toISOString(),
		}))
		response.groups = sluggifiedGroupNames
	}

	if (includePermissions) {
		const groups = getStub<Groups>(env.GROUPS, 'default')
		const permissions = await groups.getUserPermissions(props.sub)
		response.permissionUrns = permissions.map((permission) => permission.urn)
	}

	return response
}

export async function previewOAuthAuthorization(
	env: Env,
	requestUrl: string,
	expectedOrigin: string
): Promise<OAuthAuthorizationPreview | null> {
	const parsed = await parseAuthRequest(env, requestUrl, expectedOrigin)
	if (!parsed) {
		logger.warn('[ThirdPartyApps OAuth] Authorization preview rejected', {
			requestUrl,
			expectedOrigin,
			environment: env.ENVIRONMENT,
		})
		return null
	}
	return {
		clientId: parsed.authRequest.clientId,
		clientName: parsed.client.clientName ?? null,
		scope: parsed.authRequest.scope,
		state: parsed.authRequest.state ?? null,
	}
}

export async function resolveOAuthAuthorization(
	env: Env,
	requestUrl: string,
	expectedOrigin: string,
	user: OAuthSessionUser,
	action: OAuthAuthorizationAction
): Promise<OAuthAuthorizationResult | null> {
	const parsed = await parseAuthRequest(env, requestUrl, expectedOrigin)
	if (!parsed || !parsed.authRequest.redirectUri) {
		logger.warn('[ThirdPartyApps OAuth] Authorization resolution rejected before completion', {
			requestUrl,
			expectedOrigin,
			userId: user.id,
			action,
			hasParsedRequest: Boolean(parsed),
			redirectUri: parsed?.authRequest.redirectUri ?? null,
			environment: env.ENVIRONMENT,
		})
		return null
	}
	if (action === 'deny') {
		return {
			redirectTo: buildDeniedRedirect(parsed.authRequest.redirectUri, parsed.authRequest.state),
		}
	}
	const scopes = parsed.authRequest.scope as ThirdPartyAppScope[]
	const props = buildProps(user, scopes, parsed.authRequest.clientId)
	const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
		request: parsed.authRequest,
		userId: user.id,
		metadata: { label: parsed.authRequest.clientId },
		scope: scopes,
		props,
	})
	return { redirectTo }
}

export async function handleThirdPartyAppsInternalRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url)
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

	if (url.pathname === '/__internal/rpc/authorize/preview' && request.method === 'POST') {
		const requestUrl = typeof body.requestUrl === 'string' ? body.requestUrl : ''
		const expectedOrigin = typeof body.expectedOrigin === 'string' ? body.expectedOrigin : ''
		const preview = await previewOAuthAuthorization(env, requestUrl, expectedOrigin)
		return Response.json(preview)
	}

	if (url.pathname === '/__internal/rpc/authorize/resolve' && request.method === 'POST') {
		const requestUrl = typeof body.requestUrl === 'string' ? body.requestUrl : ''
		const expectedOrigin = typeof body.expectedOrigin === 'string' ? body.expectedOrigin : ''
		const user = body.user as OAuthSessionUser | undefined
		const action = body.action as OAuthAuthorizationAction | undefined
		if (!user || !action) {
			return Response.json(null)
		}
		const resolved = await resolveOAuthAuthorization(env, requestUrl, expectedOrigin, user, action)
		return Response.json(resolved)
	}

	return new Response('Not found', { status: 404 })
}

export async function buildOAuthApiMeResponseIfAllowed(
	env: Env,
	props: OAuthGrantProps
): Promise<Record<string, unknown> | null> {
	if (!(await tokenScopesAreStillAllowed(env, props))) {
		return null
	}
	return await buildOAuthApiMeResponse(env, props)
}

export type { OAuthGrantProps }
