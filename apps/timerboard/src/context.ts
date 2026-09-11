import type { HonoApp, SharedHonoEnv } from '@repo/hono-helpers'
import type { StructuresWorker } from '@repo/structures'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	GROUPS: DurableObjectNamespace
	STRUCTURES: StructuresWorker
}

export interface App extends HonoApp {
	Bindings: Env
}
