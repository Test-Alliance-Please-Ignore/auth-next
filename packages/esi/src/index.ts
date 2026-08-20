import { forDO } from '@repo/do-utils'

import type { EsiGetStructureMarketDataResponseObject, KillmailDetail } from '@repo/universe'
import type { EsiCorporationAsset } from './corporation-types'
import type { EsiResponse, EsiResult } from './request'
import type {
	EsiCorporationMiningExtraction,
	EsiCorporationSkyhookDetail,
	EsiCorporationSkyhookListingResponse,
	EsiSovereigntyHubDetail,
	EsiSovereigntyHubListingResponse,
	EsiSovereigntySystemsResponse,
} from './structure-types'
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
	CharacterFleetInformation,
	CharacterImplants,
	CharacterKillmailBasic,
	CharacterLocation,
	CharacterMail,
	CharacterMarketOrder,
	CharacterMarketTransaction,
	CharacterMiningLedger,
	CharacterNotification,
	CharacterOnlineStatus,
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
	EsiCharacterSearchResponse,
	EsiMarketOrder,
	EsiUniverseConstellation,
	EsiUniverseSolarSystem,
	EsiUniverseStation,
	EsiUniverseType,
	FleetInformation,
	FleetMembers,
	MailContent,
	MailingList,
	MailLabelsResponse,
	SaveFittingResponse,
	StructureInfo,
} from './types'
import type { InsurancePlatinumValues, MarketPrice } from './universe-types'

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
	maxRetries?: number
	timeoutMs?: number
	compatibilityDate?: string
	includeVersionPath?: boolean
}

/** Compact result for a domain-owned watermark traversal. */
export interface EsiWatermarkPageResult<T> {
	data: T[]
	pages: number
	pagesFetched: number
	stoppedAtWatermark: boolean
}

/**
 * Fixed physical shard count for authenticated ESI traffic.
 *
 * Changing either value changes routing and creates a new set of Durable
 * Objects, so these values are intentionally source-controlled rather than
 * configurable per deployment.
 */
export const ESI_AUTH_SHARD_COUNT = 16
export const ESI_AUTH_SHARD_PREFIX = 'esi-auth'

/**
 * Canonical EVE entity IDs are positive decimal integers. Keeping this
 * normalization at the routing boundary prevents duplicate shard, cache, and
 * rate-limit identities for the same character or corporation.
 */
export function canonicalizeEsiEntityId(
	value: string | number,
	entityType: 'character' | 'corporation'
): string {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new TypeError(`Invalid ESI ${entityType} ID`)
		}
		return String(value)
	}

	const id = value.trim()
	if (!/^[1-9]\d*$/.test(id)) {
		throw new TypeError(`Invalid ESI ${entityType} ID`)
	}
	return id
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
 * import { getPublicEsiInstance } from '@repo/esi'
 *
 * const stub = getPublicEsiInstance(env.ESI)
 * const members = await stub.fetchCorporationMembers(corporationId)
 * ```
 */
export interface Esi {
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
	fetchCharacterNotifications(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterNotification[]>
	fetchCharacterAgentResearch(characterId: string): Promise<CharacterAgentResearch[]>
	fetchCharacterAssets(characterId: string, options?: EsiRequestOptions): Promise<CharacterAsset[]>
	fetchCharacterAssetNames(
		characterId: string,
		itemIds: string[],
		options?: EsiRequestOptions
	): Promise<CharacterAssetName[]>
	fetchCharacterAttributes(characterId: string): Promise<CharacterAttributes>
	fetchCharacterBlueprints(characterId: string): Promise<CharacterBlueprint[]>
	fetchCharacterCalendar(characterId: string): Promise<CharacterCalendar[]>
	fetchCharacterContacts(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterContact[]>
	fetchCharacterContracts(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterContract[]>
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
	fetchCharacterOnlineStatus(characterId: string): Promise<CharacterOnlineStatus>
	fetchCharacterMail(characterId: string, options?: EsiRequestOptions): Promise<CharacterMail[]>
	fetchCharacterMailPage(
		characterId: string,
		lastMailId?: string,
		options?: EsiRequestOptions
	): Promise<CharacterMail[]>
	fetchMailContent(
		characterId: string,
		mailId: string,
		options?: EsiRequestOptions
	): Promise<MailContent>
	fetchMailingLists(characterId: string, options?: EsiRequestOptions): Promise<MailingList[]>
	fetchMailLabels(characterId: string, options?: EsiRequestOptions): Promise<MailLabelsResponse>
	fetchCharacterMiningLedger(characterId: string): Promise<CharacterMiningLedger[]>
	fetchCharacterPlanets(characterId: string): Promise<CharacterPlanet[]>
	fetchCharacterRoles(characterId: string, options?: EsiRequestOptions): Promise<CharacterRoles>
	fetchCharacterShip(characterId: string): Promise<CharacterShip>
	fetchCharacterSkillQueue(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterSkillQueue[]>
	fetchCharacterSkills(characterId: string, options?: EsiRequestOptions): Promise<CharacterSkills>
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
	fetchCharacterWalletJournalUntilWatermark(
		characterId: string,
		watermark: { maxId: string | null; maxDate: string | null }
	): Promise<EsiWatermarkPageResult<CharacterWalletJournalEntry>>
	fetchCharacterWalletBalance(characterId: string): Promise<number>
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
	fetchCharacterFleetInformation(
		characterId: string
	): Promise<EsiResponse<CharacterFleetInformation>>
	fetchFleetInformation(
		characterId: string,
		fleetId: string
	): Promise<EsiResponse<FleetInformation>>
	fetchFleetMembers(characterId: string, fleetId: string): Promise<EsiResponse<FleetMembers>>
	inviteFleetMember(characterId: string, fleetId: string, memberCharacterId: string): Promise<void>
	kickFleetMember(characterId: string, fleetId: string, memberCharacterId: string): Promise<void>
	fetchCharacterClones(characterId: string, options?: EsiRequestOptions): Promise<CharacterClones>
	fetchCharacterImplants(
		characterId: string,
		options?: EsiRequestOptions
	): Promise<CharacterImplants>
	searchCharacter(characterId: string, characterName: string, strict?: boolean): Promise<string[]>

	// Corporation endpoints
	fetchCorporationPublicInfo(corporationId: string): Promise<CorporationPublicInfo>
	fetchAlliancePublicInfo(allianceId: string): Promise<AlliancePublicInfo>
	fetchCorporationMembers(corporationId: string): Promise<CorporationMembers>
	fetchCorporationMemberRoles(corporationId: string): Promise<CorporationMemberRole[]>
	fetchCorporationMemberTracking(corporationId: string): Promise<CorporationMemberTracking[]>
	fetchCorporationWallets(corporationId: string): Promise<CorporationWallet[]>
	fetchCorporationWalletJournal(
		corporationId: string,
		division: number
	): Promise<CorporationWalletJournalEntry[]>
	fetchCorporationWalletJournalUntilWatermark(
		corporationId: string,
		division: number,
		watermark: { maxId: string | null; maxDate: string | null }
	): Promise<EsiWatermarkPageResult<CorporationWalletJournalEntry>>
	fetchCorporationWalletTransactions(
		corporationId: string,
		division: number
	): Promise<CorporationWalletTransaction[]>
	fetchCorporationWalletTransactionsPage(
		corporationId: string,
		division: number,
		fromId?: string
	): Promise<CorporationWalletTransaction[]>
	fetchCorporationAssets(corporationId: string): Promise<CorporationAsset[]>
	fetchCorporationAssetsPage(
		corporationId: string,
		page: number
	): Promise<EsiResult<EsiCorporationAsset[]>>
	fetchCorporationStructures(corporationId: string): Promise<CorporationStructure[]>
	fetchCorporationSovereigntyHubsPage(
		corporationId: string,
		page: number
	): Promise<EsiResult<EsiSovereigntyHubListingResponse>>
	fetchCorporationSovereigntyHubDetail(
		corporationId: string,
		structureId: string
	): Promise<EsiSovereigntyHubDetail>
	fetchCorporationSkyhooksPage(
		corporationId: string,
		page: number
	): Promise<EsiResult<EsiCorporationSkyhookListingResponse>>
	fetchCorporationSkyhookDetail(
		corporationId: string,
		structureId: string
	): Promise<EsiCorporationSkyhookDetail>
	fetchCorporationMiningExtractions(
		corporationId: string
	): Promise<EsiCorporationMiningExtraction[]>
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
	fetchStructureMarketOrdersPage(
		characterId: string,
		structureId: string,
		page: number
	): Promise<EsiResult<EsiGetStructureMarketDataResponseObject[]>>
	fetchCharacterSearch(
		characterId: string,
		input: {
			categories: Array<'solar_system' | 'station' | 'structure'>
			search: string
			strict?: boolean
		}
	): Promise<EsiCharacterSearchResponse>
	fetchUniverseSolarSystemIds(): Promise<number[]>
	fetchUniverseSolarSystem(systemId: string): Promise<EsiUniverseSolarSystem>
	fetchUniverseConstellation(constellationId: string): Promise<EsiUniverseConstellation>
	fetchUniverseStation(stationId: string): Promise<EsiUniverseStation>
	fetchUniverseType(typeId: string): Promise<EsiUniverseType>
	openContractWindow(characterId: string, contractId: string): Promise<EsiResult<null>>
	fetchRegionMarketOrdersPage(regionId: string, page: number): Promise<EsiResult<EsiMarketOrder[]>>

	/**
	 * Fetch insurance prices for all insurable ship types.
	 * Public ESI endpoint — no authentication required.
	 * Returns platinum-tier cost and payout for each ship type.
	 * Cached for 24 hours (insurance prices rarely change).
	 */
	fetchInsurancePrices(): Promise<InsurancePlatinumValues[]>

	/**
	 * Fetch CCP's universe-wide average and adjusted prices for all tradeable types.
	 * Public ESI endpoint — no authentication required.
	 * Cached for 24 hours. Returns ~14k entries covering all tradeable items.
	 */
	fetchMarketPrices(): Promise<MarketPrice[]>
	fetchSovereigntySystems(): Promise<EsiSovereigntySystemsResponse>
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
 * Get the singleton used for public ESI calls.
 */
export const getPublicEsiInstance = (esiBinding: DurableObjectNamespace) =>
	forDO<Esi>(esiBinding).singleton()

/**
 * Get an ESI instance for a given character ID
 * @param env - The environment object
 * @param characterId - The ID of the character
 * @returns The ESI instance
 */
export const getEsiInstanceForCharacter = (
	esiBinding: DurableObjectNamespace,
	characterId: string
) =>
	forDO<Esi>(esiBinding)
		.sharded({ shards: ESI_AUTH_SHARD_COUNT, prefix: ESI_AUTH_SHARD_PREFIX })
		.forKey(`character:${canonicalizeEsiEntityId(characterId, 'character')}`)

/**
 * Get an ESI instance for a given corporation ID
 * @param env - The environment object
 * @param corporationId - The ID of the corporation
 * @returns The ESI instance
 */
export const getEsiInstanceForCorporation = (
	esiBinding: DurableObjectNamespace,
	corporationId: string
) =>
	forDO<Esi>(esiBinding)
		.sharded({ shards: ESI_AUTH_SHARD_COUNT, prefix: ESI_AUTH_SHARD_PREFIX })
		.forKey(`corporation:${canonicalizeEsiEntityId(corporationId, 'corporation')}`)
