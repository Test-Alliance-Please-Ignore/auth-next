import type { StructureActor } from '@repo/structures'

export type SessionUser = StructureActor

export type Env = {
	DATABASE_URL: string
	EVE_CORPORATION_DATA: DurableObjectNamespace
	UNIVERSE: DurableObjectNamespace
	NAME: string
	ENVIRONMENT: string
	SENTRY_RELEASE: string
}
