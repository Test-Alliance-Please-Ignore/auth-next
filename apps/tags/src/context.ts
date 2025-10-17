import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

import type { TagStore } from './tag-store'

export type Env = SharedHonoEnv & {
	TAG_STORE: DurableObjectNamespace<TagStore>
	SOCIAL_AUTH: Fetcher
	ESI: Fetcher
	ADMIN_API_TOKENS: string
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	sessionUserId?: string
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
