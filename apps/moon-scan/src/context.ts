import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'
import type { MoonScanDO } from '@repo/moon-scan'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	MOON_SCAN: DurableObjectNamespace<MoonScanDO>
}

export type Variables = SharedHonoVariables

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
