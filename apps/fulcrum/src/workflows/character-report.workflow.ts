import { WorkflowEntrypoint } from 'cloudflare:workers'

import { createDb } from '../db'
import { characterReports } from '../db/schema'
import { buildUpdateReportStatusQuery } from '../db/queries'
import { fetchAssets, processAssets, fetchAssetNames, applyAssetCustomNames, applyMarketPrices } from './steps/assets'
import { generateAlerts } from './steps/alerts'
import {
	checkCancellation,
	cleanupIntermediateData,
	persistSections,
	updateDatabase,
} from './steps/common'
import { fetchContacts, processContacts } from './steps/contacts'
import { fetchContracts, processContracts } from './steps/contracts'
import { fetchCorpHistory, processCorpHistory } from './steps/corp-history'
import { processFittedShips } from './steps/fitted-ships'
import { fetchMails, processMails } from './steps/mails'
import { fetchNotifications, processNotifications } from './steps/notifications'
import { fetchPublicInfo, processPublicInfo } from './steps/public-info'
import { fetchSkills, processSkills } from './steps/skills'
import { fetchWalletJournal, processWalletJournal } from './steps/wallet-journal'
import { fetchWalletTransactions, processWalletTransactions } from './steps/wallet-transactions'
import { fetchClones, processClones } from './steps/clones'

import { getStub } from '@repo/do-utils'
import { esiFetchStepConfig, esiProcessingStepConfig } from '@repo/workflow-utils'

import type { Hr } from '@repo/hr'
import type { WorkflowEvent, WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers'
import type { Env } from '../context'
import type { StepResult } from './utils/storage'

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

const ESI_STEP = esiFetchStepConfig
const STEP = esiProcessingStepConfig

/**
 * Character Report Workflow
 * Fetches and processes character data, persists per-section JSON to R2
 */
export class CharacterReportWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { reportId, characterId } = event.payload
		const workflowInstanceId = event.instanceId

		// Helper: Get R2 bucket by name (for retrieveData calls)
		const getBucket = (name: string) => this.env[name as keyof Env] as R2Bucket

		const startedAt = Date.now()
		const logCtx = { characterId, reportId, workflowInstanceId }

		// Wrap step.do() with structured start/completion logging.
		// Logs run outside the callback so they fire on replay too, making it easy
		// to see how far a replayed workflow has progressed.
		const doStep = async <T>(name: string, config: WorkflowStepConfig, fn: () => Promise<T>): Promise<T> => {
			console.log('[Workflow] step:start', { step: name, ...logCtx })
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await step.do(name, config, fn as () => Promise<any>) as T
			const logFields: Record<string, unknown> = { step: name, ...logCtx }
			if (result !== null && typeof result === 'object' && 'success' in result && 'source' in result) {
				const r = result as unknown as StepResult
				logFields.success = r.success
				logFields.source = r.source
				if (!r.success) logFields.error = r.error
			}
			console.log('[Workflow] step:done', logFields)
			return result
		}

		console.log('[Workflow] started', logCtx)

		try {

			// Step 1: Check if report was cancelled
			const cancelled = await doStep('check-cancellation', STEP, () =>
				checkCancellation(this.env, reportId),
			)

			if (cancelled) {
				return
			}

			// Step 2: Fetch public info from ESI
			const fetchResult = await doStep('fetch-public-info', ESI_STEP, () =>
				fetchPublicInfo(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 3: Process public info
			const processResult = await doStep('process-public-info', STEP, () =>
				processPublicInfo(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 4: Fetch assets from ESI
			const fetchAssetsResult = await doStep('fetch-assets', ESI_STEP, () =>
				fetchAssets(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 5: Process assets
			const processAssetsResult = await doStep('process-assets', STEP, () =>
				processAssets(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchAssetsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 6: Fetch custom ship names from ESI
			const fetchAssetNamesResult = await doStep('fetch-asset-names', ESI_STEP, () =>
				fetchAssetNames(
					this.env.ESI,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchAssetsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 7: Process fitted ships
			const processFittedShipsResult = await doStep('process-fitted-ships', STEP, () =>
				processFittedShips(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchAssetsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 7: Fetch wallet transactions from ESI
			const fetchWalletTransactionsResult = await doStep('fetch-wallet-transactions', ESI_STEP, () =>
				fetchWalletTransactions(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 8: Process wallet transactions
			const processWalletTransactionsResult = await doStep('process-wallet-transactions', STEP, () =>
				processWalletTransactions(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchWalletTransactionsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 9: Fetch wallet journal entries
			const fetchWalletJournalResult = await doStep('fetch-wallet-journal', ESI_STEP, () =>
				fetchWalletJournal(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 10: Process wallet journal entries
			const processWalletJournalResult = await doStep('process-wallet-journal', STEP, () =>
				processWalletJournal(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchWalletJournalResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 11: Fetch mails from ESI
			const fetchMailsResult = await doStep('fetch-mails', ESI_STEP, () =>
				fetchMails(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 12: Process mails
			const processMailsResult = await doStep('process-mails', STEP, () =>
				processMails(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchMailsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 13: Fetch contacts from ESI
			const fetchContactsResult = await doStep('fetch-contacts', ESI_STEP, () =>
				fetchContacts(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 14: Process contacts
			const processContactsResult = await doStep('process-contacts', STEP, () =>
				processContacts(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchContactsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 15: Fetch corporation history from ESI
			const fetchCorpHistoryResult = await doStep('fetch-corp-history', ESI_STEP, () =>
				fetchCorpHistory(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 16: Process corporation history
			const processCorpHistoryResult = await doStep('process-corp-history', STEP, () =>
				processCorpHistory(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchCorpHistoryResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 17: Fetch skills and skill queue from ESI
			const fetchSkillsResult = await doStep('fetch-skills', ESI_STEP, () =>
				fetchSkills(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 18: Process skills
			const processSkillsResult = await doStep('process-skills', STEP, () =>
				processSkills(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchSkillsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 19: Fetch contracts from ESI
			const fetchContractsResult = await doStep('fetch-contracts-data', ESI_STEP, () =>
				fetchContracts(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 20: Process contracts
			const processContractsResult = await doStep('process-contracts', STEP, () =>
				processContracts(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchContractsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 21: Fetch notifications from ESI
			const fetchNotificationsResult = await doStep('fetch-notifications', ESI_STEP, () =>
				fetchNotifications(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 22: Process notifications
			const processNotificationsResult = await doStep('process-notifications', STEP, () =>
				processNotifications(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchNotificationsResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Step 23: Fetch clones and active implants from ESI
			const fetchClonesResult = await doStep('fetch-clones', ESI_STEP, () =>
				fetchClones(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 24: Process clones
			const processClonesResult = await doStep('process-clones', STEP, () =>
				processClones(
					this.env,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					fetchClonesResult,
					workflowInstanceId,
					characterId,
				),
			)

			// Apply custom ship names to processed assets and fitted ships in-place
			const customNamesResult = await doStep('apply-asset-custom-names', ESI_STEP, () =>
				applyAssetCustomNames(
					getBucket,
					this.env.CHARACTER_REPORTS,
					fetchAssetNamesResult,
					processAssetsResult,
					processFittedShipsResult,
				),
			)

			// Apply market prices to processed assets in-place
			const marketPricesResult = await doStep('apply-market-prices', STEP, () =>
				applyMarketPrices(
					getBucket,
					processAssetsResult,
					processFittedShipsResult,
				),
			)

			// Build enrichment failure entries for alert generation
			const enrichmentResults: Record<string, StepResult> = {}
			if (customNamesResult.warning) {
				enrichmentResults['apply-asset-custom-names'] = {
					source: 'none',
					success: false,
					error: customNamesResult.warning,
				}
			}
			if (marketPricesResult.warning) {
				enrichmentResults['apply-market-prices'] = {
					source: 'none',
					success: false,
					error: marketPricesResult.warning,
				}
			}

			// Generate alerts from all processed data
			const hrStub = getStub<Hr>(this.env.HR, 'default')
			const generateAlertsResult = await doStep('generate-alerts', STEP, () =>
				generateAlerts(
					this.env.CORE,
					hrStub,
					getBucket,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					{
						'fetch-public-info': fetchResult,
						'process-public-info': processResult,
						'fetch-assets': fetchAssetsResult,
						'process-assets': processAssetsResult,
						'fetch-asset-names': fetchAssetNamesResult,
						'process-fitted-ships': processFittedShipsResult,
						'fetch-wallet-transactions': fetchWalletTransactionsResult,
						'process-wallet-transactions': processWalletTransactionsResult,
						'fetch-wallet-journal': fetchWalletJournalResult,
						'process-wallet-journal': processWalletJournalResult,
						'fetch-mails': fetchMailsResult,
						'process-mails': processMailsResult,
						'fetch-contacts': fetchContactsResult,
						'process-contacts': processContactsResult,
						'fetch-corp-history': fetchCorpHistoryResult,
						'process-corp-history': processCorpHistoryResult,
						'fetch-skills': fetchSkillsResult,
						'process-skills': processSkillsResult,
						'fetch-contracts': fetchContractsResult,
						'process-contracts': processContractsResult,
						'fetch-notifications': fetchNotificationsResult,
						'process-notifications': processNotificationsResult,
						'fetch-clones': fetchClonesResult,
						'process-clones': processClonesResult,
						...enrichmentResults,
					},
					workflowInstanceId,
					characterId,
				),
			)

			// Persist all processed sections to permanent R2 paths
			const finalResult = await doStep('persist-sections', STEP, () =>
				persistSections(
					this.env.CHARACTER_REPORTS,
					getBucket,
					characterId,
					reportId,
					[
						{ name: 'public-info', result: processResult },
						{ name: 'assets', result: processAssetsResult },
						{ name: 'fitted-ships', result: processFittedShipsResult },
						{ name: 'wallet-transactions', result: processWalletTransactionsResult },
						{ name: 'wallet-journal', result: processWalletJournalResult },
						{ name: 'mails', result: processMailsResult },
						{ name: 'contacts', result: processContactsResult },
						{ name: 'corp-history', result: processCorpHistoryResult },
						{ name: 'skills', result: processSkillsResult },
						{ name: 'contracts', result: processContractsResult },
						{ name: 'notifications', result: processNotificationsResult },
						{ name: 'clones', result: processClonesResult },
						{ name: 'alerts', result: generateAlertsResult },
					],
				),
			)

			// Step 22: Clean up intermediate data
			await doStep('cleanup-intermediate-data', STEP, () =>
				cleanupIntermediateData(this.env.CHARACTER_REPORTS, workflowInstanceId),
			)

			// Step 23: Update database with final status
			await doStep('update-database', STEP, () =>
				updateDatabase(
					this.env,
					this.env.DATABASE_URL,
					reportId,
					finalResult.bucket,
					finalResult.key,
				),
			)

			console.log('[Workflow] completed', { ...logCtx, durationMs: Date.now() - startedAt })
		} catch (error) {
			// Mark report as failed in DB so it doesn't stay stuck as "pending"
			try {
				await doStep('mark-failed', STEP, async () => {
					const errorMsg = error instanceof Error ? error.message : String(error)
					console.error('[Workflow] failed', {
						...logCtx,
						durationMs: Date.now() - startedAt,
						error: errorMsg,
					})
					const db = createDb(this.env.DATABASE_URL)
					const query = buildUpdateReportStatusQuery(reportId, 'failed', {
						errorMessage: errorMsg.slice(0, 500),
					})
					await db.update(characterReports).set(query.set).where(query.where)
				})
			} catch (markError) {
				console.error('[CharacterReportWorkflow] Failed to mark report as failed:', {
					reportId,
					characterId,
					originalError: error instanceof Error ? error.message : String(error),
					markError: markError instanceof Error ? markError.message : String(markError),
				})
			}
			throw error
		}
	}
}
