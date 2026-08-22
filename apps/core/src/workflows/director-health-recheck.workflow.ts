import { WorkflowEntrypoint } from 'cloudflare:workers'

import { and, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import { managedCorporations } from '../db/schema'
import { recheckDirectorHealthForCorporation } from '../services/director-health-recheck.service'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from '../context'

export interface DirectorHealthRecheckWorkflowParams {
	characterId: string
	characterName: string
	corporationId: string
	source: string
}

interface ManagedCorporationSummary {
	corporationId: string
	name: string
}

interface CorporationRecheckResult {
	corporationId: string
	matched: boolean
	verified: boolean
	healthyDirectorCount?: number
	error?: string
}

const CORPORATION_STEP_OPTIONS = {
	retries: { limit: 2, delay: '3 seconds' as const, backoff: 'exponential' as const },
	timeout: '1 minute' as const,
}

export class DirectorHealthRecheckWorkflow extends WorkflowEntrypoint<
	Env,
	DirectorHealthRecheckWorkflowParams
> {
	private async recheckCorporation(
		step: WorkflowStep,
		corporation: ManagedCorporationSummary,
		characterId: string
	): Promise<CorporationRecheckResult> {
		return step.do(`recheck-${corporation.corporationId}`, CORPORATION_STEP_OPTIONS, async () => {
			const result = await recheckDirectorHealthForCorporation({
				characterId,
				corporationId: corporation.corporationId,
				getCorporationStub: (corporationId) =>
					getStub<EveCorporationData>(this.env.EVE_CORPORATION_DATA, corporationId),
				updateManagedCorporationHealth: async ({ corporationId, healthyDirectorCount }) => {
					const db = createDb(this.env.DATABASE_URL)
					await db
						.update(managedCorporations)
						.set({
							healthyDirectorCount,
							isVerified: healthyDirectorCount > 0,
							lastVerified: new Date(),
							updatedAt: new Date(),
						})
						.where(eq(managedCorporations.corporationId, corporationId))
				},
			})
			return {
				corporationId: corporation.corporationId,
				...result,
			}
		})
	}

	async run(
		event: WorkflowEvent<DirectorHealthRecheckWorkflowParams>,
		step: WorkflowStep
	): Promise<{ status: 'completed'; characterId: string; results: CorporationRecheckResult[] }> {
		const { characterId, characterName, corporationId, source } = event.payload
		const workflowInstanceId = event.instanceId
		const corporations = await step.do('load-active-corporation', async () =>
			createDb(this.env.DATABASE_URL).query.managedCorporations.findMany({
				where: and(
					eq(managedCorporations.corporationId, corporationId),
					eq(managedCorporations.isActive, true)
				),
				columns: { corporationId: true, name: true },
			})
		)

		logger.info('[DirectorHealthRecheckWorkflow] Starting', {
			workflowInstanceId,
			characterId,
			corporationId,
			characterName,
			source,
			corporationCount: corporations.length,
		})

		const results: CorporationRecheckResult[] = []
		for (const corporation of corporations) {
			try {
				results.push(await this.recheckCorporation(step, corporation, characterId))
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				logger.error('[DirectorHealthRecheckWorkflow] Corporation recheck failed', {
					workflowInstanceId,
					characterId,
					corporationId: corporation.corporationId,
					error: message,
				})
				results.push({
					corporationId: corporation.corporationId,
					matched: false,
					verified: false,
					error: message,
				})
			}
		}

		logger.info('[DirectorHealthRecheckWorkflow] Completed', {
			workflowInstanceId,
			characterId,
			matchedCorporationCount: results.filter((result) => result.matched).length,
			verifiedCorporationCount: results.filter((result) => result.verified).length,
			failedCorporationCount: results.filter((result) => result.error).length,
		})

		return { status: 'completed', characterId, results }
	}
}
