import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export type ContractsData = Awaited<ReturnType<typeof esiFetch.fetchContracts>>

export async function fetchContracts(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<ContractsData> {
	const tokenStore = createTokenStore(env)
	const contracts = await esiFetch.fetchContracts(tokenStore, corporationId, directorCharacterId)

	logger.debug('[ContractsStep] Fetched contracts', {
		corporationId,
		count: contracts.length,
	})

	return contracts
}

export async function storeContracts(
	env: Env,
	corporationId: string,
	contracts: ContractsData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeContracts(corporationId, contracts)

	logger.info('[ContractsStep] Stored contracts', {
		corporationId,
		count: contracts.length,
	})
}

