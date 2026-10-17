import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { MumbleDeleteIntent, MumbleDeleteRetryDecision } from '@repo/mumble'

export type Env = SharedHonoEnv & {
	/** Base URL of the murmur-control API, e.g. https://murmur-control.example.com */
	MURMUR_CONTROL_API_URL: string
	/** Optional mTLS certificate binding used for outbound murmur-control requests. */
	MURMUR_CONTROL_MTLS?: Fetcher | null
	/** Optional bearer token for murmur-control (wrangler secret). */
	MURMUR_CONTROL_TOKEN?: string | null
	/** Enable projection-only repair after the control API's identity checks are deployed. */
	MUMBLE_CONTROL_SAFE_PROJECTION_DELETE?: string
	MUMBLE: DurableObjectNamespace
	CORE: {
		decideMumbleDeleteRetry(
			serverId: string,
			subjectId: string,
			intent: MumbleDeleteIntent
		): Promise<MumbleDeleteRetryDecision>
	}
}

/** Variables can be extended */
export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
