import { WorkflowEntrypoint } from 'cloudflare:workers'

import { fetchAssets, processAssets } from './steps/assets'
import {
	checkCancellation,
	cleanupIntermediateData,
	generateHtmlReport,
	updateDatabase,
} from './steps/common'
import { fetchPublicInfo, processPublicInfo } from './steps/public-info'
import { fetchWalletJournal, processWalletJournal } from './steps/wallet-journal'
import { fetchWalletTransactions, processWalletTransactions } from './steps/wallet-transactions'

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
import type { Env } from '../context'

/**
 * Character Report Workflow
 * Orchestrates the collection and processing of EVE character data
 */

/**
 * Workflow parameters
 */
export interface WorkflowParams {
	reportId: string
	characterId: string
}

/**
 * Character Report Workflow
 * Fetches and processes character data, generates HTML report, stores in R2
 */
export class CharacterReportWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { reportId, characterId } = event.payload
		const workflowInstanceId = event.instanceId

		// Helper: Get R2 bucket by name (for retrieveData calls)
		const getBucket = (name: string) => this.env[name as keyof Env] as R2Bucket

		// Step 1: Check if report was cancelled
		const cancelled = await step.do('check-cancellation', () =>
			checkCancellation(this.env.DATABASE_URL, reportId)
		)

		if (cancelled) {
			// Report was cancelled - exit early
			return
		}

		// Step 2: Fetch public info from ESI
		const fetchResult = await step.do('fetch-public-info', () =>
			fetchPublicInfo(
				this.env.ESI,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				characterId,
				workflowInstanceId
			)
		)

		// Step 3: Process public info
		const processResult = await step.do('process-public-info', () =>
			processPublicInfo(
				this.env,
				getBucket,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				fetchResult,
				workflowInstanceId
			)
		)

		// Step 4: Fetch assets from ESI
		const fetchAssetsResult = await step.do('fetch-assets', () =>
			fetchAssets(
				this.env.ESI,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				characterId,
				workflowInstanceId
			)
		)

		// Step 5: Process assets
		const processAssetsResult = await step.do('process-assets', () =>
			processAssets(
				this.env,
				getBucket,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				fetchAssetsResult,
				workflowInstanceId,
				characterId
			)
		)

		// Step 6: Fetch wallet transactions from ESI
		const fetchWalletTransactionsResult = await step.do('fetch-wallet-transactions', () =>
			fetchWalletTransactions(
				this.env.ESI,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				characterId,
				workflowInstanceId
			)
		)

		// Step 7: Process wallet transactions
		const processWalletTransactionsResult = await step.do('process-wallet-transactions', () =>
			processWalletTransactions(
				this.env,
				getBucket,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				fetchWalletTransactionsResult,
				workflowInstanceId,
				characterId
			)
		)

		// Step 8: Fetch wallet journal entries
		const fetchWalletJournalResult = await step.do('fetch-wallet-journal', () =>
			fetchWalletJournal(
				this.env.ESI,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				characterId,
				workflowInstanceId
			)
		)

		// Step 9: Process wallet journal entries
		const processWalletJournalResult = await step.do('process-wallet-journal', () =>
			processWalletJournal(
				this.env,
				getBucket,
				this.env.CHARACTER_REPORTS,
				'CHARACTER_REPORTS',
				fetchWalletJournalResult,
				workflowInstanceId,
				characterId
			)
		)

		// Step 10: Generate HTML report and store in R2
		const finalReportResult = await step.do('generate-html', () =>
			generateHtmlReport(
				this.env.CHARACTER_REPORTS,
				getBucket,
				processResult,
				characterId,
				reportId,
				processAssetsResult,
				processWalletTransactionsResult,
				processWalletJournalResult
			)
		)

		// Step 11: Clean up intermediate data
		await step.do('cleanup-intermediate-data', () =>
			cleanupIntermediateData(this.env.CHARACTER_REPORTS, workflowInstanceId)
		)

		// Step 12: Update database with final status
		await step.do('update-database', () =>
			updateDatabase(
				this.env.DATABASE_URL,
				reportId,
				finalReportResult.bucket,
				finalReportResult.key
			)
		)
	}
}
