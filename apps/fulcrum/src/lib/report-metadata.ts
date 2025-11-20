import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { Esi, EsiTypeResolver } from '@repo/esi'
import type { WebhookMetadata } from './discord-webhook'
import type { Env } from '../context'

/**
 * Resolve all metadata needed for webhook notifications
 */
export async function resolveReportMetadata(
	env: Env,
	reportId: string,
	requestorUserId: string,
	subjectCharacterId: string,
	subjectCharacterName: string | null,
	requestorCorporationId: string
): Promise<WebhookMetadata | null> {
	try {
		// 1. Get requestor's main character name from CORE service
		const requestorMainCharacterName = await env.CORE.getUserMainCharacterName(requestorUserId)

		if (!requestorMainCharacterName) {
			logger.warn('[Report Metadata] Failed to resolve requestor main character name', {
				reportId,
				requestorUserId,
			})
			return null
		}

		// 2. Get subject character name - use EsiTypeResolver if not provided
		let resolvedSubjectCharacterName = subjectCharacterName

		if (!resolvedSubjectCharacterName) {
			try {
				const typeResolverStub = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
				const nameMap = await typeResolverStub.resolveIds([subjectCharacterId])
				resolvedSubjectCharacterName = nameMap[subjectCharacterId] ?? `Character ${subjectCharacterId}`
			} catch (error) {
				logger.warn('[Report Metadata] Failed to resolve subject character name', {
					reportId,
					subjectCharacterId,
					error: error instanceof Error ? error.message : String(error),
				})
				resolvedSubjectCharacterName = `Character ${subjectCharacterId}`
			}
		}

		// 3. Get corporation ticker from ESI
		let corporationTicker = `Corp ${requestorCorporationId}`

		try {
			const esiStub = getStub<Esi>(env.ESI, requestorCorporationId)
			const corpInfo = await esiStub.fetchCorporationPublicInfo(requestorCorporationId)

			if (corpInfo?.ticker) {
				corporationTicker = corpInfo.ticker
			}
		} catch (error) {
			logger.warn('[Report Metadata] Failed to resolve corporation ticker', {
				reportId,
				requestorCorporationId,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		return {
			reportId,
			requestorMainCharacterName,
			subjectCharacterName: resolvedSubjectCharacterName,
			subjectCharacterId,
			corporationTicker,
		}
	} catch (error) {
		logger.error('[Report Metadata] Failed to resolve metadata', {
			reportId,
			error: error instanceof Error ? error.message : String(error),
		})
		return null
	}
}
