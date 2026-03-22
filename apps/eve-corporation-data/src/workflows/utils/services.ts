import { getStub } from '@repo/do-utils'

import { createDb } from '../../db'
import { DirectorManager } from '../../services/director-manager'

import type { CorporationTax } from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { Env } from '../../context'

/**
 * Create a token store stub (shared across steps)
 */
export function createTokenStore(env: Env): EveTokenStore {
	return getStub<EveTokenStore>(env.EVE_TOKEN_STORE, 'default')
}

/**
 * Create a DirectorManager instance for a specific corporation
 */
export function createDirectorManager(env: Env, corporationId: string): DirectorManager {
	const db = createDb(env.DATABASE_URL)
	const tokenStore = createTokenStore(env)
	return new DirectorManager(db, corporationId, tokenStore)
}

/**
 * Get a corporation-specific data Durable Object stub
 */
export function getCorporationDataStub(env: Env, corporationId: string): EveCorporationData {
	return getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, corporationId)
}

/**
 * Get the shared data Durable Object stub (used for timestamp updates)
 */
export function getGlobalCorporationDataStub(env: Env): EveCorporationData {
	return getStub<EveCorporationData>(env.EVE_CORPORATION_DATA, 'default')
}

/**
 * Get the global corporation-tax Durable Object stub.
 */
export function getCorporationTaxStub(env: Env): CorporationTax {
	return getStub<CorporationTax>(env.CORPORATION_TAX, 'default')
}
