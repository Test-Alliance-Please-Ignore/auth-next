import { Env } from '../context'
import { DbClient } from '../db'
import * as schema from '../db/schema'

export interface ServiceContext {
	db: DbClient<typeof schema>
	env: Env
}
