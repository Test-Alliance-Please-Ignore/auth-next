import { WorkflowEntrypoint } from 'cloudflare:workers'

import { getStub } from '@repo/do-utils'

import { getExportArtifactExpiresAtIso } from '../lib/export-retention'

import {
	buildVerifiedMoonsExportFileName,
	buildVerifiedMoonsExportKey,
	getVerifiedMoonsExportBucket,
	buildVerifiedMoonSummaryRecords,
	type VerifiedMoonsExportQuery,
	writeVerifiedMoonsExportToBucket,
} from '../routes/moon-scan'
import {
	buildSrpPaidRequestsExportFileName,
	buildSrpPaidRequestsExportKey,
	buildSrpWalletHistoryExportFileName,
	buildSrpWalletHistoryExportKey,
	getSrpExportBucket,
	parseSrpCsvExportDateRange,
	writeSrpPaidRequestsExportToBucket,
	writeSrpWalletHistoryExportToBucket,
} from '../routes/srp'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { MoonScanDO } from '@repo/moon-scan'
import type { Universe } from '@repo/universe'
import type { Env } from '../context'
import { logger } from '@repo/hono-helpers'

export type CsvExportWorkflowParams =
	| {
			kind: 'moon-scan-verified'
			userId: string
			query: VerifiedMoonsExportQuery
	  }
	| {
			kind: 'srp-paid-requests'
			userId: string
			characterName?: string
			shipTypeName?: string
			solarSystemName?: string
			dateFrom: string
			dateTo: string
	  }
	| {
			kind: 'srp-wallet-history'
			userId: string
			reason?: string
			recipientId?: string
			alertsOnly?: boolean
			dateFrom: string
			dateTo: string
	  }

export type CsvExportWorkflowKind = CsvExportWorkflowParams['kind']

type ExportWorkflowStatus = 'completed' | 'failed'

export interface CsvExportWorkflowResult {
	status: ExportWorkflowStatus
	workflowInstanceId: string
	kind: CsvExportWorkflowKind
	exportId: string
	fileName: string
	expiresAt: string | null
	rowCount: number
	error?: {
		message: string
		stack?: string
	}
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size) as T[])
	}
	return chunks
}

async function runMoonScanExport(
	env: Env,
	workflowInstanceId: string,
	query: VerifiedMoonsExportQuery
): Promise<{ fileName: string; expiresAt: string; rowCount: number }> {
	const moonScan = getStub<MoonScanDO>(env.MOON_SCAN, 'default')
	const universe = getStub<Universe>(env.UNIVERSE, 'default')
	const expiresAt = getExportArtifactExpiresAtIso()

	try {
		const [scanSummary, summaryMoonIds] = await Promise.all([
			moonScan.getScanSummary(),
			moonScan.getVerifiedMoonSummaryIds(),
		])
		const summaryMoonIdSet = new Set(summaryMoonIds)
		const missingMoonIds = scanSummary.verifiedMoonIds.filter((moonId) => !summaryMoonIdSet.has(moonId))
		if (missingMoonIds.length > 0) {
			for (const missingMoonIdChunk of chunkArray(missingMoonIds, 250)) {
				const missingCompositions = await moonScan.getVerifiedCompositions(missingMoonIdChunk)
				const summaryRecords = await buildVerifiedMoonSummaryRecords(missingCompositions, universe)
				await moonScan.upsertVerifiedMoonSummaries(summaryRecords)
			}
		}
	} catch (error) {
		logger.warn('Failed to backfill moon summary export read model', {
			error,
		})
	}

	const exportKey = buildVerifiedMoonsExportKey(workflowInstanceId)
	const fileName = buildVerifiedMoonsExportFileName(workflowInstanceId)
	const bucket = getVerifiedMoonsExportBucket(env)
	return {
		fileName,
		expiresAt,
		rowCount: await writeVerifiedMoonsExportToBucket({
			bucket,
			exportKey,
			fileName,
			expiresAt,
			moonScan,
			universe,
			env,
			query,
		}),
	}
}

async function runSrpPaidRequestsExport(
	env: Env,
	workflowInstanceId: string,
	params: Extract<CsvExportWorkflowParams, { kind: 'srp-paid-requests' }>
): Promise<{ fileName: string; expiresAt: string; rowCount: number }> {
	const dateRange = parseSrpCsvExportDateRange(params.dateFrom, params.dateTo)
	if ('error' in dateRange) {
		throw new Error(dateRange.error)
	}

	const expiresAt = getExportArtifactExpiresAtIso()
	const bucket = getSrpExportBucket(env)
	const exportKey = buildSrpPaidRequestsExportKey(workflowInstanceId)
	const fileName = buildSrpPaidRequestsExportFileName(params.dateFrom, params.dateTo)
	return {
		fileName,
		expiresAt,
		rowCount: await writeSrpPaidRequestsExportToBucket({
			bucket,
			exportKey,
			fileName,
			expiresAt,
			env,
			filters: {
				dateRange,
				characterName: params.characterName,
				shipTypeName: params.shipTypeName,
				solarSystemName: params.solarSystemName,
			},
		}),
	}
}

async function runSrpWalletHistoryExport(
	env: Env,
	workflowInstanceId: string,
	params: Extract<CsvExportWorkflowParams, { kind: 'srp-wallet-history' }>
): Promise<{ fileName: string; expiresAt: string; rowCount: number }> {
	const dateRange = parseSrpCsvExportDateRange(params.dateFrom, params.dateTo)
	if ('error' in dateRange) {
		throw new Error(dateRange.error)
	}

	const expiresAt = getExportArtifactExpiresAtIso()
	const bucket = getSrpExportBucket(env)
	const exportKey = buildSrpWalletHistoryExportKey(workflowInstanceId)
	const fileName = buildSrpWalletHistoryExportFileName(params.dateFrom, params.dateTo)
	return {
		fileName,
		expiresAt,
		rowCount: await writeSrpWalletHistoryExportToBucket({
			bucket,
			exportKey,
			fileName,
			expiresAt,
			env,
			filters: {
				dateRange,
				reason: params.reason,
				recipientId: params.recipientId,
				alertsOnly: params.alertsOnly,
			},
		}),
	}
}

export class CsvExportWorkflow extends WorkflowEntrypoint<Env, CsvExportWorkflowParams> {
	async run(
		event: WorkflowEvent<CsvExportWorkflowParams>,
		step: WorkflowStep
	): Promise<CsvExportWorkflowResult> {
		const workflowInstanceId = event.instanceId
		const payload = event.payload

		await step.do('init-workflow', async () => ({
			kind: payload.kind,
			workflowInstanceId,
			startedAt: new Date().toISOString(),
		}))

		try {
			const result = await step.do(
				'write-export-artifact',
				{
					retries: {
						limit: 3,
						delay: '5 seconds',
						backoff: 'exponential',
					},
					timeout: '30 minutes',
				},
				async () => {
					switch (payload.kind) {
						case 'moon-scan-verified':
							return await runMoonScanExport(
								this.env,
								workflowInstanceId,
								payload.query
							)
						case 'srp-paid-requests':
							return await runSrpPaidRequestsExport(this.env, workflowInstanceId, payload)
						case 'srp-wallet-history':
							return await runSrpWalletHistoryExport(this.env, workflowInstanceId, payload)
					}
				}
			)

			return {
				status: 'completed',
				workflowInstanceId,
				kind: payload.kind,
				exportId: workflowInstanceId,
				fileName: result.fileName,
				expiresAt: result.expiresAt,
				rowCount: result.rowCount,
			}
		} catch (error) {
			return {
				status: 'failed',
				workflowInstanceId,
				kind: payload.kind,
				exportId: workflowInstanceId,
				fileName: workflowInstanceId,
				expiresAt: null,
				rowCount: 0,
				error: {
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
				},
			}
		}
	}
}
