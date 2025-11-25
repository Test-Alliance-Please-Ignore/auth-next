import { logger } from '@repo/hono-helpers'

import * as esiFetch from '../../../services/esi-fetch'
import { createTokenStore, getCorporationDataStub } from '../../utils/services'

import type { Env } from '../../../context'

export type IndustryJobsData = Awaited<ReturnType<typeof esiFetch.fetchIndustryJobs>>

export async function fetchIndustryJobs(
	env: Env,
	corporationId: string,
	directorCharacterId: string
): Promise<IndustryJobsData> {
	const tokenStore = createTokenStore(env)
	const jobs = await esiFetch.fetchIndustryJobs(tokenStore, corporationId, directorCharacterId)

	logger.debug('[IndustryJobsStep] Fetched industry jobs', {
		corporationId,
		count: jobs.length,
	})

	return jobs
}

export async function storeIndustryJobs(
	env: Env,
	corporationId: string,
	industryJobs: IndustryJobsData
): Promise<void> {
	const corpData = getCorporationDataStub(env, corporationId)
	await corpData.storeIndustryJobs(corporationId, industryJobs)

	logger.info('[IndustryJobsStep] Stored industry jobs', {
		corporationId,
		count: industryJobs.length,
	})
}

