import { getEsiInstanceForCharacter } from '@repo/esi'

import { storeOrReturn } from '../../utils/storage'
import { retryWithBackoff } from '../../utils/retry'

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
    characterId: string,
): Promise<NotificationFetchResult> {
    const stub = getEsiInstanceForCharacter(esiBinding, characterId)
    stub.setDefaultCacheMode('no-store')

    const notifications = await retryWithBackoff(
        async () => await stub.fetchCharacterNotifications(characterId),
        { maxRetries: 3, initialDelayMs: 500, maxDelayMs: 5000 },
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
    workflowInstanceId: string,
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
