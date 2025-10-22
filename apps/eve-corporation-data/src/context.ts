import type { HonoApp } from '@repo/hono-helpers'
import type { SharedHonoEnv, SharedHonoVariables } from '@repo/hono-helpers/src/types'

export type Env = SharedHonoEnv & {
	DATABASE_URL: string
	EVE_CORPORATION_DATA: DurableObjectNamespace
	EVE_TOKEN_STORE: DurableObjectNamespace

	// Queue bindings
	'corp-public-refresh': Queue<unknown>
	'corp-members-refresh': Queue<unknown>
	'corp-member-tracking-refresh': Queue<unknown>
	'corp-wallets-refresh': Queue<unknown>
	'corp-wallet-journal-refresh': Queue<unknown>
	'corp-wallet-transactions-refresh': Queue<unknown>
	'corp-assets-refresh': Queue<unknown>
	'corp-structures-refresh': Queue<unknown>
	'corp-orders-refresh': Queue<unknown>
	'corp-contracts-refresh': Queue<unknown>
	'corp-industry-jobs-refresh': Queue<unknown>
	'corp-killmails-refresh': Queue<unknown>
}

/** Variables can be extended */
export type Variables = SharedHonoVariables & {
	db?: ReturnType<typeof import('./db').createDb>
}

export interface App extends HonoApp {
	Bindings: Env
	Variables: Variables
}
