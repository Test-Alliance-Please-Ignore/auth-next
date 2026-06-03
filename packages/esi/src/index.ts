import { getStub } from '@repo/do-utils'
import { KillmailDetail, killmailDetailSchema } from '@repo/universe'

import type {
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
	MailContent,
	MailingList,
	MailLabelsResponse,
	SaveFittingResponse,
	StructureInfo,
} from './types'

/**
 * @repo/esi
 *
 * Shared types and interfaces for the Esi Durable Object.
 * This package allows other workers to interact with the Durable Object via RPC.
 */

// Export ESI response types
export * from './types'
export * from './id-ranges'
export * from './errors'
export * from './request'

export interface EsiRequestOptions {
	cacheMode?: 'default' | 'no-store'
}

/**
 * Public RPC interface for Esi Durable Object
 *
 * All public methods defined here will be available to call via RPC
 * from other workers that have access to the Durable Object binding.
 *
 * @example
 * ```ts
 * import type { Esi } from '@repo/esi'
 * import { getStub } from '@repo/do-utils'
 *
 * const stub = getStub<Esi>(env.ESI, 'default')
 * const members = await stub.fetchCorporationMembers(corporationId)
 * ```
 */
export interface Esi {
	// Cache control
	setDefaultCacheMode(mode: 'default' | 'no-store'): void

	// Character endpoints
	fetchCharacterAffiliation(
		characterId: string,
		characterIds: string[],
		options?: EsiRequestOptions
	): Promise<CharacterAffiliation[]>
	fetchCharacterPublicInfo(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterPublicInfo>
	fetchCharacterNotifications(characterId: string): Promise<CharacterNotification[]>
	fetchCharacterAgentResearch(characterId: string): Promise<CharacterAgentResearch[]>
	fetchCharacterAssets(characterId: string): Promise<CharacterAsset[]>
	fetchCharacterAssetNames(characterId: string, itemIds: string[]): Promise<CharacterAssetName[]>
	fetchCharacterAttributes(characterId: string): Promise<CharacterAttributes>
	fetchCharacterBlueprints(characterId: string): Promise<CharacterBlueprint[]>
	fetchCharacterCalendar(characterId: string): Promise<CharacterCalendar[]>
	fetchCharacterContacts(characterId: string): Promise<CharacterContact[]>
	fetchCharacterContracts(characterId: string): Promise<CharacterContract[]>
	fetchContractItems(characterId: string, contractId: string): Promise<CharacterContractItem[]>
	fetchCharacterFittings(characterId: string): Promise<CharacterFitting[]>
	saveCharacterFitting(
		characterId: string,
		fitting: {
			name: string
			description: string
			shipTypeId: string
			items: Array<{ typeId: string; flag: string; quantity: number }>
		}
	): Promise<SaveFittingResponse>
	fetchCharacterLocation(characterId: string): Promise<CharacterLocation>
	fetchCharacterMail(characterId: string): Promise<CharacterMail[]>
	fetchCharacterMailPage(characterId: string, lastMailId?: string): Promise<CharacterMail[]>
	fetchMailContent(characterId: string, mailId: string): Promise<MailContent>
	fetchMailingLists(characterId: string): Promise<MailingList[]>
	fetchMailLabels(characterId: string): Promise<MailLabelsResponse>
	fetchCharacterMiningLedger(characterId: string): Promise<CharacterMiningLedger[]>
	fetchCharacterPlanets(characterId: string): Promise<CharacterPlanet[]>
	fetchCharacterRoles(characterId: string): Promise<CharacterRoles>
	fetchCharacterShip(characterId: string): Promise<CharacterShip>
	fetchCharacterSkillQueue(characterId: string): Promise<CharacterSkillQueue[]>
	fetchCharacterSkills(characterId: string): Promise<CharacterSkills>
	fetchCharacterStandings(characterId: string): Promise<CharacterStanding[]>
	fetchCharacterTitles(characterId: string): Promise<CharacterTitle[]>
	fetchCorporationHistory(characterId: string): Promise<CorporationHistoryEntry[]>
	fetchCharacterMarketOrders(characterId: string): Promise<CharacterMarketOrder[]>
	fetchCharacterMarketTransactions(characterId: string): Promise<CharacterMarketTransaction[]>
	fetchCharacterMarketTransactionsPage(
		characterId: string,
		fromId?: string
	): Promise<CharacterMarketTransaction[]>
	fetchCharacterWalletJournal(characterId: string): Promise<CharacterWalletJournalEntry[]>
	fetchCharacterBasicKillmails(characterId: string): Promise<CharacterKillmailBasic[]>
	fetchCharacterBasicKillmailPage(
		characterId: string,
		page: number
	): Promise<{ data: CharacterKillmailBasic[]; pages: number }>
	fetchCharacterKillmailDetail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<KillmailDetail | null>
	fetchCharacterKillmails(characterId: string): Promise<KillmailDetail[]>
	fetchCharacterClones(characterId: string): Promise<CharacterClones>
	fetchCharacterImplants(characterId: string): Promise<CharacterImplants>
	searchCharacter(
		characterId: string,
		characterName: string,
		strict?: boolean
	): Promise<string[]>

	// Corporation endpoints
	fetchCorporationPublicInfo(corporationId: string): Promise<CorporationPublicInfo>
	fetchCorporationMembers(corporationId: string): Promise<CorporationMembers>
	fetchCorporationMemberRoles(corporationId: string): Promise<CorporationMemberRole[]>
	fetchCorporationMemberTracking(corporationId: string): Promise<CorporationMemberTracking[]>
	fetchCorporationWallets(corporationId: string): Promise<CorporationWallet[]>
	fetchCorporationWalletJournal(
		corporationId: string,
		division: number
	): Promise<CorporationWalletJournalEntry[]>
	fetchCorporationWalletTransactions(
		corporationId: string,
		division: number
	): Promise<CorporationWalletTransaction[]>
	fetchCorporationAssets(corporationId: string): Promise<CorporationAsset[]>
	fetchCorporationStructures(corporationId: string): Promise<CorporationStructure[]>
	fetchCorporationOrders(corporationId: string): Promise<CorporationOrder[]>
	fetchCorporationContracts(corporationId: string): Promise<CorporationContract[]>
	fetchCorporationIndustryJobs(corporationId: string): Promise<CorporationIndustryJob[]>
	fetchCorporationKillmails(corporationId: string): Promise<CorporationKillmail[]>
	fetchCorporationContact(corporationId: string): Promise<CorporationContact[]>
	fetchCorporationDivision(corporationId: string): Promise<CorporationDivision>
	fetchCorporationFacility(corporationId: string): Promise<CorporationFacility[]>
	fetchCorporationIcon(corporationId: string): Promise<CorporationIcon>
	fetchCorporationMedal(corporationId: string): Promise<CorporationMedal[]>
	fetchCorporationRole(corporationId: string): Promise<CorporationRole[]>
	fetchCorporationShareholder(corporationId: string): Promise<CorporationShareholder[]>
	fetchCorporationStanding(corporationId: string): Promise<CorporationStanding[]>
	fetchCorporationTitle(corporationId: string): Promise<CorporationTitle[]>

	// Universe endpoints
	fetchStructureInfo(characterId: string, structureId: string): Promise<StructureInfo | null>

	/**
	 * Fetch insurance prices for all insurable ship types.
	 * Public ESI endpoint — no authentication required.
	 * Returns platinum-tier cost and payout for each ship type.
	 * Cached for 24 hours (insurance prices rarely change).
	 */
	fetchInsurancePrices(): Promise<import('./universe-types').InsurancePlatinumValues[]>

	/**
	 * Fetch CCP's universe-wide average and adjusted prices for all tradeable types.
	 * Public ESI endpoint — no authentication required.
	 * Cached for 24 hours. Returns ~14k entries covering all tradeable items.
	 */
	fetchMarketPrices(): Promise<import('./universe-types').MarketPrice[]>

}

export interface EsiTypeResolver {
	/**
	 * Resolve multiple entity names to IDs
	 * Supports alliances, characters, corporations, systems, etc.
	 * Caches results for future lookups
	 *
	 * @param names - Array of entity names to resolve
	 * @returns Map of name to ID for found entities
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	 * const nameMap = await stub.resolveNames(['Jita', 'Goonswarm Federation'])
	 * // Returns: { 'Jita': '30000142', 'Goonswarm Federation': '1354830081' }
	 * ```
	 */
	resolveNames(names: string[]): Promise<Record<string, string>>

	/**
	 * Resolve multiple entity IDs to names
	 * Supports alliances, characters, corporations, systems, etc.
	 * Caches results for future lookups
	 *
	 * @param ids - Array of entity IDs to resolve
	 * @returns Map of ID to name for found entities
	 *
	 * @example
	 * ```ts
	 * const stub = getStub<EsiTypeResolver>(env.ESI_TYPE_RESOLVER, 'global')
	 * const idMap = await stub.resolveIds(['30000142', '1354830081'])
	 * // Returns: { '30000142': 'Jita', '1354830081': 'Goonswarm Federation' }
	 * ```
	 */
	resolveIds(ids: string[], withCharacterId?: string): Promise<Record<string, string>>
}

/**
 * Get an ESI instance for a given ID
 * @param env - The environment object
 * @param id - The ID of the ESI instance
 * @returns The ESI instance
 */
export const getEsiInstance = (esiBinding: DurableObjectNamespace, id: string) =>
	getStub<Esi>(esiBinding, id)

/**
 * Get an ESI instance for a given character ID
 * @param env - The environment object
 * @param characterId - The ID of the character
 * @returns The ESI instance
 */
export const getEsiInstanceForCharacter = (
	esiBinding: DurableObjectNamespace,
	characterId: string
) => getEsiInstance(esiBinding, characterId)

/**
 * Get an ESI instance for a given corporation ID
 * @param env - The environment object
 * @param corporationId - The ID of the corporation
 * @returns The ESI instance
 */
export const getEsiInstanceForCorporation = (
	esiBinding: DurableObjectNamespace,
	corporationId: string
) => getEsiInstance(esiBinding, corporationId)
