import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichNotifications } from '../../processors/helpers/notifications'
import type { CharacterAffiliationCoordinator } from '../../processors/helpers/character-affiliation'
import type { EntityLinkCoordinator } from '../../processors/helpers/entity-links'
import type { CoreBinding } from '../../../types/core-binding'
import type { NotificationFetchResult } from './fetch-notifications'
import { logger } from '@repo/hono-helpers'

export async function processNotifications(
    env: {
        ESI_TYPE_RESOLVER: DurableObjectNamespace
        ESI: DurableObjectNamespace
        EVE_TOKEN_STORE: DurableObjectNamespace
        CORE: CoreBinding
    },
    getBucket: (name: string) => R2Bucket,
    bucket: R2Bucket,
    bucketName: string,
    fetchResult: StepResult,
    workflowInstanceId: string,
    characterId: string,
    affiliationCoordinator?: CharacterAffiliationCoordinator,
    entityLinkCoordinator?: EntityLinkCoordinator,
): Promise<StepResult> {
    try {
        if (!fetchResult.success) {
            return {
                source: 'none',
                success: false,
                error: 'Fetch failed: ' + (fetchResult as any).error,
            }
        }

        const data = await retrieveData(getBucket, fetchResult)
        if (!data) {
            return {
                source: 'none',
                success: false,
                error: 'No data retrieved from fetch step',
            }
        }

        const fetchData = data as NotificationFetchResult
        const { notifications } = fetchData

        logger.log('[processNotifications] Starting enrichment', {
            count: notifications.length,
        })

        const enrichedData = await enrichNotifications(
            env,
            notifications,
            characterId,
            affiliationCoordinator,
            entityLinkCoordinator,
        )

        logger.log('[processNotifications] Enrichment complete', {
            count: enrichedData.notifications.length,
            types: enrichedData.types.length,
        })

        return await storeOrReturn(
            bucket,
            bucketName,
            workflowInstanceId,
            'process-notifications',
            enrichedData,
        )
    } catch (error) {
        return {
            source: 'none',
            success: false,
            error: error instanceof Error ? error.message : String(error),
        }
    }
}
