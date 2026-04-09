/**
 * Process and enrich character clones data
 * Resolves implant type IDs and location IDs to human-readable names
 */

import type { CharacterClones, CharacterImplants } from '@repo/esi'

import { retrieveData, storeOrReturn } from '../../utils/storage'
import { enrichClones } from '../../processors/helpers/clones'

import type { StepResult } from '../../utils/storage'

/**
 * Process character clones by enriching with resolved names
 */
export async function processClones(
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

        const { clones, implants } = data as {
            clones: CharacterClones
            implants: CharacterImplants
        }

        if (!clones || !Array.isArray(clones.jump_clones)) {
            return {
                source: 'none',
                success: false,
                error: 'Invalid clones data structure',
            }
        }

        const enrichedData = await enrichClones(env, clones, implants ?? [], characterId)

        return await storeOrReturn(
            bucket,
            bucketName,
            workflowInstanceId,
            'process-clones',
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
