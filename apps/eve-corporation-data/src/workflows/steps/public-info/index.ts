import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { getCorporationDataStub, getPublicEsi } from '../../utils/services'

import type { Env } from '../../../context'

export type PublicInfo = Awaited<ReturnType<typeof esiFetch.fetchPublicInfo>>

export async function fetchPublicInfo(env: Env, corporationId: string): Promise<PublicInfo> {
	const info = await esiFetch.fetchPublicInfo(getPublicEsi(env), corporationId)

	logger.debug('[PublicInfoStep] Fetched public info', {
		corporationId,
		name: info.name,
	})

	return info
}

export async function storePublicInfo(
	env: Env,
	corporationId: string,
	publicInfo: PublicInfo
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storePublicInfo(corporationId, publicInfo)

	logger.debug('[PublicInfoStep] Stored public info', { corporationId })
}
