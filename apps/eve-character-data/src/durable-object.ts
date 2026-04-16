import { DurableObject } from 'cloudflare:workers'

import { and, desc, eq, gte, ilike, inArray, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { EveCharacterDataInstance, killmailsSchema } from '@repo/eve-character-data'
import { createEveAllianceId, createEveCharacterId, createEveCorporationId } from '@repo/eve-types'

import { createDb } from './db'
import {
	characterAssets,
	characterAttributes,
	characterCorporationHistory,
	characterKillmails,
	characterLocation,
	characterMarketOrders,
	characterMarketTransactions,
	characterPublicInfo,
	characterSkillQueue,
	characterSkills,
	characterStatus,
	characterWallet,
	characterWalletJournal,
} from './db/schema'

import type {
	CharacterAttributesData,
	CharacterCorporationHistoryData,
	CharacterKillmailData,
	CharacterLossData,
	CharacterMarketOrderData,
	CharacterMarketTransactionData,
	CharacterMarketTransactionsWindowFilters,
	CharacterPublicData,
	CharacterSensitiveData,
	CharacterSkillsData,
	CharacterSkillsResponse,
	CharacterWalletJournalData,
	CharacterWalletJournalWindowFilters,
	CharacterWalletSyncHealth,
	EsiCharacterAttributes,
	EsiCharacterPublicInfo,
	EsiCharacterRoles,
	EsiCharacterSkills,
	EsiCorporationHistoryEntry,
	EsiMarketOrder,
	EsiMarketTransaction,
	EsiWalletJournalEntry,
	EveCharacterData,
	Killmails,
} from '@repo/eve-character-data'
import type { EsiCharacterAffiliation, EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'

/**
 * EveCharacterData Durable Object
 *
 * This Durable Object stores character data from ESI in PostgreSQL
 * Uses eve-token-store as ESI gateway for fetching data
 */
export class EveCharacterDataDO extends DurableObject<Env> implements EveCharacterData {
	private db: ReturnType<typeof createDb>

	private extractDbErrorDetails(error: unknown): Record<string, unknown> {
		if (!error || typeof error !== 'object') {
			return { rawError: String(error) }
		}

		const e = error as Record<string, unknown>
		return {
			name: e.name,
			message: e.message,
			code: e.code,
			detail: e.detail,
			hint: e.hint,
			constraint: e.constraint,
			table: e.table,
			column: e.column,
			schema: e.schema,
			severity: e.severity,
			where: e.where,
			routine: e.routine,
			stack: e.stack,
			cause: e.cause,
		}
	}

	private logDbOperationError(
		operation: string,
		characterId: string,
		error: unknown,
		context?: Record<string, unknown>
	): void {
		console.error('[EveCharacterDataDO] Database operation failed', {
			operation,
			characterId,
			...context,
			error: this.extractDbErrorDetails(error),
		})
	}
	/**
	 * Initialize the Durable Object
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	async getInstance(characterId: string): Promise<EveCharacterDataInstance> {
		return new EveCharacterDataInstance(this, createEveCharacterId(characterId))
	}

	/**
	 * Get killmails for a character from the database
	 * @param characterId - EVE character ID
	 * @param limit - Maximum number of killmails to return (default: 100)
	 * @returns Array of killmail data
	 */
	async getKillmails(characterId: string, limit = 100): Promise<Killmails> {
		const results = await this.db.query.characterKillmails.findMany({
			where: eq(characterKillmails.characterId, characterId),
			orderBy: desc(characterKillmails.killmailTime),
			limit,
		})

		return results.map((r) => ({
			killmailId: r.killmailId,
			killmailHash: r.killmailHash,
		}))
	}

	/**
	 * Fetch detailed killmail data from ESI and store it
	 * @param killmailId - Killmail ID
	 * @param killmailHash - Killmail hash
	 * @param characterId - Character ID (to determine if this is a loss)
	 * @returns Detailed killmail data
	 */
	async fetchKillmailDetails(
		killmailId: string,
		killmailHash: string,
		characterId: string
	): Promise<CharacterKillmailData | null> {
		try {
			console.log(`[fetchKillmailDetails] Fetching details for killmail ${killmailId}`)

			// Fetch killmail details from ESI (public endpoint, no auth required)
			const url = `https://esi.evetech.net/latest/killmails/${killmailId}/${killmailHash}/?datasource=tranquility`
			console.log(`[fetchKillmailDetails] URL: ${url}`)

			const response = await fetch(url)

			console.log(
				`[fetchKillmailDetails] ESI response status: ${response.status} for killmail ${killmailId}`
			)

			if (!response.ok) {
				console.error(
					`[fetchKillmailDetails] Failed to fetch killmail ${killmailId}: ${response.status} ${response.statusText}`
				)
				const errorText = await response.text()
				console.error(`[fetchKillmailDetails] Error response body:`, errorText)
				return null
			}

			const killmailData = (await response.json()) as {
				killmail_time: string
				solar_system_id: number
				victim: {
					character_id?: number
					ship_type_id: number
					damage_taken: number
				}
				zkb?: {
					totalValue?: number
				}
			}

			console.log(`[fetchKillmailDetails] Parsed killmail data for ${killmailId}:`, {
				killmail_time: killmailData.killmail_time,
				solar_system_id: killmailData.solar_system_id,
				victim_character_id: killmailData.victim.character_id,
				ship_type_id: killmailData.victim.ship_type_id,
			})

			// Determine if this character was the victim (loss) or attacker (kill)
			const victimCharId = killmailData.victim.character_id?.toString()
			const isLoss = victimCharId === characterId

			console.log(
				`[fetchKillmailDetails] Character ${characterId}, Victim ${victimCharId}, isLoss: ${isLoss}`
			)

			// Extract ISK value - try zkb data first, fallback to 0
			let totalValue = '0'
			if (killmailData.zkb?.totalValue) {
				totalValue = killmailData.zkb.totalValue.toString()
			}

			console.log(`[fetchKillmailDetails] Total value: ${totalValue}`)

			// Resolve ship type name and solar system name
			console.log(`[fetchKillmailDetails] Resolving ship type and solar system names`)
			const tokenStoreStub = getStub<any>(this.env.EVE_TOKEN_STORE, 'default')
			const idsToResolve = [
				killmailData.victim.ship_type_id.toString(),
				killmailData.solar_system_id.toString(),
			]
			const resolved = await tokenStoreStub.resolveIds(idsToResolve)

			const shipTypeName = resolved[killmailData.victim.ship_type_id.toString()] || null
			const solarSystemName = resolved[killmailData.solar_system_id.toString()] || null

			console.log(
				`[fetchKillmailDetails] Resolved names - Ship: ${shipTypeName}, System: ${solarSystemName}`
			)

			// Store or update the killmail with detailed data
			const killmailTime = new Date(killmailData.killmail_time)

			console.log(`[fetchKillmailDetails] Inserting/updating killmail ${killmailId} in database`)

			const result = await this.db
				.insert(characterKillmails)
				.values({
					characterId: String(characterId),
					killmailId: String(killmailId),
					killmailHash: String(killmailHash),
					killmailTime,
					isLoss,
					shipTypeId: killmailData.victim.ship_type_id.toString(),
					shipTypeName,
					totalValue,
					solarSystemId: killmailData.solar_system_id.toString(),
					solarSystemName,
					victimCharacterId: victimCharId ?? null,
					killmailData: killmailData as unknown,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterKillmails.characterId, characterKillmails.killmailId],
					set: {
						killmailHash: sql`excluded.killmail_hash`,
						killmailTime: sql`excluded.killmail_time`,
						isLoss: sql`excluded.is_loss`,
						shipTypeId: sql`excluded.ship_type_id`,
						shipTypeName: sql`excluded.ship_type_name`,
						totalValue: sql`excluded.total_value`,
						solarSystemId: sql`excluded.solar_system_id`,
						solarSystemName: sql`excluded.solar_system_name`,
						victimCharacterId: sql`excluded.victim_character_id`,
						killmailData: sql`excluded.killmail_data`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
				.returning()

			console.log(
				`[fetchKillmailDetails] Successfully stored killmail ${killmailId}, DB ID: ${result[0].id}`
			)

			return {
				id: result[0].id,
				characterId: createEveCharacterId(result[0].characterId),
				killmailId: result[0].killmailId,
				killmailHash: result[0].killmailHash,
				killmailTime: result[0].killmailTime,
				isLoss: result[0].isLoss,
				shipTypeId: result[0].shipTypeId,
				totalValue: result[0].totalValue,
				solarSystemId: result[0].solarSystemId,
				victimCharacterId: result[0].victimCharacterId,
				killmailData: result[0].killmailData,
				updatedAt: result[0].updatedAt,
			}
		} catch (error) {
			console.error(
				`[fetchKillmailDetails] Error fetching killmail details for ${killmailId}:`,
				error
			)
			console.error(
				`[fetchKillmailDetails] Error stack:`,
				error instanceof Error ? error.stack : 'No stack'
			)
			return null
		}
	}

	/**
	 * Get recent losses for a character (last N days)
	 * Filters to only losses where the character was the victim
	 * @param characterId - Character ID
	 * @param daysBack - Number of days to look back (default: 30)
	 * @param excludeNonSrpEligible - If true, exclude ships like pods and shuttles that typically aren't SRP eligible (default: false)
	 * @returns Array of loss data
	 */
	async getRecentLosses(
		characterId: string,
		daysBack = 30,
		excludeNonSrpEligible = false
	): Promise<CharacterLossData[]> {
		const cutoffDate = new Date()
		cutoffDate.setDate(cutoffDate.getDate() - daysBack)

		// Ship type IDs that are typically not SRP eligible
		const nonSrpEligibleShipTypes = [
			'670', // Capsule (pod)
			'33328', // Capsule - Genolution 'Auroral' 197-variant
			'672', // Shuttle
			'11129', // Novice
			'588', // Ibis (Caldari rookie)
			'606', // Velator (Gallente rookie)
			'596', // Reaper (Minmatar rookie)
			'601', // Impairor (Amarr rookie)
			'85230', // Mercenary Den
		]

		const results = await this.db.query.characterKillmails.findMany({
			where: and(
				eq(characterKillmails.characterId, characterId),
				eq(characterKillmails.isLoss, true),
				gte(characterKillmails.killmailTime, cutoffDate)
			),
			orderBy: desc(characterKillmails.killmailTime),
		})

		return results
			.filter((r) => r.shipTypeId && r.totalValue && r.solarSystemId && r.victimCharacterId)
			.filter(
				(r) => !excludeNonSrpEligible || !nonSrpEligibleShipTypes.includes(r.shipTypeId as string)
			)
			.map((r) => ({
				killmailId: r.killmailId,
				killmailHash: r.killmailHash,
				killmailTime: r.killmailTime,
				shipTypeId: r.shipTypeId as string,
				shipTypeName: r.shipTypeName ?? undefined,
				totalValue: r.totalValue as string,
				solarSystemId: r.solarSystemId as string,
				solarSystemName: r.solarSystemName ?? undefined,
				victimCharacterId: r.victimCharacterId as string,
			}))
	}

	/**
	 * Fetch and store all public character data
	 */
	async fetchCharacterData(characterId: string, forceRefresh = false): Promise<void> {
		console.log(
			'EveCharacterData.fetchCharacterData called with:',
			characterId,
			'type:',
			typeof characterId,
			'forceRefresh:',
			forceRefresh
		)
		try {
			await this.fetchAndStorePublicInfo(characterId, forceRefresh)
			await this.fetchAndStoreCorporationHistory(characterId, forceRefresh)
			console.log('EveCharacterData.fetchCharacterData completed successfully')
		} catch (error) {
			console.error('EveCharacterData.fetchCharacterData failed:', error)
			throw error
		}
	}

	/**
	 * Store pre-fetched public info without making an ESI call.
	 * Used by the user-refresh workflow which already has the data.
	 * Accepts string or number IDs to work with both @repo/esi and raw ESI response shapes.
	 */
	async storePublicInfo(characterId: string, data: EsiCharacterPublicInfo): Promise<void> {
		const values = {
			characterId,
			name: data.name,
			corporationId: String(data.corporation_id),
			allianceId: data.alliance_id ? String(data.alliance_id) : null,
			birthday: data.birthday,
			raceId: String(data.race_id),
			bloodlineId: String(data.bloodline_id),
			securityStatus: data.security_status ? Number(data.security_status) : undefined,
			description: data.description,
			gender: data.gender,
			factionId: data.faction_id ? String(data.faction_id) : null,
			title: data.title,
			updatedAt: new Date(),
		}

		await this.db.insert(characterPublicInfo).values(values).onConflictDoUpdate({
			target: characterPublicInfo.characterId,
			set: values,
		})
	}

	/**
	 * Fetch and store corporation history from ESI (public method).
	 */
	async fetchCorporationHistory(characterId: string): Promise<void> {
		await this.fetchAndStoreCorporationHistory(characterId)
	}

	/**
	 * Fetch and store authenticated character data
	 */
	async fetchAuthenticatedData(characterId: string, forceRefresh = false): Promise<void> {
		// Authenticated tables reference character_public_info via FK.
		// Ensure the parent row exists for authenticated-only sync runs.
		let existingPublicInfo: { characterId: string } | undefined
		try {
			existingPublicInfo = await this.db.query.characterPublicInfo.findFirst({
				where: eq(characterPublicInfo.characterId, characterId),
				columns: { characterId: true },
			})
		} catch (error) {
			this.logDbOperationError('fetchAuthenticatedData.lookupPublicInfo', characterId, error)
			throw error
		}
		if (!existingPublicInfo) {
			try {
				await this.fetchAndStorePublicInfo(characterId, forceRefresh)
			} catch (error) {
				this.logDbOperationError('fetchAuthenticatedData.bootstrapPublicInfo', characterId, error)
				throw error
			}
		}

		await Promise.all([
			this.fetchAndStoreSkills(characterId, forceRefresh),
			this.fetchAndStoreAttributes(characterId, forceRefresh),
			this.fetchAndStoreWallet(characterId, forceRefresh),
		])
	}

	/**
	 * Fetch and store wallet journal entries
	 */
	async fetchWalletJournal(characterId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreWalletJournal(characterId, forceRefresh)
	}

	/**
	 * Fetch and store market transactions
	 */
	async fetchMarketTransactions(characterId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreMarketTransactions(characterId, forceRefresh)
	}

	/**
	 * Fetch and store market orders
	 */
	async fetchMarketOrders(characterId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreMarketOrders(characterId, forceRefresh)
	}

	/**
	 * Fetch and store character location on-demand (requires token)
	 * Called when the character detail page loads, not during daily sync
	 */
	async fetchLocation(characterId: string): Promise<void> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const response = await tokenStoreStub.fetchEsi<{
			solar_system_id: number
			station_id?: number
			structure_id?: number
		}>(`/characters/${String(characterId)}/location`, String(characterId))

		const solarSystemId = String(response.data.solar_system_id)
		const stationId = response.data.station_id ? String(response.data.station_id) : null
		const structureId = response.data.structure_id ? String(response.data.structure_id) : null

		try {
			await this.db
				.insert(characterLocation)
				.values({
					characterId,
					solarSystemId,
					stationId,
					structureId,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: characterLocation.characterId,
					set: {
						solarSystemId,
						stationId,
						structureId,
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			this.logDbOperationError('fetchLocation.upsert', characterId, error)
			throw error
		}
	}

	/**
	 * Fetch and store character online status on-demand (requires token)
	 * Called when the character detail page loads, not during daily sync
	 */
	async fetchStatus(characterId: string): Promise<void> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const response = await tokenStoreStub.fetchEsi<{
			last_login?: string
			last_logout?: string
			logins?: number
			online: boolean
		}>(`/characters/${String(characterId)}/online`, String(characterId))

		const { online, last_login, last_logout, logins } = response.data

		try {
			await this.db
				.insert(characterStatus)
				.values({
					characterId,
					online,
					lastLogin: last_login ? new Date(last_login) : null,
					lastLogout: last_logout ? new Date(last_logout) : null,
					loginsCount: logins ?? 0,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: characterStatus.characterId,
					set: {
						online,
						lastLogin: last_login ? new Date(last_login) : null,
						lastLogout: last_logout ? new Date(last_logout) : null,
						loginsCount: logins ?? 0,
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			this.logDbOperationError('fetchStatus.upsert', characterId, error)
			throw error
		}
	}

	/**
	 * Fetch character corporation roles
	 * Returns null if the character doesn't have the required scope or an error occurs
	 */
	async fetchCorporationRoles(
		characterId: string,
		_forceRefresh = false
	): Promise<EsiCharacterRoles | null> {
		try {
			const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
			const response: EsiResponse<EsiCharacterRoles> = await tokenStoreStub.fetchEsi(
				`/characters/${String(characterId)}/roles`,
				String(characterId)
			)

			return response.data
		} catch (error) {
			// If the character doesn't have the required scope or token is invalid, return null
			console.error(
				`Failed to fetch corporation roles for character ${characterId}:`,
				error instanceof Error ? error.message : String(error)
			)
			return null
		}
	}

	/**
	 * Get character public info from database
	 */
	async getCharacterInfo(characterId: string): Promise<CharacterPublicData | null> {
		const result = await this.db.query.characterPublicInfo.findFirst({
			where: eq(characterPublicInfo.characterId, characterId),
		})

		if (!result) {
			return null
		}

		return {
			characterId: createEveCharacterId(result.characterId),
			name: result.name,
			corporationId: createEveCorporationId(result.corporationId),
			allianceId: createEveAllianceId(result.allianceId ?? ''),
			birthday: result.birthday,
			raceId: result.raceId,
			bloodlineId: result.bloodlineId,
			securityStatus: result.securityStatus ?? undefined,
			description: result.description ?? undefined,
			gender: result.gender,
			factionId: result.factionId ?? undefined,
			title: result.title ?? undefined,
			createdAt: result.createdAt,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Search for a character by name (case-insensitive)
	 * Tries local database first, falls back to ESI search if not found
	 */
	async searchCharacterByName(characterName: string, exact = true): Promise<string | null> {
		if (!characterName.trim()) {
			return null
		}

		// Try local database first (case-insensitive)
		const dbResult = await this.db.query.characterPublicInfo.findFirst({
			where: exact
				? ilike(characterPublicInfo.name, characterName)
				: ilike(characterPublicInfo.name, `%${characterName}%`),
			columns: {
				characterId: true,
			},
		})

		if (dbResult) {
			return dbResult.characterId
		}

		// Fall back to ESI search
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		const characterIds = await tokenStoreStub.searchCharacter(characterName, exact)

		if (characterIds.length === 0) {
			return null
		}

		// Take the first result (ESI search should return exact match first when strict=true)
		const characterId = characterIds[0]

		// Fetch and cache the character data for future lookups
		try {
			await this.fetchCharacterData(characterId, false)
		} catch (error) {
			// If we can't fetch character data, still return the ID
			// The error will be logged by fetchCharacterData
		}

		return characterId
	}

	/**
	 * Get when character data was last updated
	 */
	async getLastUpdated(characterId: string): Promise<Date | null> {
		const result = await this.db.query.characterPublicInfo.findFirst({
			where: eq(characterPublicInfo.characterId, characterId),
			columns: {
				updatedAt: true,
			},
		})

		return result?.updatedAt ?? null
	}

	/**
	 * Fetch and store public character info
	 */
	private async fetchAndStorePublicInfo(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterPublicData> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		// Fetch public info and affiliation in parallel. Affiliation has a shorter ESI
		// cache (~1h vs 24h) so we prefer it for corporation_id/alliance_id when available.
		const [publicInfoResponse, affiliationResponse] = await Promise.allSettled([
			tokenStoreStub.fetchEsi<{
				alliance_id?: number
				birthday: string
				bloodline_id: number
				corporation_id: number
				description?: string
				faction_id?: number
				gender: 'male' | 'female'
				name: string
				race_id: number
				security_status?: number
				title?: string
			}>(`/characters/${String(characterId)}`, String(characterId)),
			tokenStoreStub.fetchCharacterAffiliations([characterId]),
		])

		if (publicInfoResponse.status === 'rejected') {
			throw publicInfoResponse.reason
		}

		const rawData = publicInfoResponse.value.data

		// Convert numeric IDs to strings
		const data: EsiCharacterPublicInfo = {
			...rawData,
			alliance_id: rawData.alliance_id ?? undefined,
			bloodline_id: rawData.bloodline_id,
			corporation_id: rawData.corporation_id,
			faction_id: rawData.faction_id ?? undefined,
			race_id: rawData.race_id,
		}

		// Prefer affiliation data for corporation/alliance — shorter ESI cache means fresher data.
		let corporationId = String(data.corporation_id)
		let allianceId = data.alliance_id ? String(data.alliance_id) : null

		if (affiliationResponse.status === 'fulfilled') {
			const affiliations = (affiliationResponse.value as EsiResponse<EsiCharacterAffiliation[]>).data
			const affiliation = affiliations.find((a) => a.character_id === parseInt(characterId, 10))
			if (affiliation) {
				corporationId = String(affiliation.corporation_id)
				allianceId = affiliation.alliance_id ? String(affiliation.alliance_id) : null
			}
		}

		// Upsert to database
		try {
			await this.db
				.insert(characterPublicInfo)
				.values({
					characterId,
					name: data.name,
					corporationId,
					allianceId,
					birthday: data.birthday,
					raceId: String(data.race_id),
					bloodlineId: String(data.bloodline_id),
					securityStatus: data.security_status ? Number(data.security_status) : undefined,
					description: data.description,
					gender: data.gender,
					factionId: data.faction_id ? String(data.faction_id) : null,
					title: data.title,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: characterPublicInfo.characterId,
					set: {
						name: data.name,
						corporationId,
						allianceId,
						birthday: data.birthday,
						raceId: String(data.race_id),
						bloodlineId: String(data.bloodline_id),
						securityStatus: data.security_status ? Number(data.security_status) : undefined,
						description: data.description,
						gender: data.gender,
						factionId: data.faction_id ? String(data.faction_id) : null,
						title: data.title,
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			this.logDbOperationError('fetchAndStorePublicInfo.upsert', characterId, error, {
				name: data.name,
				corporationId,
				allianceId,
			})
			throw error
		}

		return (await this.getCharacterInfo(characterId))!
	}

	/**
	 * Fetch and store corporation history
	 */
	private async fetchAndStoreCorporationHistory(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterCorporationHistoryData[]> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStoreStub.fetchEsi<
			Array<{
				corporation_id: number
				is_deleted?: boolean
				record_id: number
				start_date: string
			}>
		>(`/characters/${String(characterId)}/corporationhistory`, String(characterId))

		const rawEntries = response.data

		// Convert numeric IDs to strings
		const entries: EsiCorporationHistoryEntry[] = rawEntries.map((entry) => ({
			corporation_id: entry.corporation_id,
			is_deleted: entry.is_deleted,
			record_id: entry.record_id,
			start_date: entry.start_date,
		}))

		// Upsert each entry
		for (const entry of entries) {
			await this.db
				.insert(characterCorporationHistory)
				.values({
					characterId,
					recordId: String(entry.record_id),
					corporationId: String(entry.corporation_id),
					startDate: entry.start_date,
					isDeleted: entry.is_deleted,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterCorporationHistory.characterId, characterCorporationHistory.recordId],
					set: {
						corporationId: String(entry.corporation_id),
						startDate: entry.start_date,
						isDeleted: entry.is_deleted,
						updatedAt: new Date(),
					},
				})
		}

		const results = await this.db.query.characterCorporationHistory.findMany({
			where: eq(characterCorporationHistory.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			recordId: r.recordId,
			corporationId: createEveCorporationId(r.corporationId),
			startDate: r.startDate,
			isDeleted: r.isDeleted ?? undefined,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Fetch and store character skills
	 */
	private async fetchAndStoreSkills(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterSkillsData> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		// ESI returns numbers for skill_id, but we need strings
		const response = await tokenStoreStub.fetchEsi<{
			skills: Array<{
				active_skill_level: number
				skill_id: number
				skillpoints_in_skill: number
				trained_skill_level: number
			}>
			total_sp: number
			unallocated_sp?: number
		}>(`/characters/${String(characterId)}/skills`, String(characterId))

		const rawData = response.data

		// ESI returns numeric skill_id
		const data: EsiCharacterSkills = rawData

		// Upsert to database (convert skill_id to string for storage)
		try {
			await this.db
				.insert(characterSkills)
				.values({
					characterId,
					totalSp: data.total_sp,
					unallocatedSp: data.unallocated_sp,
					skills: data.skills.map((skill) => ({
						...skill,
						skill_id: String(skill.skill_id),
					})),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: characterSkills.characterId,
					set: {
						totalSp: data.total_sp,
						unallocatedSp: data.unallocated_sp,
						skills: data.skills.map((skill) => ({
							...skill,
							skill_id: String(skill.skill_id),
						})),
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			this.logDbOperationError('fetchAndStoreSkills.upsert', characterId, error, {
				totalSp: data.total_sp,
				unallocatedSp: data.unallocated_sp,
				skillCount: data.skills.length,
			})
			throw error
		}

		let result
		try {
			result = await this.db.query.characterSkills.findFirst({
				where: eq(characterSkills.characterId, characterId),
			})
		} catch (error) {
			this.logDbOperationError('fetchAndStoreSkills.lookupAfterUpsert', characterId, error)
			throw error
		}

		return {
			characterId: createEveCharacterId(result!.characterId),
			totalSp: result!.totalSp,
			unallocatedSp: result!.unallocatedSp ?? undefined,
			skills: result!.skills,
			createdAt: result!.createdAt,
			updatedAt: result!.updatedAt,
		}
	}

	/**
	 * Fetch and store character attributes
	 */
	private async fetchAndStoreAttributes(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterAttributesData> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const response: EsiResponse<EsiCharacterAttributes> = await tokenStoreStub.fetchEsi(
			`/characters/${String(characterId)}/attributes`,
			String(characterId)
		)

		const data = response.data

		// Upsert to database
		try {
			await this.db
				.insert(characterAttributes)
				.values({
					characterId,
					intelligence: data.intelligence,
					perception: data.perception,
					memory: data.memory,
					willpower: data.willpower,
					charisma: data.charisma,
					accruedRemapCooldownDate: data.accrued_remap_cooldown_date,
					bonusRemaps: data.bonus_remaps,
					lastRemapDate: data.last_remap_date,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: characterAttributes.characterId,
					set: {
						intelligence: data.intelligence,
						perception: data.perception,
						memory: data.memory,
						willpower: data.willpower,
						charisma: data.charisma,
						accruedRemapCooldownDate: data.accrued_remap_cooldown_date,
						bonusRemaps: data.bonus_remaps,
						lastRemapDate: data.last_remap_date,
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			this.logDbOperationError('fetchAndStoreAttributes.upsert', characterId, error)
			throw error
		}

		let result
		try {
			result = await this.db.query.characterAttributes.findFirst({
				where: eq(characterAttributes.characterId, characterId),
			})
		} catch (error) {
			this.logDbOperationError('fetchAndStoreAttributes.lookupAfterUpsert', characterId, error)
			throw error
		}

		return {
			characterId: createEveCharacterId(result!.characterId),
			intelligence: result!.intelligence,
			perception: result!.perception,
			memory: result!.memory,
			willpower: result!.willpower,
			charisma: result!.charisma,
			accruedRemapCooldownDate: result!.accruedRemapCooldownDate ?? undefined,
			bonusRemaps: result!.bonusRemaps ?? undefined,
			lastRemapDate: result!.lastRemapDate ?? undefined,
			createdAt: result!.createdAt,
			updatedAt: result!.updatedAt,
		}
	}

	/**
	 * Fetch and store wallet journal entries
	 */
	private async fetchAndStoreWallet(
		characterId: string,
		_forceRefresh = false
	): Promise<{ characterId: string; balance: string; createdAt: Date; updatedAt: Date }> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const response = await tokenStoreStub.fetchEsi<number>(
			`/characters/${String(characterId)}/wallet`,
			String(characterId)
		)

		const balance = String(response.data)
		try {
			await this.db
				.insert(characterWallet)
				.values({
					characterId,
					balance,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: characterWallet.characterId,
					set: {
						balance,
						updatedAt: new Date(),
					},
				})
		} catch (error) {
			this.logDbOperationError('fetchAndStoreWallet.upsert', characterId, error, { balance })
			throw error
		}

		let result
		try {
			result = await this.db.query.characterWallet.findFirst({
				where: eq(characterWallet.characterId, characterId),
			})
		} catch (error) {
			this.logDbOperationError('fetchAndStoreWallet.lookupAfterUpsert', characterId, error)
			throw error
		}

		if (!result) {
			throw new Error(`Failed to store wallet balance for character ${characterId}`)
		}

		return result
	}

	/**
	 * Fetch and store wallet journal entries
	 */
	private async fetchAndStoreWalletJournal(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterWalletJournalData[]> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStoreStub.fetchEsi<
			Array<{
				id: number
				date: string
				ref_type: string
				amount: number
				balance?: number
				description: string
				first_party_id?: number
				second_party_id?: number
				reason?: string
				tax?: number
				tax_receiver_id?: number
				context_id?: number
				context_id_type?: string
			}>
		>(`/characters/${String(characterId)}/wallet/journal`, String(characterId))

		const rawEntries = response.data

		// Convert numeric IDs to strings
		const entries: EsiWalletJournalEntry[] = rawEntries.map((entry) => ({
			id: entry.id,
			date: entry.date,
			ref_type: entry.ref_type,
			amount: entry.amount,
			balance: entry.balance,
			description: entry.description,
			first_party_id: entry.first_party_id ?? undefined,
			second_party_id: entry.second_party_id ?? undefined,
			reason: entry.reason,
			tax: entry.tax,
			tax_receiver_id: entry.tax_receiver_id ?? undefined,
			context_id: entry.context_id ?? undefined,
			context_id_type: entry.context_id_type,
		}))

		// Upsert each entry
		for (const entry of entries) {
			await this.db
				.insert(characterWalletJournal)
				.values({
					characterId,
					journalId: String(entry.id),
					date: new Date(entry.date),
					refType: entry.ref_type,
					amount: entry.amount.toString(),
					balance: entry.balance?.toString() ?? '0',
					description: entry.description,
					firstPartyId:
						entry.first_party_id !== undefined ? String(entry.first_party_id) : undefined,
					secondPartyId:
						entry.second_party_id !== undefined ? String(entry.second_party_id) : undefined,
					reason: entry.reason,
					tax: entry.tax?.toString(),
					taxReceiverId:
						entry.tax_receiver_id !== undefined ? String(entry.tax_receiver_id) : undefined,
					contextId: entry.context_id !== undefined ? String(entry.context_id) : undefined,
					contextIdType: entry.context_id_type,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterWalletJournal.characterId, characterWalletJournal.journalId],
					set: {
						date: new Date(entry.date),
						refType: entry.ref_type,
						amount: entry.amount.toString(),
						balance: entry.balance?.toString() ?? '0',
						description: entry.description,
						firstPartyId:
							entry.first_party_id !== undefined ? String(entry.first_party_id) : undefined,
						secondPartyId:
							entry.second_party_id !== undefined ? String(entry.second_party_id) : undefined,
						reason: entry.reason,
						tax: entry.tax?.toString(),
						taxReceiverId:
							entry.tax_receiver_id !== undefined ? String(entry.tax_receiver_id) : undefined,
						contextId: entry.context_id !== undefined ? String(entry.context_id) : undefined,
						contextIdType: entry.context_id_type,
						updatedAt: new Date(),
					},
				})
		}

		const results = await this.db.query.characterWalletJournal.findMany({
			where: eq(characterWalletJournal.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			journalId: String(r.journalId),
			date: new Date(r.date),
			refType: r.refType,
			amount: r.amount,
			balance: String(r.balance),
			description: r.description,
			firstPartyId: r.firstPartyId ?? undefined,
			secondPartyId: r.secondPartyId ?? undefined,
			reason: r.reason ?? undefined,
			tax: r.tax ?? undefined,
			taxReceiverId: r.taxReceiverId ?? undefined,
			contextId: r.contextId ?? undefined,
			contextIdType: r.contextIdType ?? undefined,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Fetch and store market transactions
	 */
	private async fetchAndStoreMarketTransactions(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterMarketTransactionData[]> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStoreStub.fetchEsi<
			Array<{
				transaction_id: number
				date: string
				type_id: number
				quantity: number
				unit_price: number
				client_id: number
				location_id: number
				is_buy: boolean
				is_personal: boolean
				journal_ref_id: number
			}>
		>(`/characters/${String(characterId)}/wallet/transactions`, String(characterId))

		const rawTransactions = response.data

		// ESI returns numeric IDs
		const transactions: EsiMarketTransaction[] = rawTransactions

		// Upsert each transaction
		for (const txn of transactions) {
			await this.db
				.insert(characterMarketTransactions)
				.values({
					characterId,
					transactionId: String(txn.transaction_id),
					date: new Date(txn.date),
					typeId: String(txn.type_id),
					quantity: txn.quantity,
					unitPrice: txn.unit_price.toString(),
					clientId: String(txn.client_id),
					locationId: String(txn.location_id),
					isBuy: txn.is_buy,
					isPersonal: txn.is_personal,
					journalRefId: String(txn.journal_ref_id),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						characterMarketTransactions.characterId,
						characterMarketTransactions.transactionId,
					],
					set: {
						date: new Date(txn.date),
						typeId: String(txn.type_id),
						quantity: txn.quantity,
						unitPrice: txn.unit_price.toString(),
						clientId: String(txn.client_id),
						locationId: String(txn.location_id),
						isBuy: txn.is_buy,
						isPersonal: txn.is_personal,
						journalRefId: String(txn.journal_ref_id),
						updatedAt: new Date(),
					},
				})
		}

		const results = await this.db.query.characterMarketTransactions.findMany({
			where: eq(characterMarketTransactions.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			transactionId: String(r.transactionId),
			date: new Date(r.date),
			typeId: r.typeId,
			quantity: r.quantity,
			unitPrice: r.unitPrice,
			clientId: String(r.clientId),
			locationId: String(r.locationId),
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Fetch and store market orders
	 */
	private async fetchAndStoreMarketOrders(
		characterId: string,
		_forceRefresh = false
	): Promise<CharacterMarketOrderData[]> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStoreStub.fetchEsi<
			Array<{
				order_id: number
				type_id: number
				location_id: number
				is_buy_order?: boolean
				price: number
				volume_total: number
				volume_remain: number
				issued: string
				state: 'open' | 'closed' | 'expired' | 'cancelled'
				min_volume?: number
				range?: string
				duration?: number
				escrow?: number
				region_id?: number
			}>
		>(`/characters/${String(characterId)}/orders`, String(characterId))

		const rawOrders = response.data

		// ESI returns numeric IDs, normalize optional fields to required
		const orders: EsiMarketOrder[] = rawOrders.map((order) => ({
			...order,
			range: order.range ?? 'station',
			duration: order.duration ?? 0,
			region_id: order.region_id ?? 0,
		}))

		// Upsert each order
		for (const order of orders) {
			await this.db
				.insert(characterMarketOrders)
				.values({
					characterId,
					orderId: String(order.order_id),
					typeId: String(order.type_id),
					locationId: String(order.location_id),
					isBuyOrder: order.is_buy_order ?? false,
					price: order.price.toString(),
					volumeTotal: order.volume_total,
					volumeRemain: order.volume_remain,
					issued: new Date(order.issued),
					state: order.state,
					minVolume: order.min_volume ?? 1,
					range: order.range ?? 'station',
					duration: order.duration ?? 0,
					escrow: order.escrow?.toString(),
					regionId: String(order.region_id),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterMarketOrders.characterId, characterMarketOrders.orderId],
					set: {
						typeId: String(order.type_id),
						locationId: String(order.location_id),
						isBuyOrder: order.is_buy_order ?? false,
						price: order.price.toString(),
						volumeTotal: order.volume_total,
						volumeRemain: order.volume_remain,
						issued: new Date(order.issued),
						state: order.state,
						minVolume: order.min_volume ?? 1,
						range: order.range ?? 'station',
						duration: order.duration ?? 0,
						escrow: order.escrow?.toString(),
						regionId: String(order.region_id),
						updatedAt: new Date(),
					},
				})
		}

		const results = await this.db.query.characterMarketOrders.findMany({
			where: eq(characterMarketOrders.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			orderId: r.orderId,
			typeId: r.typeId,
			locationId: String(r.locationId),
			isBuyOrder: r.isBuyOrder,
			price: r.price,
			volumeTotal: r.volumeTotal,
			volumeRemain: r.volumeRemain,
			issued: new Date(r.issued),
			state: r.state,
			minVolume: r.minVolume,
			range: r.range,
			duration: r.duration,
			escrow: r.escrow ?? undefined,
			regionId: String(r.regionId),
			createdAt: new Date(r.createdAt),
			updatedAt: new Date(r.updatedAt),
		}))
	}

	/**
	 * Store killmails in the database
	 * @param characterId - Character ID
	 * @param killmails - Array of killmail data from ESI
	 */
	private async storeKillmails(
		characterId: string,
		killmails: Array<{ killmailId: string; killmailHash: string }>
	): Promise<void> {
		const BATCH_SIZE = 50

		// Process in batches to avoid timeouts
		for (let i = 0; i < killmails.length; i += BATCH_SIZE) {
			const batch = killmails.slice(i, i + BATCH_SIZE)

			const valuesToInsert = batch.map((km) => ({
				characterId: String(characterId),
				killmailId: km.killmailId,
				killmailHash: km.killmailHash,
				killmailTime: new Date(), // ESI doesn't provide time in recent endpoint
				updatedAt: new Date(),
			}))

			await this.db
				.insert(characterKillmails)
				.values(valuesToInsert)
				.onConflictDoUpdate({
					target: [characterKillmails.characterId, characterKillmails.killmailId],
					set: {
						killmailHash: sql`excluded.killmail_hash`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store killmails
	 * @param characterId - Character ID
	 * @param _forceRefresh - Whether to force refresh (unused for now)
	 */
	private async fetchAndStoreKillmails(characterId: string, _forceRefresh = false): Promise<void> {
		console.log(`[fetchAndStoreKillmails] Starting fetch for character ${characterId}`)

		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')

		console.log(
			`[fetchAndStoreKillmails] Fetching recent killmails from ESI for character ${characterId}`
		)
		const response = await tokenStoreStub.fetchEsiAllPages<{
			killmail_id: number
			killmail_hash: string
		}>(`/characters/${characterId}/killmails/recent`, String(characterId))

		console.log(
			`[fetchAndStoreKillmails] ESI response pages: ${response.pages}, data length: ${response.data?.length || 0}`
		)
		console.log(`[fetchAndStoreKillmails] Raw response data:`, JSON.stringify(response.data))

		// Transform ESI response (snake_case) to match schema (camelCase)
		const transformedData = response.data.map((km) => ({
			killmailId: String(km.killmail_id),
			killmailHash: km.killmail_hash,
		}))

		console.log(`[fetchAndStoreKillmails] Transformed data:`, JSON.stringify(transformedData))

		const killmails = killmailsSchema.parse(transformedData)
		console.log(
			`[fetchAndStoreKillmails] Parsed ${killmails.length} killmails for character ${characterId}`
		)

		if (killmails.length === 0) {
			console.log(`[fetchAndStoreKillmails] No killmails found for character ${characterId}`)
			return
		}

		// Fetch detailed data for each killmail and store with all enriched fields
		// Process sequentially to avoid overwhelming ESI with concurrent requests
		let successCount = 0
		let errorCount = 0

		for (const killmail of killmails) {
			console.log(
				`[fetchAndStoreKillmails] Processing killmail ${killmail.killmailId} (${successCount + errorCount + 1}/${killmails.length})`
			)
			try {
				await this.fetchKillmailDetails(killmail.killmailId, killmail.killmailHash, characterId)
				successCount++
				console.log(`[fetchAndStoreKillmails] Successfully stored killmail ${killmail.killmailId}`)
			} catch (error) {
				errorCount++
				console.error(
					`[fetchAndStoreKillmails] Failed to fetch details for killmail ${killmail.killmailId}:`,
					error instanceof Error ? error.message : String(error)
				)
				console.error(
					`[fetchAndStoreKillmails] Error stack:`,
					error instanceof Error ? error.stack : 'No stack'
				)
				// Continue processing remaining killmails even if one fails
			}
		}

		console.log(
			`[fetchAndStoreKillmails] Completed processing ${killmails.length} killmails for character ${characterId}: ${successCount} successful, ${errorCount} failed`
		)
	}

	/**
	 * Fetch killmails from ESI and store them
	 * Public method for external callers
	 * @param characterId - Character ID
	 */
	async fetchKillmails(characterId: string): Promise<void> {
		await this.fetchAndStoreKillmails(characterId)
	}

	/**
	 * Get character corporation history
	 */
	async getCorporationHistory(characterId: string) {
		const results = await this.db.query.characterCorporationHistory.findMany({
			where: eq(characterCorporationHistory.characterId, characterId),
		})

		return results.map((r) => ({
			recordId: r.recordId,
			corporationId: createEveCorporationId(r.corporationId),
			startDate: r.startDate,
			isDeleted: r.isDeleted ?? undefined,
		}))
	}

	/**
	 * Get character skills
	 */
	async getSkills(characterId: string): Promise<CharacterSkillsResponse | null> {
		const result = await this.db.query.characterSkills.findFirst({
			where: eq(characterSkills.characterId, characterId),
		})

		if (!result) return null

		return {
			skills: result.skills.map((skill) => ({
				...skill,
				skill_id: Number(skill.skill_id),
			})),
			total_sp: result.totalSp,
			unallocated_sp: result.unallocatedSp ?? undefined,
		}
	}

	/**
	 * Get character skills, fetching from ESI if not found or stale
	 * @param characterId The character ID
	 * @param maxAge Maximum age of cached data in milliseconds (default: 1 hour)
	 * @returns Character skills or null if unable to fetch
	 */
	async getOrFetchSkills(
		characterId: string,
		maxAge: number = 60 * 60 * 1000
	): Promise<CharacterSkillsResponse | null> {
		// First try to get existing skills
		const existingSkills = await this.getSkills(characterId)

		// Check if we have skills and they're fresh enough
		if (existingSkills) {
			// Check age of data
			const result = await this.db.query.characterSkills.findFirst({
				where: eq(characterSkills.characterId, characterId),
				columns: { updatedAt: true },
			})

			if (result?.updatedAt) {
				const age = Date.now() - result.updatedAt.getTime()
				if (age < maxAge) {
					return existingSkills
				}
			}
		}

		// Skills are missing or stale, try to fetch from ESI
		try {
			await this.fetchAndStoreSkills(characterId)
			// Return the newly fetched skills
			return await this.getSkills(characterId)
		} catch (error) {
			console.error(`Failed to fetch skills from ESI for character ${characterId}:`, error)
			// Return existing skills if we have them, even if stale
			return existingSkills
		}
	}

	/**
	 * Get character attributes
	 */
	async getAttributes(characterId: string) {
		const result = await this.db.query.characterAttributes.findFirst({
			where: eq(characterAttributes.characterId, characterId),
		})

		if (!result) return null

		return {
			intelligence: result.intelligence,
			perception: result.perception,
			memory: result.memory,
			willpower: result.willpower,
			charisma: result.charisma,
			accruedRemapCooldownDate: result.accruedRemapCooldownDate ?? undefined,
			bonusRemaps: result.bonusRemaps ?? undefined,
			lastRemapDate: result.lastRemapDate ?? undefined,
		}
	}

	/**
	 * Get sensitive character data (location, wallet, assets, status, skill queue, and financial data)
	 * Returns null if no data is available
	 */
	async getSensitiveData(characterId: string) {
		// Query all sensitive data tables
		const [
			location,
			wallet,
			assets,
			status,
			skillQueue,
			walletJournal,
			marketTransactions,
			marketOrders,
		] = await Promise.all([
			this.db.query.characterLocation.findFirst({
				where: eq(characterLocation.characterId, characterId),
			}),
			this.db.query.characterWallet.findFirst({
				where: eq(characterWallet.characterId, characterId),
			}),
			this.db.query.characterAssets.findFirst({
				where: eq(characterAssets.characterId, characterId),
			}),
			this.db.query.characterStatus.findFirst({
				where: eq(characterStatus.characterId, characterId),
			}),
			this.db.query.characterSkillQueue.findFirst({
				where: eq(characterSkillQueue.characterId, characterId),
			}),
			this.db.query.characterWalletJournal.findMany({
				where: eq(characterWalletJournal.characterId, characterId),
			}),
			this.db.query.characterMarketTransactions.findMany({
				where: eq(characterMarketTransactions.characterId, characterId),
			}),
			this.db.query.characterMarketOrders.findMany({
				where: eq(characterMarketOrders.characterId, characterId),
			}),
		])

		// Return null if no sensitive data exists at all
		if (
			!location &&
			!wallet &&
			!assets &&
			!status &&
			!skillQueue &&
			walletJournal.length === 0 &&
			marketTransactions.length === 0 &&
			marketOrders.length === 0
		) {
			return null
		}

		return {
			location: location
				? {
						solarSystemId: location.solarSystemId,
						stationId: location.stationId ?? undefined,
						structureId: location.structureId ?? undefined,
					}
				: undefined,
			wallet: wallet
				? {
						balance: wallet.balance,
					}
				: undefined,
			assets: assets
				? {
						totalValue: assets.totalValue ?? undefined,
						assetCount: assets.assetCount ?? undefined,
						lastUpdated: assets.lastUpdated ?? undefined,
					}
				: undefined,
			status: status
				? {
						online: status.online,
						lastLogin: status.lastLogin ?? undefined,
						lastLogout: status.lastLogout ?? undefined,
						loginsCount: status.loginsCount ?? undefined,
					}
				: undefined,
			skillQueue: skillQueue?.queue
				? skillQueue.queue.map((item) => ({
						...item,
						skill_id: Number(item.skill_id),
					}))
				: undefined,
			walletJournal:
				walletJournal.length > 0
					? walletJournal.map((r) => ({
							id: r.id,
							characterId: createEveCharacterId(r.characterId),
							journalId: r.journalId,
							date: r.date,
							refType: r.refType,
							amount: r.amount,
							balance: r.balance,
							description: r.description,
							firstPartyId: r.firstPartyId ?? undefined,
							secondPartyId: r.secondPartyId ?? undefined,
							reason: r.reason ?? undefined,
							tax: r.tax ?? undefined,
							taxReceiverId: r.taxReceiverId ?? undefined,
							contextId: r.contextId ?? undefined,
							contextIdType: r.contextIdType ?? undefined,
							createdAt: r.createdAt,
							updatedAt: r.updatedAt,
						}))
					: undefined,
			marketTransactions:
				marketTransactions.length > 0
					? marketTransactions.map((r) => ({
							id: r.id,
							characterId: createEveCharacterId(r.characterId),
							transactionId: r.transactionId,
							date: r.date,
							typeId: r.typeId,
							quantity: r.quantity,
							unitPrice: r.unitPrice,
							clientId: r.clientId,
							locationId: r.locationId,
							isBuy: r.isBuy,
							isPersonal: r.isPersonal,
							journalRefId: r.journalRefId,
							createdAt: r.createdAt,
							updatedAt: r.updatedAt,
						}))
					: undefined,
			marketOrders:
				marketOrders.length > 0
					? marketOrders.map((r) => ({
							id: r.id,
							characterId: createEveCharacterId(r.characterId),
							orderId: r.orderId,
							typeId: r.typeId,
							locationId: r.locationId,
							isBuyOrder: r.isBuyOrder,
							price: r.price,
							volumeTotal: r.volumeTotal,
							volumeRemain: r.volumeRemain,
							issued: r.issued,
							state: r.state,
							minVolume: r.minVolume,
							range: r.range,
							duration: r.duration,
							escrow: r.escrow ?? undefined,
							regionId: r.regionId,
							createdAt: r.createdAt,
							updatedAt: r.updatedAt,
						}))
					: undefined,
		}
	}

	/**
	 * Get wallet journal entries for a character
	 */
	async getWalletJournal(characterId: string): Promise<CharacterWalletJournalData[]> {
		const results = await this.db.query.characterWalletJournal.findMany({
			where: eq(characterWalletJournal.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			journalId: String(r.journalId),
			date: new Date(r.date),
			refType: r.refType,
			amount: r.amount,
			balance: r.balance,
			description: r.description,
			firstPartyId: r.firstPartyId ?? undefined,
			secondPartyId: r.secondPartyId ?? undefined,
			reason: r.reason ?? undefined,
			tax: r.tax ?? undefined,
			taxReceiverId: r.taxReceiverId ?? undefined,
			contextId: r.contextId ?? undefined,
			contextIdType: r.contextIdType ?? undefined,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	async getWalletJournalWindow(
		characterId: string,
		filters: CharacterWalletJournalWindowFilters = {}
	): Promise<CharacterWalletJournalData[]> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions = [eq(characterWalletJournal.characterId, characterId)]
		if (filters.refTypes && filters.refTypes.length > 0) {
			conditions.push(inArray(characterWalletJournal.refType, filters.refTypes))
		}
		if (filters.firstPartyId) {
			conditions.push(eq(characterWalletJournal.firstPartyId, filters.firstPartyId))
		}
		if (filters.secondPartyId) {
			conditions.push(eq(characterWalletJournal.secondPartyId, filters.secondPartyId))
		}
		if (filters.fromDate) {
			conditions.push(gte(characterWalletJournal.date, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(characterWalletJournal.date, filters.toDate))
		}
		const minAmount = Number(filters.minAmount)
		if (Number.isFinite(minAmount)) {
			conditions.push(sql`CAST(${characterWalletJournal.amount} AS numeric) >= ${minAmount}`)
		}
		const maxAmount = Number(filters.maxAmount)
		if (Number.isFinite(maxAmount)) {
			conditions.push(sql`CAST(${characterWalletJournal.amount} AS numeric) <= ${maxAmount}`)
		}

		const rows = await this.db.query.characterWalletJournal.findMany({
			where: and(...conditions),
			orderBy: [desc(characterWalletJournal.date), desc(characterWalletJournal.journalId)],
			limit,
			offset,
		})

		return rows.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			journalId: String(r.journalId),
			date: new Date(r.date),
			refType: r.refType,
			amount: r.amount,
			balance: r.balance,
			description: r.description,
			firstPartyId: r.firstPartyId ?? undefined,
			secondPartyId: r.secondPartyId ?? undefined,
			reason: r.reason ?? undefined,
			tax: r.tax ?? undefined,
			taxReceiverId: r.taxReceiverId ?? undefined,
			contextId: r.contextId ?? undefined,
			contextIdType: r.contextIdType ?? undefined,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get market transactions for a character
	 */
	async getMarketTransactions(characterId: string): Promise<CharacterMarketTransactionData[]> {
		const results = await this.db.query.characterMarketTransactions.findMany({
			where: eq(characterMarketTransactions.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			transactionId: String(r.transactionId),
			date: new Date(r.date),
			typeId: r.typeId,
			quantity: r.quantity,
			unitPrice: r.unitPrice,
			clientId: r.clientId,
			locationId: r.locationId,
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	async getMarketTransactionsWindow(
		characterId: string,
		filters: CharacterMarketTransactionsWindowFilters = {}
	): Promise<CharacterMarketTransactionData[]> {
		const limit = Math.min(Math.max(filters.limit ?? 1000, 1), 10000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const conditions = [eq(characterMarketTransactions.characterId, characterId)]
		if (filters.clientId) {
			conditions.push(eq(characterMarketTransactions.clientId, filters.clientId))
		}
		if (filters.typeId) {
			conditions.push(eq(characterMarketTransactions.typeId, filters.typeId))
		}
		if (filters.journalRefId) {
			conditions.push(eq(characterMarketTransactions.journalRefId, filters.journalRefId))
		}
		if (filters.fromDate) {
			conditions.push(gte(characterMarketTransactions.date, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(characterMarketTransactions.date, filters.toDate))
		}
		const minUnitPrice = Number(filters.minUnitPrice)
		if (Number.isFinite(minUnitPrice)) {
			conditions.push(
				sql`CAST(${characterMarketTransactions.unitPrice} AS numeric) >= ${minUnitPrice}`
			)
		}
		const maxUnitPrice = Number(filters.maxUnitPrice)
		if (Number.isFinite(maxUnitPrice)) {
			conditions.push(
				sql`CAST(${characterMarketTransactions.unitPrice} AS numeric) <= ${maxUnitPrice}`
			)
		}

		const rows = await this.db.query.characterMarketTransactions.findMany({
			where: and(...conditions),
			orderBy: [
				desc(characterMarketTransactions.date),
				desc(characterMarketTransactions.transactionId),
			],
			limit,
			offset,
		})

		return rows.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			transactionId: String(r.transactionId),
			date: new Date(r.date),
			typeId: r.typeId,
			quantity: r.quantity,
			unitPrice: r.unitPrice,
			clientId: r.clientId,
			locationId: r.locationId,
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		}))
	}

	async getCharacterWalletSyncHealth(characterId: string): Promise<CharacterWalletSyncHealth> {
		const [latestWalletJournal, latestMarketTransaction] = await Promise.all([
			this.db.query.characterWalletJournal.findFirst({
				where: eq(characterWalletJournal.characterId, characterId),
				orderBy: desc(characterWalletJournal.updatedAt),
			}),
			this.db.query.characterMarketTransactions.findFirst({
				where: eq(characterMarketTransactions.characterId, characterId),
				orderBy: desc(characterMarketTransactions.updatedAt),
			}),
		])

		return {
			characterId: createEveCharacterId(characterId),
			walletJournalLastUpdated: latestWalletJournal?.updatedAt ?? null,
			marketTransactionsLastUpdated: latestMarketTransaction?.updatedAt ?? null,
		}
	}

	/**
	 * Get market orders for a character
	 */
	async getMarketOrders(characterId: string): Promise<CharacterMarketOrderData[]> {
		const results = await this.db.query.characterMarketOrders.findMany({
			where: eq(characterMarketOrders.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: createEveCharacterId(r.characterId),
			orderId: r.orderId,
			typeId: r.typeId,
			locationId: String(r.locationId),
			isBuyOrder: r.isBuyOrder,
			price: r.price,
			volumeTotal: r.volumeTotal,
			volumeRemain: r.volumeRemain,
			issued: new Date(r.issued),
			state: r.state,
			minVolume: r.minVolume,
			range: r.range,
			duration: r.duration,
			escrow: r.escrow ?? undefined,
			regionId: String(r.regionId),
			createdAt: new Date(r.createdAt),
			updatedAt: new Date(r.updatedAt),
		}))
	}

	/**
	 * Fetch handler for HTTP requests to the Durable Object
	 */
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// Health check endpoint
		if (url.pathname === '/health') {
			return Response.json({ status: 'ok' })
		}

		return new Response('EveCharacterData Durable Object', { status: 200 })
	}
}
