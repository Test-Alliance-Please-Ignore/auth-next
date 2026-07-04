import { WorkerEntrypoint } from 'cloudflare:workers'

import type { CoreWorker, ThirdPartyAppScope } from '@repo/admin'
import { getStub } from '@repo/do-utils'

import { proxyEsiRequest } from './esi-proxy'
import type { EveTokenStoreClient, Env } from './context'
import { THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS as THIRD_PARTY_APPS_OAUTH_PROVIDER_BASE_OPTIONS } from './oauth-provider'
import {
	buildOAuthApiMeResponseIfAllowed,
	tokenScopesAreStillAllowed,
} from './services/oauth.service'
import {
	extractCharacterIdFromEsiPath,
	hasScope,
	isAllowedWritePath,
	isReadMethod,
	normalizeEsiProxyPath,
	requiredScopeForEsiRequest,
} from './proxy-policy'

type OAuthGrantContext = {
	sub?: string
	clientId?: string
	scope?: string[]
}

export class OAuthApiHandler extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		const props = (this.ctx.props ?? {}) as OAuthGrantContext

		if (url.pathname === '/oauth/api/me') {
			if (!props.sub || !props.clientId || !props.scope) {
				return Response.json({ error: 'unauthorized', message: 'Missing token grant context' }, { status: 401 })
			}
			const response = await buildOAuthApiMeResponseIfAllowed(this.env, {
				sub: props.sub,
				clientId: props.clientId,
				scope: props.scope as ThirdPartyAppScope[],
			})
			if (!response) {
				return Response.json(
					{ error: 'forbidden', message: 'Token scope is no longer allowed for this client' },
					{ status: 403 }
				)
			}
			return Response.json(response)
		}

		if (url.pathname.startsWith('/oauth/api/esi-proxy/')) {
			return await handleOAuthEsiProxyRequest(request, this.env, props)
		}

		return new Response('Not found', { status: 404 })
	}
}

async function handleOAuthEsiProxyRequest(
	request: Request,
	env: Env,
	props: OAuthGrantContext
): Promise<Response> {
	const url = new URL(request.url)
	const esiProxyPath = url.pathname.slice('/oauth/api/esi-proxy'.length)
	if (!esiProxyPath || esiProxyPath === '/') {
		return Response.json({ error: 'invalid_request', message: 'Missing ESI path' }, { status: 400 })
	}
	if (!props.sub || !props.clientId || !props.scope) {
		return Response.json({ error: 'unauthorized', message: 'Missing token grant context' }, { status: 401 })
	}

	const grantProps = {
		sub: props.sub,
		clientId: props.clientId,
		scope: props.scope as ThirdPartyAppScope[],
	}
	if (!(await tokenScopesAreStillAllowed(env, grantProps))) {
		return Response.json(
			{ error: 'forbidden', message: 'Token scope is no longer allowed for this client' },
			{ status: 403 }
		)
	}

	const method = request.method.toUpperCase()
	const pathWithVersionPrefix = normalizeEsiProxyPath(esiProxyPath)
	const requiredScope = requiredScopeForEsiRequest(method, pathWithVersionPrefix)
	if (!requiredScope) {
		return Response.json(
			{ error: 'forbidden', message: 'No third-party scope allows this ESI path' },
			{ status: 403 }
		)
	}
	if (!hasScope(props.scope, requiredScope)) {
		return Response.json(
			{ error: 'forbidden', message: `Missing required scope: ${requiredScope}` },
			{ status: 403 }
		)
	}

	const core = env.CORE as CoreWorker
	const linkedCharacterIds = new Set(await core.getUserCharacterIds(grantProps.sub))
	if (linkedCharacterIds.size === 0) {
		return Response.json({ error: 'forbidden', message: 'No linked characters available' }, { status: 403 })
	}

	let explicitCharacterId = url.searchParams.get('character_id') ?? request.headers.get('x-eve-character-id')
	if (!explicitCharacterId) {
		const details = await core.getUserDetails(grantProps.sub)
		explicitCharacterId = details?.mainCharacterId ?? null
	}
	if (!explicitCharacterId || !linkedCharacterIds.has(explicitCharacterId)) {
		return Response.json(
			{ error: 'forbidden', message: 'Requested character is not linked to this account' },
			{ status: 403 }
		)
	}

	const pathCharacterId = extractCharacterIdFromEsiPath(pathWithVersionPrefix)
	if (pathCharacterId && pathCharacterId !== explicitCharacterId) {
		return Response.json(
			{
				error: 'forbidden',
				message: 'Character-scoped ESI path does not match the selected linked character context',
			},
			{ status: 403 }
		)
	}

	if (!isReadMethod(method) && !isAllowedWritePath(method, pathWithVersionPrefix)) {
		return Response.json(
			{ error: 'forbidden', message: 'Write endpoint is not in the allowlist' },
			{ status: 403 }
		)
	}

	const tokenStore = getStub<EveTokenStoreClient>(env.EVE_TOKEN_STORE, 'default')
	const accessToken = await tokenStore.getAccessToken(explicitCharacterId)
	if (!accessToken) {
		return Response.json(
			{ error: 'unauthorized', message: 'No valid ESI token for selected character' },
			{ status: 401 }
		)
	}

	const query = new URLSearchParams(url.searchParams)
	query.delete('character_id')
	const upstreamRequestPath = `${pathWithVersionPrefix}${query.toString() ? `?${query.toString()}` : ''}`

	return proxyEsiRequest({
		env,
		request,
		path: upstreamRequestPath,
		clientId: grantProps.clientId,
		characterId: explicitCharacterId,
		accessToken,
		cacheScope: { scope: 'character', scopeId: explicitCharacterId },
	})
}

export const THIRD_PARTY_APPS_OAUTH_PROVIDER_OPTIONS = {
	...THIRD_PARTY_APPS_OAUTH_PROVIDER_BASE_OPTIONS,
	apiHandler: OAuthApiHandler,
	defaultHandler: THIRD_PARTY_APPS_OAUTH_PROVIDER_BASE_OPTIONS.defaultHandler,
}
