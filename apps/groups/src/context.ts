import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

import type { GroupStore } from './group-store'

export type Env = SharedHonoEnv & {
	GROUP_STORE: DurableObjectNamespace<GroupStore>
	SOCIAL_AUTH: Fetcher
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
