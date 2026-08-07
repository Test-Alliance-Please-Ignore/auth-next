import type { DbClient } from '@repo/db-utils'
import type { Env } from '../context'
import type * as schema from '../db/schema'

export interface ServiceContext {
	db: DbClient<typeof schema>
	env: Env
}
