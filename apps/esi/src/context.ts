import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

import type { UserTokenStore } from './user-token-store'

// Service binding types - importing from the social-auth worker
type SocialAuthService = {
	USER_SESSION_STORE: DurableObjectNamespace
}

export type Env = SharedHonoEnv & {
	ESI_CACHE: KVNamespace
	USER_TOKEN_STORE: DurableObjectNamespace<UserTokenStore>
	ESI_SSO_CLIENT_ID: string
	ESI_SSO_CLIENT_SECRET: string
	ESI_SSO_CALLBACK_URL: string
	ADMIN_API_TOKENS: string
	SOCIAL_AUTH: Service<SocialAuthService>
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
