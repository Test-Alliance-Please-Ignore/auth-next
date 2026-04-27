import { DEFAULT_RETENTION_DAYS, RETENTION_POLICIES } from '@repo/fulcrum'
import { logger } from '@repo/hono-helpers'

import { createDb } from '../db'
import * as queries from '../db/queries'
import {
	sendBatchReportFinishedDM,
	sendBatchReportStartedDM,
} from '../lib/discord-webhook'
import { resolveBatchReportMetadata } from '../lib/report-metadata'

import type { ReportRequestSource } from '@repo/fulcrum'

export interface BulkCharacterReportWorkflowParams {
	characterIds: string[]
	requestorUserId: string
	requestorCorporationId: string
	requestSource: ReportRequestSource
	applicationId?: string
	sendDm?: boolean
	targetUserId?: string
}

type ChildReportRef = {
	characterId: string
	reportId: string
	workflowInstanceId?: string | null
}

const STEP = {
	timeout: '2 hours',
}

const ACTIVE_WORKFLOW_STATUSES = new Set([
	'queued',
	'running',
	'waiting',
	'waitingForPause',
	'paused',
])

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

type StepDo = <T>(name: string, config: unknown, fn: () => Promise<T>) => Promise<T>

type CharacterWorkflowBinding = {
	create: (input: { id: string; params: { reportId: string; characterId: string; targetUserId?: string; sendDm: boolean } }) => Promise<{ id: string }>
	get: (id: string) => Promise<{ status: () => Promise<{ status: string }> }>
}

type RunnerEnv = {
	DATABASE_URL: string
	CHARACTER_REPORT_WORKFLOW: CharacterWorkflowBinding
} & Record<string, unknown>

export async function runBulkCharacterReportWorkflow(
	env: RunnerEnv,
	stepDo: StepDo,
	batchId: string,
	payload: BulkCharacterReportWorkflowParams,
) {
	const {
		characterIds,
		requestorUserId,
		requestorCorporationId,
		requestSource,
		applicationId,
		sendDm = true,
		targetUserId,
	} = payload
	const workflowLogger = logger.withTags({ component: 'bulk-character-report-workflow', batchId })
	const db = createDb(env.DATABASE_URL)

	const dedupedCharacterIds = [...new Set(characterIds.map((id) => id.trim()).filter(Boolean))]
	if (dedupedCharacterIds.length === 0) {
		throw new Error('Bulk character report workflow requires at least one character id')
	}

	if (sendDm) {
		await stepDo('send-batch-started-dm', STEP, async () => {
			const metadata = await resolveBatchReportMetadata(
				env as any,
				requestorUserId,
				requestorCorporationId,
				targetUserId,
			)
			if (!metadata) return
			await sendBatchReportStartedDM(env as any, requestorUserId, {
				batchId,
				requestorMainCharacterName: metadata.requestorMainCharacterName,
				corporationTicker: metadata.corporationTicker,
				totalCharacters: dedupedCharacterIds.length,
				targetMainCharacterId: metadata.targetMainCharacterId,
				targetMainCharacterName: metadata.targetMainCharacterName,
			})
		})
	}

	const childRefs = await stepDo('start-child-character-report-workflows', STEP, async () => {
		const retentionDays = RETENTION_POLICIES[requestSource] ?? DEFAULT_RETENTION_DAYS
		const expiresAt = new Date()
		expiresAt.setDate(expiresAt.getDate() + retentionDays)

		const refs = await Promise.all(
			dedupedCharacterIds.map(async (characterId): Promise<ChildReportRef> => {
				try {
					const existingInProgress = await queries.getInProgressReportForCharacter(db, characterId)
					if (existingInProgress) {
						return {
							characterId,
							reportId: existingInProgress.id,
							workflowInstanceId: existingInProgress.workflowInstanceId,
						}
					}

					const reportId = crypto.randomUUID()
					await queries.createCharacterReport(db, {
						id: reportId,
						characterId,
						requestorUserId,
						requestorCorporationId,
						requestSource,
						applicationId,
						retentionDays,
						expiresAt,
					})

					try {
						const childWorkflowInstance = await env.CHARACTER_REPORT_WORKFLOW.create({
							id: `${characterId}-${reportId}-${Date.now()}-${crypto.randomUUID()}`,
							params: {
								reportId,
								characterId,
								targetUserId,
								sendDm: false,
							},
						})

						await queries.updateReportStatus(db, reportId, 'pending', {
							workflowInstanceId: childWorkflowInstance.id,
						})

						return {
							characterId,
							reportId,
							workflowInstanceId: childWorkflowInstance.id,
						}
					} catch (workflowStartError) {
						const message = workflowStartError instanceof Error
							? workflowStartError.message
							: String(workflowStartError)
						await queries.updateReportStatus(db, reportId, 'failed', {
							errorMessage: `Failed to start child workflow: ${message}`.slice(0, 500),
						})
						workflowLogger.warn('Failed to start child workflow for character', {
							characterId,
							reportId,
							error: message,
						})
						return {
							characterId,
							reportId,
							workflowInstanceId: null,
						}
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error)
					workflowLogger.warn('Failed to prepare child report for character', {
						characterId,
						error: message,
					})
					const failedReportId = crypto.randomUUID()
					await queries.createCharacterReport(db, {
						id: failedReportId,
						characterId,
						requestorUserId,
						requestorCorporationId,
						requestSource,
						applicationId,
						retentionDays,
						expiresAt,
					})
					await queries.updateReportStatus(db, failedReportId, 'failed', {
						errorMessage: `Failed to prepare child report: ${message}`.slice(0, 500),
					})
					return {
						characterId,
						reportId: failedReportId,
						workflowInstanceId: null,
					}
				}
			}),
		)

		return refs
	})

	await stepDo('wait-for-child-workflows', STEP, async () => {
		const pending = new Map<string, ChildReportRef>(
			childRefs.map((ref) => [ref.reportId, ref]),
		)
		let guard = 0

		while (pending.size > 0 && guard < 720) {
			guard++
			const entries = [...pending.values()]
			await Promise.all(
				entries.map(async (ref) => {
					const report = await queries.getReport(db, ref.reportId)
					if (!report) {
						pending.delete(ref.reportId)
						return
					}

					if (['completed', 'failed', 'cancelled', 'expired'].includes(report.status)) {
						pending.delete(ref.reportId)
						return
					}

					if (!ref.workflowInstanceId) {
						return
					}

					try {
						const childInstance = await env.CHARACTER_REPORT_WORKFLOW.get(ref.workflowInstanceId)
						const status = await childInstance.status()
						if (!ACTIVE_WORKFLOW_STATUSES.has(status.status)) {
							pending.delete(ref.reportId)
						}
					} catch (error) {
						workflowLogger.warn('Child workflow status lookup failed during bulk polling', {
							reportId: ref.reportId,
							workflowInstanceId: ref.workflowInstanceId,
							error: error instanceof Error ? error.message : String(error),
						})
					}
				}),
			)

			if (pending.size > 0) {
				await sleep(10_000)
			}
		}
	})

	const finalSummary = await stepDo('summarize-batch-results', STEP, async () => {
		const reports = await Promise.all(childRefs.map((ref) => queries.getReport(db, ref.reportId)))
		let completed = 0
		let failed = 0
		let cancelled = 0
		let other = 0

		for (const report of reports) {
			switch (report?.status) {
				case 'completed':
					completed++
					break
				case 'failed':
					failed++
					break
				case 'cancelled':
					cancelled++
					break
				default:
					other++
					break
			}
		}

		return { completed, failed, cancelled, other }
	})

	if (sendDm) {
		await stepDo('send-batch-finished-dm', STEP, async () => {
			const metadata = await resolveBatchReportMetadata(
				env as any,
				requestorUserId,
				requestorCorporationId,
				targetUserId,
			)
			if (!metadata) return
			await sendBatchReportFinishedDM(
				env as any,
				requestorUserId,
				{
					batchId,
					requestorMainCharacterName: metadata.requestorMainCharacterName,
					corporationTicker: metadata.corporationTicker,
					totalCharacters: dedupedCharacterIds.length,
					targetMainCharacterId: metadata.targetMainCharacterId,
					targetMainCharacterName: metadata.targetMainCharacterName,
				},
				finalSummary,
			)
		})
	}
}
