import { retrieveData, storeOrReturn, type StepResult } from '../../utils/storage'
import { enrichNotifications } from '../../processors/helpers/notifications'
import type { NotificationFetchResult } from './fetch-notifications'

export async function processNotifications(
    env: {
        ESI_TYPE_RESOLVER: DurableObjectNamespace
        ESI: DurableObjectNamespace
    },
    getBucket: (name: string) => R2Bucket,
    bucket: R2Bucket,
    bucketName: string,
    fetchResult: StepResult,
    workflowInstanceId: string,
    characterId: string,
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

        console.log('[processNotifications] Starting enrichment', {
            count: notifications.length,
        })

        const enrichedData = await enrichNotifications(env, notifications, characterId)

        console.log('[processNotifications] Enrichment complete', {
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
