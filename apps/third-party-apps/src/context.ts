import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import type { CoreWorker } from '@repo/admin'
import type { Groups } from '@repo/groups'
import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	EVE_SSO_CLIENT_ID: string
	CORE: CoreWorker
	GROUPS: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace
	ESI_RATE_LIMITS: KVNamespace
	ESI_PROXY_CACHE: KVNamespace
	THIRD_PARTY_APP_QUOTA: DurableObjectNamespace
	OAUTH_KV: KVNamespace
	OAUTH_PROVIDER: OAuthHelpers
}

export interface SessionCharacter {
	id: string
	characterOwnerHash: string
	characterId: string
	characterName: string
	isPrimary: boolean
	hasValidToken: boolean
}

export interface SessionUser {
	id: string
	mainCharacterId: string
	isAdmin: boolean
	characters: SessionCharacter[]
}

export type Variables = SharedHonoVariables & {
	user?: SessionUser
	eveTokenStore?: EveTokenStoreClient
	groups?: Groups
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}

export interface EveTokenStoreClient {
	getAccessToken(characterId: string): Promise<string | null>
}
