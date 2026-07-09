import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	/**
	 * Verified Email Routing destination that receives mail when inbound processing fails.
	 * Optional — if unset, the last resort for an internal failure is a permanent reject.
	 */
	FALLBACK_FORWARD_ADDRESS?: string
	/**
	 * Example config: verified destination for the `team@` alias. Unset ⇒ the alias route
	 * falls through to the no-match policy (nothing is forwarded).
	 */
	FORWARD_TEAM_TO?: string
}

/** Variables can be extended per-request as needed. */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
