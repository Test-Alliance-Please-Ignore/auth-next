import { getEsiInstanceForCharacter } from '@repo/esi'

import { retryWithBackoff } from '../../utils/retry'
import { storeOrReturn } from '../../utils/storage'

import type { CharacterNotification } from '@repo/esi'
import type { StepResult } from '../../utils/storage'

export interface NotificationFetchResult {
	notifications: CharacterNotification[]
}

/**
 * Fetch character notifications from ESI.
 * ESI returns up to 500 notifications, no pagination needed.
 */
export async function fetchNotificationsFromEsi(
	esiBinding: DurableObjectNamespace,
	characterId: string
): Promise<NotificationFetchResult> {
	const stub = getEsiInstanceForCharacter(esiBinding, characterId)
	const notifications = await retryWithBackoff(
		async () => await stub.fetchCharacterNotifications(characterId, { cacheMode: 'no-store' }),
		{ maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000 }
	)

	return { notifications }
}

/**
 * Fetch character notifications from ESI and store in R2
 */
export async function fetchNotifications(
	esiBinding: DurableObjectNamespace,
	bucket: R2Bucket,
	bucketName: string,
	characterId: string,
	workflowInstanceId: string
): Promise<StepResult> {
	try {
		const data = await fetchNotificationsFromEsi(esiBinding, characterId)
		return await storeOrReturn(bucket, bucketName, workflowInstanceId, 'fetch-notifications', data)
	} catch (error) {
		return {
			source: 'none',
			success: false,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}
