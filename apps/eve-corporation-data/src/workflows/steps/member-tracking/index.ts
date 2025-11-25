import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export type MemberTrackingData = Awaited<ReturnType<typeof esiFetch.fetchMemberTracking>>

export async function fetchMemberTracking(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<MemberTrackingData> {
	const tokenStore = createTokenStore(env)
	const trackingData = await esiFetch.fetchMemberTracking(tokenStore, corporationId, directorCharacterId)

	logger.debug('[MemberTrackingStep] Fetched member tracking', {
		corporationId,
		count: trackingData.length,
	})

	return trackingData
}

export async function storeMemberTracking(
	env: Env,
	corporationId: string,
	memberTracking: MemberTrackingData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeMemberTracking(corporationId, memberTracking)

	logger.info('[MemberTrackingStep] Stored tracking data', {
		corporationId,
		count: memberTracking.length,
	})
}

