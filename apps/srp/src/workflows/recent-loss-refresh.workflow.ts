import {
	WorkflowEntrypoint,
	type WorkflowEvent,
	type WorkflowStep,
	type WorkflowStepConfig,
} from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'

import type { EveTokenStore } from '@repo/eve-token-store'
import type {
	RecentLossRefreshCharacterFailure,
	RecentLossRefreshCharacterInput,
	RecentLossRefreshCoordinator,
	RecentLossRefreshStatusRecord,
	Srp,
} from '@repo/srp'
import type { Env } from '../context'

export interface SrpRecentLossRefreshWorkflowParams {
	userId: string
	workflowInstanceId: string
	characters: RecentLossRefreshCharacterInput[]
	maxLossAgeDays: number
}

const CHARACTER_STEP_OPTIONS = {
	retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' as const },
	timeout: '5 minutes' as const,
} satisfies WorkflowStepConfig
const STATUS_STEP_OPTIONS = {
	retries: { limit: 2, delay: '2 seconds', backoff: 'exponential' as const },
	timeout: '30 seconds' as const,
} satisfies WorkflowStepConfig
const TOKEN_STEP_OPTIONS = {
	retries: { limit: 2, delay: '3 seconds', backoff: 'exponential' as const },
	timeout: '1 minute' as const,
} satisfies WorkflowStepConfig
const CHARACTER_BATCH_CONCURRENCY = 4

function buildFailure(
	character: RecentLossRefreshCharacterInput,
	reason: RecentLossRefreshCharacterFailure['reason'],
	message: string,
	error?: unknown
): RecentLossRefreshCharacterFailure {
	return {
		characterId: character.characterId,
		characterName: character.characterName,
		reason,
		message,
		error: error instanceof Error ? error.message : error ? String(error) : undefined,
	}
}

export class SrpRecentLossRefreshWorkflow extends WorkflowEntrypoint<
	Env,
	SrpRecentLossRefreshWorkflowParams
> {
	async run(event: WorkflowEvent<SrpRecentLossRefreshWorkflowParams>, step: WorkflowStep) {
		const { userId, workflowInstanceId, characters, maxLossAgeDays } = event.payload
		const coordinator = getStub<RecentLossRefreshCoordinator>(
			this.env.SRP_RECENT_LOSS_REFRESH_COORDINATOR,
			userId
		)
		const srpStub = getStub<Pick<Srp, 'refreshRecentLossesForCharacter'>>(this.env.SRP, 'default')
		const tokenStore = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const startedAt = new Date().toISOString()
		const failures: RecentLossRefreshCharacterFailure[] = []
		let processedCharacters = 0
		let successfulCharacters = 0
		let failedCharacters = 0

		const refreshCharacter = async (
			character: RecentLossRefreshCharacterInput
		): Promise<{
			characterId: string
			characterName: string
			success: boolean
			failure?: RecentLossRefreshCharacterFailure
		}> => {
			const tokenValidation = await step.do(
				`validate-token-${character.characterId}`,
				TOKEN_STEP_OPTIONS,
				async () =>
					tokenStore.validateToken(character.characterId, ['esi-killmails.read_killmails.v1'])
			)

			if (!tokenValidation.isValid) {
				return {
					characterId: character.characterId,
					characterName: character.characterName,
					success: false,
					failure: buildFailure(
						character,
						'invalid_token',
						'ESI token is invalid or expired. Please re-authenticate this character.'
					),
				}
			}

			try {
				await step.do(
					`refresh-character-${character.characterId}`,
					CHARACTER_STEP_OPTIONS,
					async () =>
						srpStub.refreshRecentLossesForCharacter(
							userId,
							character.characterId,
							character.characterName,
							maxLossAgeDays
						)
				)
				return {
					characterId: character.characterId,
					characterName: character.characterName,
					success: true,
				}
			} catch (error) {
				return {
					characterId: character.characterId,
					characterName: character.characterName,
					success: false,
					failure: buildFailure(
						character,
						'fetch_failed',
						'Could not refresh recent losses right now.',
						error
					),
				}
			}
		}

		try {
			const currentStatus = await coordinator.getRecentLossRefreshStatus(userId)
			if (!currentStatus.status || currentStatus.status.workflowInstanceId !== workflowInstanceId) {
				throw new Error('Recent loss refresh status missing or mismatched')
			}

			const runningStatus: RecentLossRefreshStatusRecord = {
				...currentStatus.status,
				status: 'running',
				startedAt: currentStatus.status.startedAt ?? startedAt,
				updatedAt: startedAt,
				currentCharacterId: undefined,
				currentCharacterName: undefined,
				lastError: undefined,
			}

			await step.do('mark-running', STATUS_STEP_OPTIONS, async () => {
				await coordinator.updateRecentLossRefreshStatus(userId, runningStatus)
			})

			for (let batchStart = 0; batchStart < characters.length; batchStart += CHARACTER_BATCH_CONCURRENCY) {
				const batch = characters.slice(batchStart, batchStart + CHARACTER_BATCH_CONCURRENCY)
				const batchResults = await Promise.all(batch.map((character) => refreshCharacter(character)))

				for (const result of batchResults) {
					processedCharacters++
					if (result.success) {
						successfulCharacters++
						continue
					}
					if (result.failure) {
						failures.push(result.failure)
						failedCharacters++
					}
				}

				const lastCharacter = batch[batch.length - 1]
				const updatedStatus: RecentLossRefreshStatusRecord = {
					...runningStatus,
					processedCharacters,
					successfulCharacters,
					failedCharacters,
					updatedAt: new Date().toISOString(),
					currentCharacterId:
						processedCharacters < characters.length ? lastCharacter?.characterId : undefined,
					currentCharacterName:
						processedCharacters < characters.length ? lastCharacter?.characterName : undefined,
					failures: failures.slice(),
					lastError: failures[failures.length - 1]?.message,
				}
				await step.do(`update-status-batch-${batchStart}`, STATUS_STEP_OPTIONS, async () =>
					coordinator.updateRecentLossRefreshStatus(userId, updatedStatus)
				)
			}

			const completedAt = new Date().toISOString()
			const completedStatus: RecentLossRefreshStatusRecord = {
				...runningStatus,
				status: 'completed',
				processedCharacters,
				successfulCharacters,
				failedCharacters,
				completedAt,
				updatedAt: completedAt,
				currentCharacterId: undefined,
				currentCharacterName: undefined,
				failures: failures.slice(),
				lastError: failures[failures.length - 1]?.message,
			}

			await step.do('mark-completed', STATUS_STEP_OPTIONS, async () => {
				await coordinator.updateRecentLossRefreshStatus(userId, completedStatus)
			})

			return {
				workflowInstanceId,
				userId,
				totalCharacters: characters.length,
				processedCharacters,
				successfulCharacters,
				failedCharacters,
			}
		} catch (error) {
			const failedAt = new Date().toISOString()
			const currentStatus = await coordinator.getRecentLossRefreshStatus(userId).catch(() => null)
			if (currentStatus?.status && currentStatus.status.workflowInstanceId === workflowInstanceId) {
				const failedStatus: RecentLossRefreshStatusRecord = {
					...currentStatus.status,
					status: 'failed',
					updatedAt: failedAt,
					completedAt: failedAt,
					lastError: error instanceof Error ? error.message : String(error),
				}
				await step.do('mark-failed', STATUS_STEP_OPTIONS, async () => {
					await coordinator.updateRecentLossRefreshStatus(userId, failedStatus)
				})
			}
			throw error
		}
	}
}
