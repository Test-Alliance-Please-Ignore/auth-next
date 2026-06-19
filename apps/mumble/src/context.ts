import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	/** Base URL of the murmur-control API, e.g. https://murmur-control.example.com */
	MURMUR_CONTROL_API_URL: string
	/** Optional mTLS certificate binding used for outbound murmur-control requests. */
	MURMUR_CONTROL_MTLS?: Fetcher | null
	/** Optional bearer token for murmur-control (wrangler secret). */
	MURMUR_CONTROL_TOKEN?: string | null
	MUMBLE: DurableObjectNamespace
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
