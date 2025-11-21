 // Corrected import path
import type { createDbClient } from '@repo/db-utils'
import type { createDb } from '../db'
import type * as coreSchema from '../../../core/src/db/schema'
import type { Env } from '../context'
import type { GroupsDOCache } from './groups-do-cache'

export interface ServiceContext {
	db: ReturnType<typeof createDb>
	coreDb: ReturnType<typeof createDbClient<typeof coreSchema>>
	env: Env
	state: DurableObjectState
	groupsDOCache: GroupsDOCache
}