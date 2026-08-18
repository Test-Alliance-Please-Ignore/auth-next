import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'
import { killmailDetailSchema } from '@repo/universe'

import { UseCharacterAuth, UseCorporationAuth, UsePublicAuth } from './lib/auth-decorators'
import { EsiFetcher } from './lib/esi-fetch'
import {
	transformAlliancePublicInfo,
	transformCharacterAffiliation,
	transformCharacterAgentResearch,
	transformCharacterAsset,
	transformCharacterAssetNames,
	transformCharacterAttributes,
	transformCharacterBlueprint,
	transformCharacterCalendar,
	transformCharacterClones,
	transformCharacterContact,
	transformCharacterContract,
	transformCharacterFitting,
	transformCharacterImplants,
	transformCharacterKillmails,
	transformCharacterLocation,
	transformCharacterMail,
	transformCharacterMarketOrder,
	transformCharacterMarketTransaction,
	transformCharacterMiningLedger,
	transformCharacterNotifications,
	transformCharacterPlanet,
	transformCharacterPublicInfo,
	transformCharacterRoles,
	transformCharacterShip,
	transformCharacterSkillQueue,
	transformCharacterSkills,
	transformCharacterStanding,
	transformCharacterTitle,
	transformCharacterWalletJournal,
	transformContractItems,
	transformCorporationAssets,
	transformCorporationContact,
	transformCorporationContracts,
	transformCorporationDivision,
	transformCorporationFacility,
	transformCorporationHistoryEntry,
	transformCorporationIcon,
	transformCorporationIndustryJobs,
	transformCorporationKillmails,
	transformCorporationMedal,
	transformCorporationMembers,
	transformCorporationMemberTracking,
	transformCorporationOrders,
	transformCorporationPublicInfo,
	transformCorporationRole,
	transformCorporationShareholder,
	transformCorporationStanding,
	transformCorporationStructures,
	transformCorporationTitle,
	transformCorporationWalletJournal,
	transformCorporationWallets,
	transformCorporationWalletTransactions,
	transformMailContent,
	transformMailingLists,
	transformMailLabels,
	transformStructureInfo,
} from './lib/esi-transforms'
import { createEsiDb, runEsiMigrations } from './storage'

import type {
	AlliancePublicInfo,
	CharacterAffiliation,
	CharacterAgentResearch,
	CharacterAsset,
	CharacterAssetName,
	CharacterAttributes,
	CharacterBlueprint,
	CharacterCalendar,
	CharacterClones,
	CharacterContact,
	CharacterContract,
	CharacterContractItem,
	CharacterFitting,
	CharacterImplants,
	CharacterKillmailBasic,
	CharacterLocation,
	CharacterMail,
	CharacterMarketOrder,
	CharacterMarketTransaction,
	CharacterMiningLedger,
	CharacterNotification,
	CharacterPlanet,
	CharacterPublicInfo,
	CharacterRoles,
	CharacterShip,
	CharacterSkillQueue,
	CharacterSkills,
	CharacterStanding,
	CharacterTitle,
	CharacterWalletJournalEntry,
	CorporationAsset,
	CorporationContact,
	CorporationContract,
	CorporationDivision,
	CorporationFacility,
	CorporationHistoryEntry,
	CorporationIcon,
	CorporationIndustryJob,
	CorporationKillmail,
	CorporationMedal,
	CorporationMemberRole,
	CorporationMembers,
	CorporationMemberTracking,
	CorporationOrder,
	CorporationPublicInfo,
	CorporationRole,
	CorporationShareholder,
	CorporationStanding,
	CorporationStructure,
	CorporationTitle,
	CorporationWallet,
	CorporationWalletJournalEntry,
	CorporationWalletTransaction,
	Esi,
	EsiAlliancePublicInfo,
	EsiCharacterAffiliation,
	EsiCharacterAgentResearch,
	EsiCharacterAsset,
	EsiCharacterAssetName,
	EsiCharacterAttributes,
	EsiCharacterBlueprint,
	EsiCharacterCalendar,
	EsiCharacterClones,
	EsiCharacterContact,
	EsiCharacterContract,
	EsiCharacterFitting,
	EsiCharacterImplants,
	EsiCharacterKillmail,
	EsiCharacterLocation,
	EsiCharacterMail,
	EsiCharacterMarketOrder,
	EsiCharacterMarketTransaction,
	EsiCharacterMiningLedger,
	EsiCharacterNotification,
	EsiCharacterPlanet,
	EsiCharacterPublicInfo,
	EsiCharacterRoles,
	EsiCharacterShip,
	EsiCharacterSkillQueue,
	EsiCharacterSkills,
	EsiCharacterStanding,
	EsiCharacterTitle,
	EsiCharacterWalletJournalEntry,
	EsiContractItem,
	EsiCorporationAsset,
	EsiCorporationContact,
	EsiCorporationContract,
	EsiCorporationDivision,
	EsiCorporationFacility,
	EsiCorporationHistoryEntry,
	EsiCorporationIcon,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMedal,
	EsiCorporationMemberRole,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationPublicInfo,
	EsiCorporationRole,
	EsiCorporationShareholder,
	EsiCorporationStanding,
	EsiCorporationStructure,
	EsiCorporationTitle,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EsiInsurancePrices,
	EsiMailContent,
	EsiMailingList,
	EsiMailLabelsResponse,
	EsiMarketPrice,
	EsiRequestOptions,
	EsiSaveFittingRequest,
	EsiStructureInfo,
	InsurancePlatinumValues,
	MailContent,
	MailingList,
	MailLabelsResponse,
	MarketPrice,
	SaveFittingResponse,
	StructureInfo,
} from '@repo/esi'
import type { KillmailDetail } from '@repo/universe'
import type { Env } from './context'
import type { EsiDb } from './storage/state'

// ========================================================================
// CACHE REVALIDATION TTL CONSTANTS
// ========================================================================
// For endpoints with long CCP cache durations (e.g., 30 days), these TTLs
// control how often we revalidate via ETag even when cache hasn't expired.
// This ensures we detect changes (like name renames) without waiting for
// full cache expiry.
const REVALIDATE_15_MIN = 900 // 15 minutes - for frequently-changing public info
const REVALIDATE_5_MIN = 300 // 5 minutes - for security-relevant affiliation lookups
const REVALIDATE_1_HOUR = 3600 // 1 hour - for less frequent updates

/**
 * Durable Object responsible for authenticated ESI fetches on behalf of a character or corporation.
 * Provides typed RPC methods used by other workers to hydrate character or corporation data.
 */
export class EsiDO extends DurableObject<Env> implements Esi {
	private esiFetcher: EsiFetcher
	private storage: EsiDb

	/**
	 * Creates an ESI Durable Object, wiring up the authenticated fetcher and SQLite-backed storage.
	 * Runs migrations once per instance before accepting RPC traffic.
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.esiFetcher = new EsiFetcher(state, env)
		this.storage = createEsiDb(state.storage)

		void state.blockConcurrencyWhile(async () => {
			await runEsiMigrations(this.storage)
		})
	}

	setDefaultCacheMode(mode: 'default' | 'no-store'): void {
		this.esiFetcher.setDefaultCacheMode(mode)
	}

	@UsePublicAuth
	async fetchCharacterAffiliation(
		characterId: string,
		characterIds: string[],
		options?: EsiRequestOptions
	): Promise<CharacterAffiliation[]> {
		const cacheMode = options?.cacheMode ?? 'no-store'
		const result = await this.esiFetcher.fetchEsi<EsiCharacterAffiliation[], number[]>(
			`/characters/affiliation`,
			{
				body: characterIds.map((id) => parseInt(id, 10)),
				cacheMode,
				maxRetries: options?.maxRetries,
				timeoutMs: options?.timeoutMs,
				maxLocalCacheTtl: cacheMode === 'no-store' ? undefined : REVALIDATE_5_MIN,
				method: 'POST',
				persistGlobalCache: false,
			}
		)
		return transformCharacterAffiliation(result.data)
	}

	@UseCharacterAuth
	async searchCharacter(
		characterId: string,
		characterName: string,
		strict = true
	): Promise<string[]> {
		const query = new URLSearchParams({
			categories: 'character',
			search: characterName,
			strict: String(strict),
		})

		try {
			const result = await this.esiFetcher.fetchEsi<{ character?: number[] }>(
				`/search/?${query.toString()}`,
				{ cacheMode: 'no-store' }
			)
			return (result.data.character ?? []).map((id) => String(id))
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (message.includes('404')) {
				return []
			}
			logger.withTags({ characterId, characterName, strict }).error('Character search error', error)
			return []
		}
	}

	@UsePublicAuth
	async fetchCharacterPublicInfo(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterPublicInfo> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterPublicInfo>(
			`/characters/${characterId}`,
			{
				cacheMode: options?.cacheMode ?? 'default',
				maxLocalCacheTtl: REVALIDATE_15_MIN,
			}
		)

		logger.info(`[fetchCharacterPublicInfo] Result: ${JSON.stringify(result)}`)

		if (!result || !result.data) {
			logger.info(`[fetchCharacterPublicInfo] No data found for character ID: ${characterId}`, {
				characterId,
				result,
			})
			throw new Error(`No character public info found for character ID: ${characterId}`)
		}
		const transformed = transformCharacterPublicInfo(result.data)

		logger.info(`[fetchCharacterPublicInfo] Transformed: ${JSON.stringify(transformed)}`, {
			characterId,
			transformed,
		})
		return transformed
	}

	@UseCharacterAuth
	async fetchCharacterNotifications(characterId: string): Promise<CharacterNotification[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterNotification[]>(
			`/characters/${characterId}/notifications`
		)
		return transformCharacterNotifications(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterAgentResearch(characterId: string): Promise<CharacterAgentResearch[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterAgentResearch[]>(
			`/characters/${characterId}/agents_research`
		)
		return transformCharacterAgentResearch(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterAssets(characterId: string): Promise<CharacterAsset[]> {
		const result = await this.esiFetcher.fetchEsiPaginated<EsiCharacterAsset>(
			`/characters/${characterId}/assets`
		)
		return transformCharacterAsset(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterAssetNames(
		characterId: string,
		itemIds: string[]
	): Promise<CharacterAssetName[]> {
		if (itemIds.length === 0) return []

		// ESI accepts up to 1000 item IDs per request
		const BATCH_SIZE = 1000
		const allNames: CharacterAssetName[] = []

		for (let i = 0; i < itemIds.length; i += BATCH_SIZE) {
			const batch = itemIds.slice(i, i + BATCH_SIZE)
			const result = await this.esiFetcher.fetchEsi<EsiCharacterAssetName[], number[]>(
				`/characters/${characterId}/assets/names/`,
				{
					method: 'POST',
					body: batch.map((id) => parseInt(id, 10)),
					persistGlobalCache: false,
				}
			)
			allNames.push(...transformCharacterAssetNames(result.data))
		}

		return allNames
	}

	@UseCharacterAuth
	async fetchCharacterAttributes(characterId: string): Promise<CharacterAttributes> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterAttributes>(
			`/characters/${characterId}/attributes`
		)
		if (!result.data) {
			throw new Error(`No character attributes found for character ID: ${characterId}`)
		}
		return transformCharacterAttributes(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterBlueprints(characterId: string): Promise<CharacterBlueprint[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterBlueprint[]>(
			`/characters/${characterId}/blueprints`
		)
		return transformCharacterBlueprint(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterCalendar(characterId: string): Promise<CharacterCalendar[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterCalendar[]>(
			`/characters/${characterId}/calendar`
		)
		return transformCharacterCalendar(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterContacts(characterId: string): Promise<CharacterContact[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterContact[]>(
			`/characters/${characterId}/contacts`
		)
		return transformCharacterContact(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterContracts(characterId: string): Promise<CharacterContract[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterContract[]>(
			`/characters/${characterId}/contracts`
		)
		return transformCharacterContract(result.data)
	}

	@UseCharacterAuth
	async fetchContractItems(
		characterId: string,
		contractId: string
	): Promise<CharacterContractItem[]> {
		const result = await this.esiFetcher.fetchEsi<EsiContractItem[]>(
			`/characters/${characterId}/contracts/${contractId}/items`
		)
		return transformContractItems(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterFittings(characterId: string): Promise<CharacterFitting[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterFitting[]>(
			`/characters/${characterId}/fittings`
		)
		return transformCharacterFitting(result.data)
	}

	@UseCharacterAuth
	async saveCharacterFitting(
		characterId: string,
		fitting: {
			name: string
			description: string
			shipTypeId: string
			items: Array<{ typeId: string; flag: string; quantity: number }>
		}
	): Promise<SaveFittingResponse> {
		const body: EsiSaveFittingRequest = {
			name: fitting.name,
			description: fitting.description || '',
			ship_type_id: parseInt(fitting.shipTypeId),
			items: fitting.items.map((item) => ({
				type_id: parseInt(item.typeId),
				flag: item.flag,
				quantity: item.quantity,
			})),
		}

		const result = await this.esiFetcher.fetchEsi<SaveFittingResponse, EsiSaveFittingRequest>(
			`/characters/${characterId}/fittings`,
			{ method: 'POST', body }
		)
		return result.data
	}

	@UseCharacterAuth
	async fetchCharacterLocation(characterId: string): Promise<CharacterLocation> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterLocation>(
			`/characters/${characterId}/location`,
			{ cacheMode: 'no-store' }
		)
		if (!result.data) {
			throw new Error(`No character location found for character ID: ${characterId}`)
		}
		return transformCharacterLocation(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMail(characterId: string): Promise<CharacterMail[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMail[]>(
			`/characters/${characterId}/mail`
		)
		return transformCharacterMail(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMailPage(characterId: string, lastMailId?: string): Promise<CharacterMail[]> {
		const path = lastMailId
			? `/characters/${characterId}/mail?last_mail_id=${lastMailId}`
			: `/characters/${characterId}/mail`
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMail[]>(path)
		return transformCharacterMail(result.data)
	}

	@UseCharacterAuth
	async fetchMailContent(characterId: string, mailId: string): Promise<MailContent> {
		const result = await this.esiFetcher.fetchEsi<EsiMailContent>(
			`/characters/${characterId}/mail/${mailId}`
		)
		return transformMailContent(result.data)
	}

	@UseCharacterAuth
	async fetchMailingLists(characterId: string): Promise<MailingList[]> {
		const result = await this.esiFetcher.fetchEsi<EsiMailingList[]>(
			`/characters/${characterId}/mail/lists`
		)
		return transformMailingLists(result.data)
	}

	@UseCharacterAuth
	async fetchMailLabels(characterId: string): Promise<MailLabelsResponse> {
		const result = await this.esiFetcher.fetchEsi<EsiMailLabelsResponse>(
			`/characters/${characterId}/mail/labels`
		)
		return transformMailLabels(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMiningLedger(characterId: string): Promise<CharacterMiningLedger[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMiningLedger[]>(
			`/characters/${characterId}/mining`
		)
		return transformCharacterMiningLedger(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterPlanets(characterId: string): Promise<CharacterPlanet[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterPlanet[]>(
			`/characters/${characterId}/planets`
		)
		return transformCharacterPlanet(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterRoles(characterId: string): Promise<CharacterRoles> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterRoles>(
			`/characters/${characterId}/roles`,
			{ cacheMode: 'no-store' }
		)
		if (!result.data) {
			throw new Error(`No character roles found for character ID: ${characterId}`)
		}
		return transformCharacterRoles(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterShip(characterId: string): Promise<CharacterShip> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterShip>(
			`/characters/${characterId}/ship`,
			{ cacheMode: 'no-store' }
		)
		if (!result.data) {
			throw new Error(`No character ship found for character ID: ${characterId}`)
		}
		return transformCharacterShip(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterSkillQueue(characterId: string): Promise<CharacterSkillQueue[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterSkillQueue[]>(
			`/characters/${characterId}/skillqueue`
		)
		return transformCharacterSkillQueue(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterSkills(characterId: string): Promise<CharacterSkills> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterSkills>(
			`/characters/${characterId}/skills`
		)
		if (!result.data) {
			throw new Error(`No character skills found for character ID: ${characterId}`)
		}
		return transformCharacterSkills(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterStandings(characterId: string): Promise<CharacterStanding[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterStanding[]>(
			`/characters/${characterId}/standings`
		)
		return transformCharacterStanding(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterTitles(characterId: string): Promise<CharacterTitle[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterTitle[]>(
			`/characters/${characterId}/titles`
		)
		return transformCharacterTitle(result.data)
	}

	@UseCharacterAuth
	async fetchCorporationHistory(characterId: string): Promise<CorporationHistoryEntry[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationHistoryEntry[]>(
			`/characters/${characterId}/corporationhistory`,
			{ maxLocalCacheTtl: REVALIDATE_1_HOUR }
		)
		return transformCorporationHistoryEntry(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMarketOrders(characterId: string): Promise<CharacterMarketOrder[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMarketOrder[]>(
			`/characters/${characterId}/orders`,
			{ cacheMode: 'no-store' }
		)
		return transformCharacterMarketOrder(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMarketTransactions(
		characterId: string
	): Promise<CharacterMarketTransaction[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMarketTransaction[]>(
			`/characters/${characterId}/wallet/transactions`,
			{ cacheMode: 'no-store' }
		)
		return transformCharacterMarketTransaction(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMarketTransactionsPage(
		characterId: string,
		fromId?: string
	): Promise<CharacterMarketTransaction[]> {
		const path = fromId
			? `/characters/${characterId}/wallet/transactions?from_id=${fromId}`
			: `/characters/${characterId}/wallet/transactions`
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMarketTransaction[]>(path, {
			cacheMode: 'no-store',
		})
		return transformCharacterMarketTransaction(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterWalletJournal(characterId: string): Promise<CharacterWalletJournalEntry[]> {
		const result = await this.esiFetcher.fetchEsiPaginated<EsiCharacterWalletJournalEntry>(
			`/characters/${characterId}/wallet/journal`,
			{ cacheMode: 'no-store' }
		)
		return transformCharacterWalletJournal(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterBasicKillmails(characterId: string): Promise<CharacterKillmailBasic[]> {
		const result = await this.esiFetcher.fetchEsiPaginated<EsiCharacterKillmail>(
			`/characters/${characterId}/killmails/recent`
		)
		return transformCharacterKillmails(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterBasicKillmailPage(
		characterId: string,
		page: number
	): Promise<{ data: CharacterKillmailBasic[]; pages: number }> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterKillmail[]>(
			`/characters/${characterId}/killmails/recent?page=${page}`
		)
		return {
			data: transformCharacterKillmails(result.data ?? []),
			pages: result.pages ?? 1,
		}
	}

	@UseCharacterAuth
	async fetchCharacterKillmailDetail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<KillmailDetail | null> {
		const result = await this.esiFetcher.fetchEsi<KillmailDetail>(
			`/killmails/${killmailId}/${killmailHash}`
		)
		if (!result.data) {
			return null
		}
		const validatedData = killmailDetailSchema.parse(result.data)
		return validatedData
	}

	@UseCharacterAuth
	async fetchCharacterKillmails(characterId: string): Promise<KillmailDetail[]> {
		const result = await this.esiFetcher.fetchEsiPaginated<EsiCharacterKillmail>(
			`/characters/${characterId}/killmails/recent`
		)
		const killmails = await Promise.all(
			result.data.map(async (km) => {
				const detail = await this.fetchCharacterKillmailDetail(
					characterId,
					String(km.killmail_id),
					km.killmail_hash
				)
				if (!detail) return null
				return { ...detail, killmail_hash: km.killmail_hash }
			})
		)
		return killmails.filter((km): km is Exclude<(typeof killmails)[number], null> => km !== null)
	}

	@UseCharacterAuth
	async fetchCharacterClones(characterId: string): Promise<CharacterClones> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterClones>(
			`/characters/${characterId}/clones`
		)
		return transformCharacterClones(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterImplants(characterId: string): Promise<CharacterImplants> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterImplants>(
			`/characters/${characterId}/implants`
		)
		return transformCharacterImplants(result.data)
	}

	/**
	 * Fetches the current corporation member roster.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns List of members with basic metadata.
	 */
	@UseCorporationAuth
	async fetchCorporationMembers(corporationId: string): Promise<CorporationMembers> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMembers[]>(
			`/corporations/${corporationId}/members`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationMembers(result.data)
	}

	@UseCorporationAuth
	async fetchCorporationMemberRoles(corporationId: string): Promise<CorporationMemberRole[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMemberRole[]>(
			`/corporations/${corporationId}/roles`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationRole(result.data)
	}

	/**
	 * Fetches detailed member tracking information such as last logon and ship location.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of member tracking entries.
	 */
	@UseCorporationAuth
	async fetchCorporationMemberTracking(
		corporationId: string
	): Promise<CorporationMemberTracking[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMemberTracking[]>(
			`/corporations/${corporationId}/membertracking`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationMemberTracking(result.data)
	}

	/**
	 * Retrieves all corporation wallet divisions and balances.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Wallet division metadata with balances.
	 */
	@UseCorporationAuth
	async fetchCorporationWallets(corporationId: string): Promise<CorporationWallet[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWallet[]>(
			`/corporations/${corporationId}/wallets`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationWallets(result.data)
	}

	/**
	 * Retrieves wallet journal entries for a specific division.
	 * @param corporationId - The EVE corporation identifier.
	 * @param division - Wallet division index (0-6).
	 * @returns Chronological wallet journal entries.
	 */
	@UseCorporationAuth
	async fetchCorporationWalletJournal(
		corporationId: string,
		division: number
	): Promise<CorporationWalletJournalEntry[]> {
		const result = await this.esiFetcher.fetchEsiPaginated<EsiCorporationWalletJournalEntry>(
			`/corporations/${corporationId}/wallets/${division}/journal`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationWalletJournal(result.data)
	}

	/**
	 * Retrieves wallet transactions for a specific division.
	 * @param corporationId - The EVE corporation identifier.
	 * @param division - Wallet division index (0-6).
	 * @returns Wallet transaction entries containing source and destination info.
	 */
	@UseCorporationAuth
	async fetchCorporationWalletTransactions(
		corporationId: string,
		division: number
	): Promise<CorporationWalletTransaction[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWalletTransaction[]>(
			`/corporations/${corporationId}/wallets/${division}/transactions`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationWalletTransactions(result.data)
	}

	/**
	 * Retrieves the full corporation asset manifest.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Flattened asset hierarchy entries.
	 */
	@UseCorporationAuth
	async fetchCorporationAssets(corporationId: string): Promise<CorporationAsset[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationAsset[]>(
			`/corporations/${corporationId}/assets`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationAssets(result.data)
	}

	/**
	 * Retrieves corporation-owned structures including fuel and status data.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Structure records with timers and service details.
	 */
	@UseCorporationAuth
	async fetchCorporationStructures(corporationId: string): Promise<CorporationStructure[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationStructure[]>(
			`/corporations/${corporationId}/structures`
		)
		return transformCorporationStructures(result.data)
	}

	/**
	 * Retrieves market orders owned by the corporation.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Active buy and sell orders.
	 */
	@UseCorporationAuth
	async fetchCorporationOrders(corporationId: string): Promise<CorporationOrder[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationOrder[]>(
			`/corporations/${corporationId}/orders`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationOrders(result.data)
	}

	/**
	 * Retrieves corporation contracts including outstanding and completed ones.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Contract metadata with participants and status.
	 */
	@UseCorporationAuth
	async fetchCorporationContracts(corporationId: string): Promise<CorporationContract[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationContract[]>(
			`/corporations/${corporationId}/contracts`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationContracts(result.data)
	}

	/**
	 * Retrieves active and recently finished industry jobs for the corporation.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Industry job entries with blueprint and output info.
	 */
	@UseCorporationAuth
	async fetchCorporationIndustryJobs(corporationId: string): Promise<CorporationIndustryJob[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationIndustryJob[]>(
			`/corporations/${corporationId}/industry/jobs`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationIndustryJobs(result.data)
	}

	/**
	 * Retrieves recent corporation killmails (losses and kills).
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of killmail summaries.
	 */
	@UseCorporationAuth
	async fetchCorporationKillmails(corporationId: string): Promise<CorporationKillmail[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationKillmail[]>(
			`/corporations/${corporationId}/killmails/recent`
		)
		return transformCorporationKillmails(result.data)
	}

	/**
	 * Retrieves public corporation information.
	 * This is a public ESI endpoint that does not require authentication.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Public corporation information.
	 */
	async fetchCorporationPublicInfo(corporationId: string): Promise<CorporationPublicInfo> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationPublicInfo>(
			`/corporations/${corporationId}`,
			{ maxLocalCacheTtl: REVALIDATE_15_MIN }
		)
		if (!result.data) {
			throw new Error(`No corporation public info found for corporation ID: ${corporationId}`)
		}
		return transformCorporationPublicInfo(result.data)
	}

	/**
	 * Retrieves public alliance information.
	 * This is a public ESI endpoint that does not require authentication.
	 * @param allianceId - The EVE alliance identifier.
	 * @returns Public alliance information.
	 */
	async fetchAlliancePublicInfo(allianceId: string): Promise<AlliancePublicInfo> {
		const result = await this.esiFetcher.fetchEsi<EsiAlliancePublicInfo>(
			`/alliances/${allianceId}`,
			{ maxLocalCacheTtl: REVALIDATE_15_MIN }
		)
		if (!result.data) {
			throw new Error(`No alliance public info found for alliance ID: ${allianceId}`)
		}
		return transformAlliancePublicInfo(result.data)
	}

	/**
	 * Retrieves corporation contacts.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation contacts.
	 */
	@UseCorporationAuth
	async fetchCorporationContact(corporationId: string): Promise<CorporationContact[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationContact[]>(
			`/corporations/${corporationId}/contacts`
		)
		return transformCorporationContact(result.data)
	}

	/**
	 * Retrieves corporation divisions (hangar and wallet).
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Corporation division information.
	 */
	@UseCorporationAuth
	async fetchCorporationDivision(corporationId: string): Promise<CorporationDivision> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationDivision>(
			`/corporations/${corporationId}/divisions`
		)
		if (!result.data) {
			throw new Error(`No corporation divisions found for corporation ID: ${corporationId}`)
		}
		return transformCorporationDivision(result.data)
	}

	/**
	 * Retrieves corporation facilities.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation facilities.
	 */
	@UseCorporationAuth
	async fetchCorporationFacility(corporationId: string): Promise<CorporationFacility[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationFacility[]>(
			`/corporations/${corporationId}/facilities`
		)
		return transformCorporationFacility(result.data)
	}

	/**
	 * Retrieves corporation icon URLs.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Corporation icon information.
	 */
	@UseCorporationAuth
	async fetchCorporationIcon(corporationId: string): Promise<CorporationIcon> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationIcon>(
			`/corporations/${corporationId}/icons`,
			{ maxLocalCacheTtl: REVALIDATE_15_MIN }
		)
		if (!result.data) {
			throw new Error(`No corporation icon found for corporation ID: ${corporationId}`)
		}
		return transformCorporationIcon(result.data)
	}

	/**
	 * Retrieves corporation medals.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation medals.
	 */
	@UseCorporationAuth
	async fetchCorporationMedal(corporationId: string): Promise<CorporationMedal[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMedal[]>(
			`/corporations/${corporationId}/medals`
		)
		return transformCorporationMedal(result.data)
	}

	/**
	 * Retrieves corporation roles for all members.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation roles.
	 */
	@UseCorporationAuth
	async fetchCorporationRole(corporationId: string): Promise<CorporationRole[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationRole[]>(
			`/corporations/${corporationId}/roles`,
			{ cacheMode: 'no-store' }
		)
		return transformCorporationRole(result.data)
	}

	/**
	 * Retrieves corporation shareholders.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation shareholders.
	 */
	@UseCorporationAuth
	async fetchCorporationShareholder(corporationId: string): Promise<CorporationShareholder[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationShareholder[]>(
			`/corporations/${corporationId}/shareholders`
		)
		return transformCorporationShareholder(result.data)
	}

	/**
	 * Retrieves corporation standings.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation standings.
	 */
	@UseCorporationAuth
	async fetchCorporationStanding(corporationId: string): Promise<CorporationStanding[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationStanding[]>(
			`/corporations/${corporationId}/standings`
		)
		return transformCorporationStanding(result.data)
	}

	/**
	 * Retrieves corporation titles.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation titles.
	 */
	@UseCorporationAuth
	async fetchCorporationTitle(corporationId: string): Promise<CorporationTitle[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationTitle[]>(
			`/corporations/${corporationId}/titles`
		)
		return transformCorporationTitle(result.data)
	}

	/**
	 * Fetch platinum-tier insurance values for all insurable ship types.
	 * Public ESI endpoint — no authentication required.
	 * Cached for 24 hours since insurance prices rarely change.
	 */
	async fetchInsurancePrices(): Promise<InsurancePlatinumValues[]> {
		const result = await this.esiFetcher.fetchEsi<EsiInsurancePrices[]>('/insurance/prices', {
			cacheScopeOverride: { scope: 'global', scopeId: 'global' },
			maxLocalCacheTtl: 86400, // 24h — outlasts missed hourly fetches
		})

		return (result.data ?? []).map((entry) => {
			const platinum = entry.levels.find((l) => l.name.toLowerCase() === 'platinum')
			return {
				typeId: String(entry.type_id),
				platinumCost: platinum?.cost ?? null,
				platinumPayout: platinum?.payout ?? null,
			}
		})
	}

	async fetchMarketPrices(): Promise<MarketPrice[]> {
		const result = await this.esiFetcher.fetchEsi<EsiMarketPrice[]>('/markets/prices', {
			cacheScopeOverride: { scope: 'global', scopeId: 'global' },
			maxLocalCacheTtl: 86400, // 24h — outlasts missed hourly fetches
		})

		return (result.data ?? []).map((entry) => ({
			typeId: String(entry.type_id),
			averagePrice: entry.average_price ?? null,
			adjustedPrice: entry.adjusted_price ?? null,
		}))
	}

	@UseCharacterAuth
	async fetchStructureInfo(
		characterId: string,
		structureId: string
	): Promise<StructureInfo | null> {
		try {
			const result = await this.esiFetcher.fetchEsi<EsiStructureInfo>(
				`/universe/structures/${structureId}`,
				{
					cacheMode: 'no-store',
				}
			)
			return transformStructureInfo(result.data)
		} catch (error) {
			// Structure not found, no access, or other error - return null
			logger
				.withTags({
					structureId,
					characterId,
					error: error instanceof Error ? error.message : String(error),
				})
				.warn('[fetchStructureInfo] Failed to fetch structure info')

			// Check if it's a 404 or 403 (not found or no access)
			if (error instanceof Error) {
				const errorMessage = error.message.toLowerCase()
				if (errorMessage.includes('404') || errorMessage.includes('403')) {
					return null
				}
			}

			// Re-throw other errors
			throw error
		}
	}
}
