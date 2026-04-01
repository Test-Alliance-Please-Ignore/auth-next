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

import type { WorkflowEvent, WorkflowStep } from 'cloudflare:workers'
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

		try {

			// Step 1: Check if report was cancelled
			const cancelled = await step.do('check-cancellation', () =>
				checkCancellation(this.env, reportId),
			)

			if (cancelled) {
				return
			}

			// Step 2: Fetch public info from ESI
			const fetchResult = await step.do('fetch-public-info', () =>
				fetchPublicInfo(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 3: Process public info
			const processResult = await step.do('process-public-info', () =>
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
			const fetchAssetsResult = await step.do('fetch-assets', () =>
				fetchAssets(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
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
					characterId,
				),
			)

			// Step 6: Fetch custom ship names from ESI
			const fetchAssetNamesResult = await step.do('fetch-asset-names', () =>
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
			const processFittedShipsResult = await step.do('process-fitted-ships', () =>
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
			const fetchWalletTransactionsResult = await step.do('fetch-wallet-transactions', () =>
				fetchWalletTransactions(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 8: Process wallet transactions
			const processWalletTransactionsResult = await step.do('process-wallet-transactions', () =>
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
			const fetchWalletJournalResult = await step.do('fetch-wallet-journal', () =>
				fetchWalletJournal(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 10: Process wallet journal entries
			const processWalletJournalResult = await step.do('process-wallet-journal', () =>
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
			const fetchMailsResult = await step.do('fetch-mails', () =>
				fetchMails(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 12: Process mails
			const processMailsResult = await step.do('process-mails', () =>
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
			const fetchContactsResult = await step.do('fetch-contacts', () =>
				fetchContacts(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 14: Process contacts
			const processContactsResult = await step.do('process-contacts', () =>
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
			const fetchCorpHistoryResult = await step.do('fetch-corp-history', () =>
				fetchCorpHistory(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 16: Process corporation history
			const processCorpHistoryResult = await step.do('process-corp-history', () =>
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
			const fetchSkillsResult = await step.do('fetch-skills', () =>
				fetchSkills(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 18: Process skills
			const processSkillsResult = await step.do('process-skills', () =>
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
			const fetchContractsResult = await step.do('fetch-contracts-data', () =>
				fetchContracts(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 20: Process contracts
			const processContractsResult = await step.do('process-contracts', () =>
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
			const fetchNotificationsResult = await step.do('fetch-notifications', () =>
				fetchNotifications(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 22: Process notifications
			const processNotificationsResult = await step.do('process-notifications', () =>
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
			const fetchClonesResult = await step.do('fetch-clones', () =>
				fetchClones(
					this.env.ESI,
					this.env.CHARACTER_REPORTS,
					'CHARACTER_REPORTS',
					characterId,
					workflowInstanceId,
				),
			)

			// Step 24: Process clones
			const processClonesResult = await step.do('process-clones', () =>
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
			const customNamesResult = await step.do('apply-asset-custom-names', () =>
				applyAssetCustomNames(
					getBucket,
					this.env.CHARACTER_REPORTS,
					fetchAssetNamesResult,
					processAssetsResult,
					processFittedShipsResult,
				),
			)

			// Apply market prices to processed assets in-place
			const marketPricesResult = await step.do('apply-market-prices', () =>
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
			const generateAlertsResult = await step.do('generate-alerts', () =>
				generateAlerts(
					this.env.CORE,
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
			const finalResult = await step.do('persist-sections', () =>
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
			await step.do('cleanup-intermediate-data', () =>
				cleanupIntermediateData(this.env.CHARACTER_REPORTS, workflowInstanceId),
			)

			// Step 23: Update database with final status
			await step.do('update-database', () =>
				updateDatabase(
					this.env,
					this.env.DATABASE_URL,
					reportId,
					finalResult.bucket,
					finalResult.key,
				),
			)
		} catch (error) {
			// Mark report as failed in DB so it doesn't stay stuck as "pending"
			try {
				await step.do('mark-failed', async () => {
					const errorMsg = error instanceof Error ? error.message : String(error)
					console.error('[CharacterReportWorkflow] Workflow failed:', {
						reportId,
						characterId,
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
