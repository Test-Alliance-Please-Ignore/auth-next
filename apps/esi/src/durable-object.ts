import { DurableObject } from 'cloudflare:workers'

import { logger } from '@repo/hono-helpers'

import { EsiFetcher } from './lib/esi-fetch'
import {
	transformCharacterAgentResearch,
	transformCharacterAsset,
	transformCharacterAttributes,
	transformCharacterBlueprint,
	transformCharacterCalendar,
	transformCharacterContact,
	transformCharacterContract,
	transformCharacterFitting,
	transformCharacterLocation,
	transformCharacterMail,
	transformCharacterMarketOrder,
	transformCharacterMarketTransaction,
	transformCharacterMiningLedger,
	transformCharacterNotifications,
	transformCharacterPlanet,
	transformCharacterPortrait,
	transformCharacterPublicInfo,
	transformCharacterRoles,
	transformCharacterShip,
	transformCharacterSkillQueue,
	transformCharacterSkills,
	transformCharacterStanding,
	transformCharacterTitle,
	transformCharacterWalletJournal,
	transformCorporationAssets,
	transformCorporationContact,
	transformCorporationContracts,
	transformCorporationDivision,
	transformCorporationFacility,
	transformCorporationIcon,
	transformCorporationIndustryJobs,
	transformCorporationKillmails,
	transformCorporationMedal,
	transformCorporationMemberTracking,
	transformCorporationMembers,
	transformCorporationOrders,
	transformCorporationPublicInfo,
	transformCorporationRole,
	transformCorporationShareholder,
	transformCorporationStanding,
	transformCorporationStructures,
	transformCorporationTitle,
	transformCorporationWalletJournal,
	transformCorporationWalletTransactions,
	transformCorporationWallets,
	transformCorporationHistoryEntry,
} from './lib/esi-transforms'
import { createEsiDb, runEsiMigrations } from './storage'

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
	Esi,
	EsiCharacterAgentResearch,
	EsiCharacterAsset,
	EsiCharacterAttributes,
	EsiCharacterBlueprint,
	EsiCharacterCalendar,
	EsiCharacterContact,
	EsiCharacterContract,
	EsiCharacterFitting,
	EsiCharacterLocation,
	EsiCharacterMail,
	EsiCharacterMarketOrder,
	EsiCharacterMarketTransaction,
	EsiCharacterMiningLedger,
	EsiCharacterNotification,
	EsiCharacterPlanet,
	EsiCharacterPortrait,
	EsiCharacterPublicInfo,
	EsiCharacterRoles,
	EsiCharacterShip,
	EsiCharacterSkillQueue,
	EsiCharacterSkills,
	EsiCharacterStanding,
	EsiCharacterTitle,
	EsiCharacterWalletJournalEntry,
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
} from '@repo/esi'
import type { Env } from './context'
import type { EsiDb } from './storage/state'
import { UseCharacterAuth, UseCorporationAuth, UsePublicAuth } from './lib/auth-decorators'

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

		state.blockConcurrencyWhile(async () => {
			await runEsiMigrations(this.storage)
		})
	}

	@UsePublicAuth
	async fetchCharacterPublicInfo(characterId: string): Promise<CharacterPublicInfo> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterPublicInfo>(
			`/characters/${characterId}`
		)
		if (result.data.length === 0) {
			throw new Error(`No character public info found for character ID: ${characterId}`)
		}
		return transformCharacterPublicInfo(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterNotifications(characterId: string): Promise<CharacterNotification[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterNotification>(
			`/characters/${characterId}/notifications`
		)
		return transformCharacterNotifications(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterAgentResearch(characterId: string): Promise<CharacterAgentResearch[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterAgentResearch>(
			`/characters/${characterId}/agents_research`
		)
		return transformCharacterAgentResearch(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterAssets(characterId: string): Promise<CharacterAsset[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterAsset>(
			`/characters/${characterId}/assets`
		)
		return transformCharacterAsset(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterAttributes(characterId: string): Promise<CharacterAttributes> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterAttributes>(
			`/characters/${characterId}/attributes`
		)
		if (result.data.length === 0) {
			throw new Error(`No character attributes found for character ID: ${characterId}`)
		}
		return transformCharacterAttributes(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterBlueprints(characterId: string): Promise<CharacterBlueprint[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterBlueprint>(
			`/characters/${characterId}/blueprints`
		)
		return transformCharacterBlueprint(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterCalendar(characterId: string): Promise<CharacterCalendar[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterCalendar>(
			`/characters/${characterId}/calendar`
		)
		return transformCharacterCalendar(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterContacts(characterId: string): Promise<CharacterContact[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterContact>(
			`/characters/${characterId}/contacts`
		)
		return transformCharacterContact(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterContracts(characterId: string): Promise<CharacterContract[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterContract>(
			`/characters/${characterId}/contracts`
		)
		return transformCharacterContract(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterFittings(characterId: string): Promise<CharacterFitting[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterFitting>(
			`/characters/${characterId}/fittings`
		)
		return transformCharacterFitting(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterLocation(characterId: string): Promise<CharacterLocation> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterLocation>(
			`/characters/${characterId}/location`
		)
		if (result.data.length === 0) {
			throw new Error(`No character location found for character ID: ${characterId}`)
		}
		return transformCharacterLocation(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterMail(characterId: string): Promise<CharacterMail[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMail>(
			`/characters/${characterId}/mail`
		)
		return transformCharacterMail(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMiningLedger(characterId: string): Promise<CharacterMiningLedger[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMiningLedger>(
			`/characters/${characterId}/mining`
		)
		return transformCharacterMiningLedger(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterPlanets(characterId: string): Promise<CharacterPlanet[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterPlanet>(
			`/characters/${characterId}/planets`
		)
		return transformCharacterPlanet(result.data)
	}

	@UsePublicAuth
	async fetchCharacterPortrait(characterId: string): Promise<CharacterPortrait> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterPortrait>(
			`/characters/${characterId}/portrait`
		)
		if (result.data.length === 0) {
			throw new Error(`No character portrait found for character ID: ${characterId}`)
		}
		return transformCharacterPortrait(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterRoles(characterId: string): Promise<CharacterRoles> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterRoles>(
			`/characters/${characterId}/roles`
		)
		if (result.data.length === 0) {
			throw new Error(`No character roles found for character ID: ${characterId}`)
		}
		return transformCharacterRoles(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterShip(characterId: string): Promise<CharacterShip> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterShip>(
			`/characters/${characterId}/ship`
		)
		if (result.data.length === 0) {
			throw new Error(`No character ship found for character ID: ${characterId}`)
		}
		return transformCharacterShip(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterSkillQueue(characterId: string): Promise<CharacterSkillQueue[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterSkillQueue>(
			`/characters/${characterId}/skillqueue`
		)
		return transformCharacterSkillQueue(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterSkills(characterId: string): Promise<CharacterSkills> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterSkills>(
			`/characters/${characterId}/skills`
		)
		if (result.data.length === 0) {
			throw new Error(`No character skills found for character ID: ${characterId}`)
		}
		return transformCharacterSkills(result.data[0])
	}

	@UseCharacterAuth
	async fetchCharacterStandings(characterId: string): Promise<CharacterStanding[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterStanding>(
			`/characters/${characterId}/standings`
		)
		return transformCharacterStanding(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterTitles(characterId: string): Promise<CharacterTitle[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterTitle>(
			`/characters/${characterId}/titles`
		)
		return transformCharacterTitle(result.data)
	}

	@UseCharacterAuth
	async fetchCorporationHistory(characterId: string): Promise<CorporationHistoryEntry[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationHistoryEntry>(
			`/characters/${characterId}/corporationhistory`
		)
		return transformCorporationHistoryEntry(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMarketOrders(characterId: string): Promise<CharacterMarketOrder[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMarketOrder>(
			`/characters/${characterId}/orders`
		)
		return transformCharacterMarketOrder(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterMarketTransactions(
		characterId: string
	): Promise<CharacterMarketTransaction[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterMarketTransaction>(
			`/characters/${characterId}/wallet/transactions`
		)
		return transformCharacterMarketTransaction(result.data)
	}

	@UseCharacterAuth
	async fetchCharacterWalletJournal(characterId: string): Promise<CharacterWalletJournalEntry[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCharacterWalletJournalEntry>(
			`/characters/${characterId}/wallet/journal`
		)
		return transformCharacterWalletJournal(result.data)
	}

	/**
	 * Fetches the current corporation member roster.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns List of members with basic metadata.
	 */
	@UseCorporationAuth
	async fetchCorporationMembers(corporationId: string): Promise<CorporationMembers> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMembers>(
			`/corporations/${corporationId}/members`
		)
		return transformCorporationMembers(result.data)
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMemberTracking>(
			`/corporations/${corporationId}/membertracking`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWallet>(
			`/corporations/${corporationId}/wallets`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWalletJournalEntry>(
			`/corporations/${corporationId}/wallets/${division}/journal`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationWalletTransaction>(
			`/corporations/${corporationId}/wallets/${division}/transactions`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationAsset>(
			`/corporations/${corporationId}/assets`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationStructure>(
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationOrder>(
			`/corporations/${corporationId}/orders`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationContract>(
			`/corporations/${corporationId}/contracts`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationIndustryJob>(
			`/corporations/${corporationId}/industry/jobs`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationKillmail>(
			`/corporations/${corporationId}/killmails/recent`
		)
		return transformCorporationKillmails(result.data)
	}

	/**
	 * Retrieves public corporation information.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Public corporation information.
	 */
	@UsePublicAuth
	async fetchCorporationPublicInfo(corporationId: string): Promise<CorporationPublicInfo> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationPublicInfo>(
			`/corporations/${corporationId}`
		)
		if (result.data.length === 0) {
			throw new Error(`No corporation public info found for corporation ID: ${corporationId}`)
		}
		return transformCorporationPublicInfo(result.data[0])
	}

	/**
	 * Retrieves corporation contacts.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation contacts.
	 */
	@UseCorporationAuth
	async fetchCorporationContact(corporationId: string): Promise<CorporationContact[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationContact>(
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
		if (result.data.length === 0) {
			throw new Error(`No corporation divisions found for corporation ID: ${corporationId}`)
		}
		return transformCorporationDivision(result.data[0])
	}

	/**
	 * Retrieves corporation facilities.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation facilities.
	 */
	@UseCorporationAuth
	async fetchCorporationFacility(corporationId: string): Promise<CorporationFacility[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationFacility>(
			`/corporations/${corporationId}/facilities`
		)
		return transformCorporationFacility(result.data)
	}

	/**
	 * Retrieves corporation icon URLs.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Corporation icon information.
	 */
	@UsePublicAuth
	async fetchCorporationIcon(corporationId: string): Promise<CorporationIcon> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationIcon>(
			`/corporations/${corporationId}/icons`
		)
		if (result.data.length === 0) {
			throw new Error(`No corporation icon found for corporation ID: ${corporationId}`)
		}
		return transformCorporationIcon(result.data[0])
	}

	/**
	 * Retrieves corporation medals.
	 * @param corporationId - The EVE corporation identifier.
	 * @returns Array of corporation medals.
	 */
	@UseCorporationAuth
	async fetchCorporationMedal(corporationId: string): Promise<CorporationMedal[]> {
		const result = await this.esiFetcher.fetchEsi<EsiCorporationMedal>(
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationRole>(
			`/corporations/${corporationId}/roles`
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationShareholder>(
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationStanding>(
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
		const result = await this.esiFetcher.fetchEsi<EsiCorporationTitle>(
			`/corporations/${corporationId}/titles`
		)
		return transformCorporationTitle(result.data)
	}

	/**
	 * Resolves EVE IDs to names via the `/universe/names/` bulk endpoint.
	 * Falls back to cached values stored in Durable Object KV.
	 * @param ids - Array of entity IDs to resolve.
	 * @returns Map of ID to display name for successfully resolved entities.
	 */
	async resolveIds(ids: string[]): Promise<Record<string, string>> {
		if (ids.length === 0) {
			return {}
		}

		const result: Record<string, string> = {}
		const idsToResolve: string[] = []

		// Check cache for each ID (non-critical, failures treated as cache miss)
		for (const id of ids) {
			try {
				const cacheKey = `entity:${id}`
				const cached = this.state.storage.kv.get<string>(cacheKey)

				if (cached !== undefined) {
					result[id] = cached
				} else {
					idsToResolve.push(id)
				}
			} catch (error) {
				// Cache read failure - treat as cache miss
				logger.withTags({ id, operation: 'cache_read' }).warn('Entity cache read failed', error)
				idsToResolve.push(id)
			}
		}

		// If all IDs are cached, return early
		if (idsToResolve.length === 0) {
			return result
		}

		// Fetch from ESI for uncached IDs
		// ESI /universe/names/ has a limit of 1000 IDs per request
		try {
			// Convert string IDs to integers for ESI API
			const integerIds = idsToResolve.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id))

			// If no valid IDs after conversion, return early
			if (integerIds.length === 0) {
				return result
			}

			// Batch size limit for ESI /universe/names/ endpoint
			const BATCH_SIZE = 1000

			// Split into batches if we have more than the limit
			const batches: number[][] = []
			for (let i = 0; i < integerIds.length; i += BATCH_SIZE) {
				batches.push(integerIds.slice(i, i + BATCH_SIZE))
			}

			logger
				.withTags({
					totalIds: integerIds.length,
					batchCount: batches.length,
					batchSize: BATCH_SIZE,
				})
				.info('Resolving IDs from ESI in batches')

			// Process batches in parallel for better performance
			const batchResults = await Promise.all(
				batches.map(async (batch) => {
					const response = await fetch('https://esi.evetech.net/latest/universe/names/', {
						method: 'POST',
						headers: {
							'X-Compatibility-Date': '2025-09-30',
							'Content-Type': 'application/json',
						},
						body: JSON.stringify(batch),
					})

					if (!response.ok) {
						const errorText = await response.text()
						logger
							.withTags({ status: response.status, errorText, batchSize: batch.length })
							.error('ESI ID resolution batch failed')
						return []
					}

					// ESI returns numbers for IDs, but we need strings
					return response.json<Array<{ id: number; name: string; category: string }>>()
				})
			)

			// Flatten all batch results
			const data = batchResults.flat()

			logger
				.withTags({
					resolvedCount: data.length,
					requestedCount: integerIds.length,
				})
				.info('ID resolution completed')

			// Cache the results - character/corp/alliance IDs to names are essentially permanent
			// Names very rarely change, so we store them permanently (Durable Object storage doesn't support expiration)

			for (const entity of data) {
				const entityId = String(entity.id)
				result[entityId] = entity.name

				// Cache the id→name mapping (non-critical, failures should not prevent returning data)
				try {
					const cacheKey = `entity:${entityId}`
					this.state.storage.kv.put(cacheKey, entity.name)
				} catch (error) {
					// Cache write failure - log but don't fail the request
					logger
						.withTags({ entityName: entity.name, entityId, operation: 'cache_write' })
						.warn('Entity cache write failed', error)
				}
			}

			return result
		} catch (error) {
			logger.error(error)
			return result
		}
	}
}
