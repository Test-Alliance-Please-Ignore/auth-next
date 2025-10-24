import type { CoreWorker as ICoreWorker } from '@repo/admin'

/**
 * Admin worker context types
 */

/**
 * Environment bindings for admin worker
 */
export type Env = {
	/** Neon PostgreSQL database connection string */
	DATABASE_URL: string

	/** EVE Token Store Durable Object namespace */
	EVE_TOKEN_STORE: DurableObjectNamespace

	/** EVE Character Data Durable Object namespace */
	EVE_CHARACTER_DATA: DurableObjectNamespace

	/** Core worker service binding (RPC) */
	CORE: ICoreWorker

	/** Worker name (from wrangler vars) */
	NAME: string

	/** Environment (production/development) */
	ENVIRONMENT: string

	/** Sentry release version */
	SENTRY_RELEASE: string
}
