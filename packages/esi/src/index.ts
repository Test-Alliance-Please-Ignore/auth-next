import { getStub } from '@repo/do-utils'

import type {
	CharacterAgentResearch,
	CharacterAsset,
	CharacterAttributes,
	CharacterBlueprint,
	CharacterCalendar,
	CharacterContact,
	CharacterContract,
	CharacterFitting,
	CharacterLocation,
	CharacterMail,
	MailContent,
	CharacterMarketOrder,
	CharacterMarketTransaction,
	CharacterMiningLedger,
	CharacterNotification,
	CharacterPlanet,
	CharacterPortrait,
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
	// Character endpoints
	fetchCharacterPublicInfo(characterId: string): Promise<CharacterPublicInfo>
	fetchCharacterNotifications(characterId: string): Promise<CharacterNotification[]>
	fetchCharacterAgentResearch(characterId: string): Promise<CharacterAgentResearch[]>
	fetchCharacterAssets(characterId: string): Promise<CharacterAsset[]>
	fetchCharacterAttributes(characterId: string): Promise<CharacterAttributes>
	fetchCharacterBlueprints(characterId: string): Promise<CharacterBlueprint[]>
	fetchCharacterCalendar(characterId: string): Promise<CharacterCalendar[]>
	fetchCharacterContacts(characterId: string): Promise<CharacterContact[]>
	fetchCharacterContracts(characterId: string): Promise<CharacterContract[]>
	fetchCharacterFittings(characterId: string): Promise<CharacterFitting[]>
	fetchCharacterLocation(characterId: string): Promise<CharacterLocation>
	fetchCharacterMail(characterId: string): Promise<CharacterMail[]>
	fetchMailContent(characterId: string, mailId: string): Promise<MailContent>
	fetchCharacterMiningLedger(characterId: string): Promise<CharacterMiningLedger[]>
	fetchCharacterPlanets(characterId: string): Promise<CharacterPlanet[]>
	fetchCharacterPortrait(characterId: string): Promise<CharacterPortrait>
	fetchCharacterRoles(characterId: string): Promise<CharacterRoles>
	fetchCharacterShip(characterId: string): Promise<CharacterShip>
	fetchCharacterSkillQueue(characterId: string): Promise<CharacterSkillQueue[]>
	fetchCharacterSkills(characterId: string): Promise<CharacterSkills>
	fetchCharacterStandings(characterId: string): Promise<CharacterStanding[]>
	fetchCharacterTitles(characterId: string): Promise<CharacterTitle[]>
	fetchCorporationHistory(characterId: string): Promise<CorporationHistoryEntry[]>
	fetchCharacterMarketOrders(characterId: string): Promise<CharacterMarketOrder[]>
	fetchCharacterMarketTransactions(characterId: string): Promise<CharacterMarketTransaction[]>
	fetchCharacterWalletJournal(characterId: string): Promise<CharacterWalletJournalEntry[]>

	// Corporation endpoints
	fetchCorporationPublicInfo(corporationId: string): Promise<CorporationPublicInfo>
	fetchCorporationMembers(corporationId: string): Promise<CorporationMembers>
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
}

export interface EsiTypeResolver {
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
