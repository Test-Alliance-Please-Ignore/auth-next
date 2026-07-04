import { WorkerEntrypoint } from 'cloudflare:workers'

import type {
	OAuthAuthorizationAction,
	OAuthAuthorizationPreview,
	OAuthAuthorizationResult,
	OAuthClientCreateInput,
	OAuthClientListOptions,
	OAuthClientListResult,
	OAuthClientSecretResult,
	OAuthClientSummary,
	OAuthClientUpdateInput,
	OAuthSessionUser,
	ThirdPartyAppsAdminWorker,
} from '@repo/admin'

import type { Env } from './context'
import {
	OAUTH_INTERNAL_AUTHORIZE_PREVIEW_PATH,
	OAUTH_INTERNAL_AUTHORIZE_RESOLVE_PATH,
} from './oauth-routes'
import { handleThirdPartyAppsHttpRequest } from './http-handler'
import {
	createOAuthClient,
	deleteOAuthClient,
	listOAuthClients,
	regenerateOAuthClientSecret,
	updateOAuthClient,
} from './services/admin-clients.service'

export class ThirdPartyAppsWorkerEntrypoint extends WorkerEntrypoint<Env> implements ThirdPartyAppsAdminWorker {
	async listClients(options?: OAuthClientListOptions): Promise<OAuthClientListResult> {
		return await listOAuthClients(this.env, options)
	}

	async createClient(input: OAuthClientCreateInput): Promise<OAuthClientSummary> {
		return await createOAuthClient(this.env, input)
	}

	async updateClient(
		clientId: string,
		input: OAuthClientUpdateInput
	): Promise<OAuthClientSummary | null> {
		return await updateOAuthClient(this.env, clientId, input)
	}

	async deleteClient(clientId: string): Promise<void> {
		await deleteOAuthClient(this.env, clientId)
	}

	async regenerateClientSecret(clientId: string): Promise<OAuthClientSecretResult | null> {
		return await regenerateOAuthClientSecret(this.env, clientId)
	}

	async previewAuthorization(
		requestUrl: string,
		expectedOrigin: string
	): Promise<OAuthAuthorizationPreview | null> {
		const response = await this.fetch(
			new Request(`http://third-party-apps.internal${OAUTH_INTERNAL_AUTHORIZE_PREVIEW_PATH}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ requestUrl, expectedOrigin }),
			})
		)
		if (!response.ok) {
			return null
		}
		return (await response.json().catch(() => null)) as OAuthAuthorizationPreview | null
	}

	async resolveAuthorization(
		requestUrl: string,
		expectedOrigin: string,
		user: OAuthSessionUser,
		action: OAuthAuthorizationAction
	): Promise<OAuthAuthorizationResult | null> {
		const response = await this.fetch(
			new Request(`http://third-party-apps.internal${OAUTH_INTERNAL_AUTHORIZE_RESOLVE_PATH}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ requestUrl, expectedOrigin, user, action }),
			})
		)
		if (!response.ok) {
			return null
		}
		return (await response.json().catch(() => null)) as OAuthAuthorizationResult | null
	}

	override async fetch(request: Request): Promise<Response> {
		const oauthResponse = await handleThirdPartyAppsHttpRequest(request, this.env, this.ctx)
		if (oauthResponse) {
			return oauthResponse
		}

		return new Response('Third-Party Apps RPC only, not accessible via HTTP', {
			status: 404,
			headers: { 'Content-Type': 'text/plain' },
		})
	}
}
