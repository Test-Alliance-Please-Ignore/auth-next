import { DurableObject } from 'cloudflare:workers'

import { and, desc, eq, gte, ilike, inArray, lte, sql } from '@repo/db-utils'
import { disposeRpcResult, getStub } from '@repo/do-utils'
import { EveCharacterDataInstance } from '@repo/eve-character-data'
import { createEveAllianceId, createEveCharacterId, createEveCorporationId } from '@repo/eve-types'
import { logger } from '@repo/hono-helpers'
import { parseDateOrNull } from '@repo/worker-utils'
import { createWorkflowBatch } from '@repo/workflow-utils'

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
import { buildUserSyncWorkflowOptions } from './workflows/build-user-sync-workflow-options'

import type {
	CharacterAttributesData,
	CharacterCorporationHistoryData,
	CharacterKillmailData,
	CharacterKillmailUpsertData,
	CharacterLossData,
	CharacterLossItemData,
	CharacterMarketOrderData,
	CharacterMarketTransactionData,
	CharacterMarketTransactionsWindowFilters,
	CharacterPublicData,
	CharacterPublicRefreshResult,
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
	EsiWalletJournalEntry,
	EveCharacterData,
	FetchAuthenticatedDataOptions,
} from '@repo/eve-character-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'

type KillmailItemLike = {
	flag: number
	item_type_id: number | string
	quantity_destroyed?: number
	quantity_dropped?: number
	items?: KillmailItemLike[]
}

type KillmailPayloadLike = {
	solar_system_id?: number | string
	victim?: {
		character_id?: number | string
		ship_type_id?: number | string
		items?: KillmailItemLike[]
	}
}

const WALLET_JOURNAL_INSERT_BATCH_SIZE = 100
const WALLET_TRANSACTION_INSERT_BATCH_SIZE = 100
const MAX_WALLET_TRANSACTION_PAGES = 100

type RawCharacterWalletJournalEntry = {
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
}

type RawCharacterMarketTransaction = {
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
}

function compareNumericStrings(left: string, right: string): number {
	try {
		const leftBigInt = BigInt(left)
		const rightBigInt = BigInt(right)
		if (leftBigInt === rightBigInt) {
			return 0
		}
		return leftBigInt > rightBigInt ? 1 : -1
	} catch {
		return left.localeCompare(right, 'en')
	}
}

/**
 * EveCharacterData Durable Object
 *
 * This Durable Object stores character data from ESI in PostgreSQL
 * Uses eve-token-store as ESI gateway for fetching data
 */
export class EveCharacterDataDO extends DurableObject<Env> implements EveCharacterData {
	private db: ReturnType<typeof createDb>
	private static readonly MANUAL_BATCH_STORAGE_PREFIX = 'manual-sync-batch:'
	private static readonly MANUAL_BATCH_STORAGE_CHUNK_SIZE = 250

	private getManualBatchMetaKey(batchId: string): string {
		return `${EveCharacterDataDO.MANUAL_BATCH_STORAGE_PREFIX}${batchId}:meta`
	}

	private getManualBatchChunkKey(batchId: string, chunkIndex: number): string {
		return `${EveCharacterDataDO.MANUAL_BATCH_STORAGE_PREFIX}${batchId}:chunk:${chunkIndex}`
	}

	private chunkWorkflowInstanceIds(workflowInstanceIds: string[]): string[][] {
		const chunks: string[][] = []
		for (
			let index = 0;
			index < workflowInstanceIds.length;
			index += EveCharacterDataDO.MANUAL_BATCH_STORAGE_CHUNK_SIZE
		) {
			chunks.push(
				workflowInstanceIds.slice(index, index + EveCharacterDataDO.MANUAL_BATCH_STORAGE_CHUNK_SIZE)
			)
		}
		return chunks
	}

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
		logger.error('[EveCharacterDataDO] Database operation failed', {
			operation,
			characterId,
			...context,
			error: this.extractDbErrorDetails(error),
		})
	}

	private serializeKillmailItems(items?: KillmailItemLike[]): CharacterLossItemData[] | undefined {
		if (!items || items.length === 0) return undefined
		return items.map((item: KillmailItemLike) => ({
			flag: item.flag,
			item_type_id: String(item.item_type_id),
			quantity_destroyed: item.quantity_destroyed,
			quantity_dropped: item.quantity_dropped,
			items: this.serializeKillmailItems(item.items),
		}))
	}

	private extractKillmailData(
		row: typeof characterKillmails.$inferSelect
	): KillmailPayloadLike | null {
		const raw = row.killmailData
		if (!raw || typeof raw !== 'object') return null
		return raw as KillmailPayloadLike
	}

	private mapKillmailRowToData(row: typeof characterKillmails.$inferSelect): CharacterKillmailData {
		return {
			id: row.id,
			characterId: createEveCharacterId(row.characterId),
			killmailId: row.killmailId,
			killmailHash: row.killmailHash,
			killmailTime: row.killmailTime,
			isLoss: row.isLoss ?? null,
			shipTypeId: row.shipTypeId ?? null,
			shipTypeName: row.shipTypeName ?? null,
			totalValue: row.totalValue ?? null,
			solarSystemId: row.solarSystemId ?? null,
			solarSystemName: row.solarSystemName ?? null,
			victimCharacterId: row.victimCharacterId ?? null,
			killmailData: row.killmailData ?? null,
			updatedAt: row.updatedAt,
		}
	}

	private mapKillmailRowToLoss(
		row: typeof characterKillmails.$inferSelect
	): CharacterLossData | null {
		const killmailData = this.extractKillmailData(row)
		const victim = killmailData?.victim
		const shipTypeId = row.shipTypeId ?? victim?.ship_type_id
		const solarSystemId = row.solarSystemId ?? killmailData?.solar_system_id
		const victimCharacterId = row.victimCharacterId ?? victim?.character_id

		if (!shipTypeId || !solarSystemId || !victimCharacterId) {
			return null
		}

		return {
			killmailId: row.killmailId,
			killmailHash: row.killmailHash,
			killmailTime: row.killmailTime,
			shipTypeId: String(shipTypeId),
			totalValue: row.totalValue ?? '0',
			solarSystemId: String(solarSystemId),
			victimCharacterId: String(victimCharacterId),
			victimItems: this.serializeKillmailItems(victim?.items),
			shipTypeName: row.shipTypeName ?? undefined,
			solarSystemName: row.solarSystemName ?? undefined,
		}
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
	 * Fetch and store all public character data
	 */
	async fetchCharacterData(characterId: string, forceRefresh = false): Promise<void> {
		logger.log(
			'EveCharacterData.fetchCharacterData called with:',
			characterId,
			'type:',
			typeof characterId,
			'forceRefresh:',
			forceRefresh
		)
		try {
			await this.refreshPublicCharacterData(characterId, forceRefresh)
			logger.log('EveCharacterData.fetchCharacterData completed successfully')
		} catch (error) {
			logger.error('EveCharacterData.fetchCharacterData failed:', error)
			throw error
		}
	}

	/**
	 * Fetch, store, and classify public character data.
	 */
	async refreshPublicCharacterData(
		characterId: string,
		forceRefresh = false
	): Promise<CharacterPublicRefreshResult> {
		logger.info('[EveCharacterDataDO] refreshPublicCharacterData started', {
			characterId,
			forceRefresh,
		})
		const previousCharacterInfo = await this.getCharacterInfo(characterId)
		let currentCharacterInfo: CharacterPublicData | null = null

		try {
			currentCharacterInfo = await this.fetchAndStorePublicInfo(characterId, forceRefresh)
			if (currentCharacterInfo === null) {
				logger.info('[EveCharacterDataDO] refreshPublicCharacterData resolved deleted character', {
					characterId,
					forceRefresh,
					hadPreviousCharacterInfo: previousCharacterInfo !== null,
				})
				return {
					success: false,
					isDeleted: true,
					previousCorporationId: previousCharacterInfo?.corporationId ?? null,
					currentCorporationId: createEveCorporationId('1000001'),
					previousAllianceId: previousCharacterInfo?.allianceId ?? null,
					currentAllianceId: null,
				}
			}

			const previousCorporationId = previousCharacterInfo?.corporationId ?? null
			const currentCorporationId = currentCharacterInfo.corporationId ?? null
			const previousAllianceId = previousCharacterInfo?.allianceId ?? null
			const currentAllianceId = currentCharacterInfo.allianceId ?? null
			const affiliationChanged =
				previousCorporationId !== currentCorporationId || previousAllianceId !== currentAllianceId
			const isDeleted = String(currentCorporationId ?? '') === '1000001'

			logger.info('[EveCharacterDataDO] refreshPublicCharacterData completed', {
				characterId,
				forceRefresh,
				characterName: currentCharacterInfo.name,
				previousCorporationId,
				currentCorporationId,
				previousAllianceId,
				currentAllianceId,
				affiliationChanged,
				isDeleted,
			})

			return {
				success: !isDeleted,
				isDeleted,
				characterName: currentCharacterInfo.name,
				affiliationChanged,
				previousCorporationId,
				currentCorporationId,
				previousAllianceId,
				currentAllianceId,
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			const lowerMessage = errorMessage.toLowerCase()
			const isDeletedCharacterError =
				lowerMessage.includes('has been deleted') ||
				lowerMessage.includes('character deleted') ||
				lowerMessage.includes('character_deleted') ||
				lowerMessage.includes('esi request failed: 404')

			if (!isDeletedCharacterError) {
				logger.error('[EveCharacterDataDO] refreshPublicCharacterData failed', {
					characterId,
					forceRefresh,
					previousCorporationId: previousCharacterInfo?.corporationId ?? null,
					previousAllianceId: previousCharacterInfo?.allianceId ?? null,
					error: errorMessage,
					errorDetails: this.extractDbErrorDetails(error),
				})
				throw error
			}

			logger.info(
				'[EveCharacterDataDO] refreshPublicCharacterData treated missing character as deleted',
				{
					characterId,
					forceRefresh,
					previousCorporationId: previousCharacterInfo?.corporationId ?? null,
					previousAllianceId: previousCharacterInfo?.allianceId ?? null,
					error: errorMessage,
				}
			)

			return {
				success: false,
				isDeleted: true,
				previousCorporationId: previousCharacterInfo?.corporationId ?? null,
				currentCorporationId: null,
				previousAllianceId: previousCharacterInfo?.allianceId ?? null,
				currentAllianceId: null,
			}
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
	async fetchAuthenticatedData(
		characterId: string,
		forceRefresh = false,
		options: FetchAuthenticatedDataOptions = {}
	): Promise<void> {
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

		// Keep authenticated fetches sequential to avoid tripping Cloudflare connection limits
		// when token-store / ESI / DB work overlaps too aggressively in a single refresh pass.
		if (options.includeSkills ?? true) {
			await this.fetchAndStoreSkills(characterId, forceRefresh)
		}
		if (options.includeAttributes ?? true) {
			await this.fetchAndStoreAttributes(characterId, forceRefresh)
		}
		if (options.includeWallet ?? true) {
			await this.fetchAndStoreWallet(characterId, forceRefresh)
		}
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

	async upsertCharacterKillmails(
		characterId: string,
		killmails: CharacterKillmailUpsertData[]
	): Promise<void> {
		if (killmails.length === 0) return

		for (const killmail of killmails) {
			try {
				await this.db
					.insert(characterKillmails)
					.values({
						characterId,
						killmailId: killmail.killmailId,
						killmailHash: killmail.killmailHash,
						killmailTime: killmail.killmailTime,
						isLoss: killmail.isLoss ?? true,
						shipTypeId: killmail.shipTypeId ?? null,
						shipTypeName: killmail.shipTypeName ?? null,
						totalValue: killmail.totalValue ?? null,
						solarSystemId: killmail.solarSystemId ?? null,
						solarSystemName: killmail.solarSystemName ?? null,
						victimCharacterId: killmail.victimCharacterId ?? null,
						killmailData: killmail.killmailData ?? null,
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [characterKillmails.characterId, characterKillmails.killmailId],
						set: {
							killmailHash: killmail.killmailHash,
							killmailTime: killmail.killmailTime,
							isLoss: killmail.isLoss ?? true,
							shipTypeId: killmail.shipTypeId ?? null,
							shipTypeName: killmail.shipTypeName ?? null,
							totalValue: killmail.totalValue ?? null,
							solarSystemId: killmail.solarSystemId ?? null,
							solarSystemName: killmail.solarSystemName ?? null,
							victimCharacterId: killmail.victimCharacterId ?? null,
							killmailData: killmail.killmailData ?? null,
							updatedAt: new Date(),
						},
					})
			} catch (error) {
				this.logDbOperationError('upsertCharacterKillmails.upsert', characterId, error, {
					killmailId: killmail.killmailId,
				})
				throw error
			}
		}
	}

	async getCharacterKillmail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<CharacterKillmailData | null> {
		const result = await this.db.query.characterKillmails.findFirst({
			where: and(
				eq(characterKillmails.characterId, characterId),
				eq(characterKillmails.killmailId, killmailId),
				eq(characterKillmails.killmailHash, killmailHash)
			),
		})

		return result ? this.mapKillmailRowToData(result) : null
	}

	async getMostRecentLoss(characterId: string): Promise<CharacterKillmailData | null> {
		const result = await this.db.query.characterKillmails.findFirst({
			where: and(
				eq(characterKillmails.characterId, characterId),
				eq(characterKillmails.isLoss, true)
			),
			orderBy: [desc(characterKillmails.killmailTime), desc(characterKillmails.killmailId)],
		})

		return result ? this.mapKillmailRowToData(result) : null
	}

	async getRecentLosses(
		characterId: string,
		limit = 1000,
		cutoff?: Date
	): Promise<CharacterLossData[]> {
		const conditions = [
			eq(characterKillmails.characterId, characterId),
			eq(characterKillmails.isLoss, true),
		]
		if (cutoff) {
			conditions.push(gte(characterKillmails.killmailTime, cutoff))
		}

		const rows = await this.db.query.characterKillmails.findMany({
			where: and(...conditions),
			orderBy: [desc(characterKillmails.killmailTime), desc(characterKillmails.killmailId)],
			limit,
		})

		return rows
			.map((row) => this.mapKillmailRowToLoss(row))
			.filter((loss): loss is CharacterLossData => loss !== null)
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
		}>(`/characters/${String(characterId)}/location`, String(characterId), {
			cacheMode: 'no-store',
		})

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
		}>(`/characters/${String(characterId)}/online`, String(characterId), {
			cacheMode: 'no-store',
		})

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
				String(characterId),
				{ cacheMode: 'no-store' }
			)

			return response.data
		} catch (error) {
			// If the character doesn't have the required scope or token is invalid, return null
			logger.error(
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
		} catch {
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
	): Promise<CharacterPublicData | null> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const existingPublicInfo = await this.db.query.characterPublicInfo.findFirst({
			where: eq(characterPublicInfo.characterId, characterId),
		})
		if (_forceRefresh) {
			await tokenStoreStub.clearEsiCache(`/characters/${String(characterId)}`)
		}

		// Fetch public info and affiliation in parallel. Affiliation has a shorter ESI
		// cache (~1h vs 24h) so we prefer it for corporation_id/alliance_id when available.
		const [publicInfoResponse, affiliationResponse] = await Promise.allSettled([
			tokenStoreStub.fetchPublicEsi<EsiCharacterPublicInfo>(`/characters/${String(characterId)}`),
			tokenStoreStub.fetchCharacterAffiliations([characterId]),
		])

		const affiliation =
			affiliationResponse.status === 'fulfilled'
				? affiliationResponse.value.find((entry) => String(entry.character_id) === characterId)
				: null
		const affiliationLooksDeleted = String(affiliation?.corporation_id ?? '') === '1000001'

		if (publicInfoResponse.status === 'rejected') {
			const errorMessage =
				publicInfoResponse.reason instanceof Error
					? publicInfoResponse.reason.message
					: String(publicInfoResponse.reason)
			const lowerMessage = errorMessage.toLowerCase()
			const publicInfoLooksDeleted =
				lowerMessage.includes('has been deleted') ||
				lowerMessage.includes('character deleted') ||
				lowerMessage.includes('character_deleted') ||
				lowerMessage.includes('esi request failed: 404')
			const shouldTreatAsDeleted = publicInfoLooksDeleted || affiliationLooksDeleted

			if (!shouldTreatAsDeleted) {
				throw publicInfoResponse.reason
			}

			if (!existingPublicInfo) {
				// We know the character is deleted, but we do not have enough cached
				// identity data to materialize a placeholder row yet.
				return null
			}

			const corporationId = affiliation?.corporation_id
				? String(affiliation.corporation_id)
				: '1000001'
			const allianceId = affiliation?.alliance_id
				? String(affiliation.alliance_id)
				: (existingPublicInfo.allianceId ?? null)

			try {
				await this.db
					.insert(characterPublicInfo)
					.values({
						characterId,
						name: existingPublicInfo.name,
						corporationId,
						allianceId,
						birthday: existingPublicInfo.birthday,
						raceId: existingPublicInfo.raceId,
						bloodlineId: existingPublicInfo.bloodlineId,
						securityStatus: existingPublicInfo.securityStatus ?? undefined,
						description: existingPublicInfo.description ?? undefined,
						gender: existingPublicInfo.gender,
						factionId: existingPublicInfo.factionId ?? null,
						title: existingPublicInfo.title ?? null,
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: characterPublicInfo.characterId,
						set: {
							name: existingPublicInfo.name,
							corporationId,
							allianceId,
							birthday: existingPublicInfo.birthday,
							raceId: existingPublicInfo.raceId,
							bloodlineId: existingPublicInfo.bloodlineId,
							securityStatus: existingPublicInfo.securityStatus ?? undefined,
							description: existingPublicInfo.description ?? undefined,
							gender: existingPublicInfo.gender,
							factionId: existingPublicInfo.factionId ?? null,
							title: existingPublicInfo.title ?? null,
							updatedAt: new Date(),
						},
					})
			} catch (error) {
				this.logDbOperationError('fetchAndStorePublicInfo.deletedUpsert', characterId, error, {
					name: existingPublicInfo.name,
					corporationId,
					allianceId,
				})
				throw error
			}

			return (await this.getCharacterInfo(characterId))!
		}

		const data: EsiCharacterPublicInfo = publicInfoResponse.value.data

		// Prefer affiliation data for corporation/alliance — shorter ESI cache means fresher data.
		let corporationId = String(data.corporation_id)
		let allianceId = data.alliance_id ? String(data.alliance_id) : null

		if (affiliationResponse.status === 'fulfilled') {
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
		// This endpoint is public per the ESI OpenAPI spec — no auth required
		const response = await tokenStoreStub.fetchPublicEsi<
			Array<{
				corporation_id: number
				is_deleted?: boolean
				record_id: number
				start_date: string
			}>
		>(`/characters/${String(characterId)}/corporationhistory`)

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
			String(characterId),
			{ cacheMode: 'no-store' }
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
	): Promise<void> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const [watermark] = await this.db
			.select({
				maxJournalId: sql<string | null>`max(${characterWalletJournal.journalId}::numeric)::text`,
				maxJournalDate: sql<Date | string | null>`max(${characterWalletJournal.date})`,
			})
			.from(characterWalletJournal)
			.where(eq(characterWalletJournal.characterId, characterId))
		const storedMaxJournalId = watermark?.maxJournalId ?? null
		const storedMaxJournalDate = parseDateOrNull(watermark?.maxJournalDate)
		const journalPath = `/characters/${String(characterId)}/wallet/journal`
		const response = storedMaxJournalId
			? await tokenStoreStub.fetchEsiPagesUntilWatermark<RawCharacterWalletJournalEntry>(
					journalPath,
					String(characterId),
					{
						maxId: storedMaxJournalId,
						maxDate: storedMaxJournalDate,
					},
					{ cacheMode: 'no-store' }
				)
			: await tokenStoreStub.fetchEsiAllPages<RawCharacterWalletJournalEntry>(
					journalPath,
					String(characterId),
					{ cacheMode: 'no-store' }
				)

		let entries: EsiWalletJournalEntry[]
		try {
			entries = response.data
				.map(
					(entry): EsiWalletJournalEntry => ({
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
					})
				)
				.filter((entry) => parseDateOrNull(entry.date) !== null)
		} finally {
			disposeRpcResult(response)
		}

		const candidateEntries = entries.filter((entry) => {
			if (storedMaxJournalId === null) {
				return true
			}
			if (compareNumericStrings(String(entry.id), storedMaxJournalId) > 0) {
				return true
			}
			const entryDate = parseDateOrNull(entry.date)
			return (
				storedMaxJournalDate !== null && entryDate !== null && entryDate >= storedMaxJournalDate
			)
		})
		const newEntries = candidateEntries.sort((left, right) => {
			const leftDate = parseDateOrNull(left.date)
			const rightDate = parseDateOrNull(right.date)
			if (leftDate !== null && rightDate !== null && leftDate.getTime() !== rightDate.getTime()) {
				return leftDate < rightDate ? -1 : 1
			}
			return compareNumericStrings(String(left.id), String(right.id))
		})

		for (let index = 0; index < newEntries.length; index += WALLET_JOURNAL_INSERT_BATCH_SIZE) {
			const batch = newEntries.slice(index, index + WALLET_JOURNAL_INSERT_BATCH_SIZE)
			const values = batch.map((entry) => ({
				characterId,
				journalId: String(entry.id),
				date: parseDateOrNull(entry.date) as Date,
				refType: entry.ref_type,
				amount: String(entry.amount),
				balance: entry.balance !== undefined ? String(entry.balance) : '0',
				description: entry.description,
				firstPartyId: entry.first_party_id !== undefined ? String(entry.first_party_id) : null,
				secondPartyId: entry.second_party_id !== undefined ? String(entry.second_party_id) : null,
				reason: entry.reason ?? null,
				tax: entry.tax !== undefined ? String(entry.tax) : null,
				taxReceiverId: entry.tax_receiver_id !== undefined ? String(entry.tax_receiver_id) : null,
				contextId: entry.context_id !== undefined ? String(entry.context_id) : null,
				contextIdType: entry.context_id_type ?? null,
				updatedAt: new Date(),
			}))
			await this.db
				.insert(characterWalletJournal)
				.values(values)
				.onConflictDoNothing({
					target: [characterWalletJournal.characterId, characterWalletJournal.journalId],
				})
		}
	}

	/**
	 * Fetch and store market transactions
	 */
	private async fetchAndStoreMarketTransactions(
		characterId: string,
		_forceRefresh = false
	): Promise<void> {
		const tokenStoreStub = getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
		const [watermark] = await this.db
			.select({
				maxTransactionId: sql<
					string | null
				>`max(${characterMarketTransactions.transactionId}::numeric)::text`,
				maxTransactionDate: sql<Date | string | null>`max(${characterMarketTransactions.date})`,
			})
			.from(characterMarketTransactions)
			.where(eq(characterMarketTransactions.characterId, characterId))
		const storedMaxTransactionId = watermark?.maxTransactionId ?? null
		const storedMaxTransactionDate = parseDateOrNull(watermark?.maxTransactionDate)

		const basePath = `/characters/${String(characterId)}/wallet/transactions`
		const transactionsById = new Map<string, RawCharacterMarketTransaction>()
		let pageData: RawCharacterMarketTransaction[]
		let pagesFetched = 1
		let fromId: string | undefined
		let watermarkSeen = false
		let completed = false
		let stoppedAtWatermark = false

		const addPage = (entries: RawCharacterMarketTransaction[]) => {
			for (const entry of entries) {
				transactionsById.set(String(entry.transaction_id), entry)
			}
		}
		const hasWatermarkRow = (entries: RawCharacterMarketTransaction[]) =>
			storedMaxTransactionId !== null &&
			entries.some((entry) => String(entry.transaction_id) === storedMaxTransactionId)
		const hasRowsAtOrBeyondWatermark = (
			entries: RawCharacterMarketTransaction[],
			cursorId?: string
		) => {
			if (!storedMaxTransactionId) {
				return true
			}

			return entries.some((entry) => {
				const transactionId = String(entry.transaction_id)
				if (transactionId === cursorId) {
					return false
				}
				if (compareNumericStrings(transactionId, storedMaxTransactionId) > 0) {
					return true
				}
				const transactionDate = parseDateOrNull(entry.date)
				return (
					storedMaxTransactionDate !== null &&
					transactionDate !== null &&
					transactionDate >= storedMaxTransactionDate
				)
			})
		}

		const firstResponse = await tokenStoreStub.fetchEsi<RawCharacterMarketTransaction[]>(
			basePath,
			String(characterId),
			{ cacheMode: 'no-store' }
		)
		try {
			pageData = firstResponse.data.map((entry) => ({ ...entry }))
		} finally {
			disposeRpcResult(firstResponse)
		}
		addPage(pageData)

		if (hasWatermarkRow(pageData)) {
			watermarkSeen = true
			if (!hasRowsAtOrBeyondWatermark(pageData)) {
				stoppedAtWatermark = true
				completed = true
			}
		}

		for (let page = 1; !completed && page < MAX_WALLET_TRANSACTION_PAGES; page += 1) {
			if (pageData.length === 0) {
				completed = true
				break
			}

			const nextFromId = pageData.reduce(
				(min, entry) => (BigInt(entry.transaction_id) < BigInt(min) ? entry.transaction_id : min),
				pageData[0]!.transaction_id
			)
			if (String(nextFromId) === fromId) {
				completed = true
				break
			}
			fromId = String(nextFromId)

			const nextResponse = await tokenStoreStub.fetchEsi<RawCharacterMarketTransaction[]>(
				`${basePath}?from_id=${encodeURIComponent(fromId)}`,
				String(characterId),
				{ cacheMode: 'no-store' }
			)
			try {
				pageData = nextResponse.data.map((entry) => ({ ...entry }))
			} finally {
				disposeRpcResult(nextResponse)
			}
			pagesFetched += 1
			addPage(pageData)

			if (hasWatermarkRow(pageData)) {
				watermarkSeen = true
			}
			if (watermarkSeen && !hasRowsAtOrBeyondWatermark(pageData, fromId)) {
				stoppedAtWatermark = true
				completed = true
				break
			}

			// ESI includes the cursor row in a from_id response. A singleton cursor
			// response means there is no older data left to request.
			if (pageData.length === 1 && String(pageData[0]!.transaction_id) === fromId) {
				completed = true
				break
			}
		}

		if (!completed && !stoppedAtWatermark) {
			logger.warn('[CharacterWalletTransactions] Page safety limit reached', {
				characterId,
				pagesFetched,
			})
		}

		const transactions = [...transactionsById.values()].filter(
			(transaction) => parseDateOrNull(transaction.date) !== null
		)
		const newTransactions = transactions
			.filter((transaction) => {
				if (storedMaxTransactionId === null) {
					return true
				}
				if (compareNumericStrings(String(transaction.transaction_id), storedMaxTransactionId) > 0) {
					return true
				}
				const transactionDate = parseDateOrNull(transaction.date)
				return (
					storedMaxTransactionDate !== null &&
					transactionDate !== null &&
					transactionDate >= storedMaxTransactionDate
				)
			})
			.sort((left, right) => {
				const leftDate = parseDateOrNull(left.date)
				const rightDate = parseDateOrNull(right.date)
				if (leftDate !== null && rightDate !== null && leftDate.getTime() !== rightDate.getTime()) {
					return leftDate < rightDate ? -1 : 1
				}
				return compareNumericStrings(String(left.transaction_id), String(right.transaction_id))
			})

		for (
			let index = 0;
			index < newTransactions.length;
			index += WALLET_TRANSACTION_INSERT_BATCH_SIZE
		) {
			const batch = newTransactions.slice(index, index + WALLET_TRANSACTION_INSERT_BATCH_SIZE)
			const values = batch.map((transaction) => ({
				characterId,
				transactionId: String(transaction.transaction_id),
				date: parseDateOrNull(transaction.date) as Date,
				typeId: String(transaction.type_id),
				quantity: transaction.quantity,
				unitPrice: String(transaction.unit_price),
				clientId: String(transaction.client_id),
				locationId: String(transaction.location_id),
				isBuy: transaction.is_buy,
				isPersonal: transaction.is_personal,
				journalRefId: String(transaction.journal_ref_id),
				updatedAt: new Date(),
			}))
			await this.db
				.insert(characterMarketTransactions)
				.values(values)
				.onConflictDoNothing({
					target: [
						characterMarketTransactions.characterId,
						characterMarketTransactions.transactionId,
					],
				})
		}
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
		>(`/characters/${String(characterId)}/orders`, String(characterId), {
			cacheMode: 'no-store',
		})

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
			logger.error(`Failed to fetch skills from ESI for character ${characterId}:`, error)
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

	async triggerManualCharacterSyncBatch(): Promise<{
		batchId: string
		totalWorkflowInstances: number
		totalCharacters: number
		ownedUserWorkflows: number
		unownedCharacterWorkflows: number
		created: number
		failed: number
		workflowInstanceIds: string[]
		startedAt: string
	}> {
		const startedAt = new Date().toISOString()
		const PAGE_SIZE = 100
		const BATCH_SIZE = 75
		// Manual runs should stay near-immediate, but still avoid a perfectly synchronized spike.
		const JITTER_WINDOW_SECONDS = 60

		let totalUsers = 0
		let totalCharacters = 0
		let created = 0
		let failed = 0
		let processedUsers = 0
		const createdIds: string[] = []

		let offset = 0
		let pageIndex = 0

		while (true) {
			const page = await this.env.CORE.listUsersWithActiveCharactersPage({
				limit: PAGE_SIZE,
				offset,
			})
			if (pageIndex === 0) {
				totalUsers = page.totalCount
			}
			if (page.users.length === 0) {
				break
			}

			totalCharacters += page.users.reduce((sum, entry) => sum + entry.characterIds.length, 0)
			const workflows = buildUserSyncWorkflowOptions({
				userBatches: page.users,
				trigger: 'api',
				totalCount: totalUsers,
				startIndex: processedUsers,
				jitterWindowSeconds: JITTER_WINDOW_SECONDS,
			})

			for (let i = 0; i < workflows.length; i += BATCH_SIZE) {
				const batch = workflows.slice(i, i + BATCH_SIZE)
				try {
					await createWorkflowBatch(this.env.EVE_CHARACTER_SYNC, batch)
					created += batch.length
					createdIds.push(...batch.map((entry: { id: string }) => entry.id))
				} catch {
					failed += batch.length
				}
			}

			processedUsers += page.users.length
			offset += page.users.length
			pageIndex += 1
			if (offset >= totalUsers) {
				break
			}
		}

		const batchId = crypto.randomUUID()
		const workflowIdChunks = this.chunkWorkflowInstanceIds(createdIds)
		// Keep each storage value bounded so a large manual run doesn't trip DO storage limits.
		for (const [chunkIndex, chunk] of workflowIdChunks.entries()) {
			await this.state.storage.put(this.getManualBatchChunkKey(batchId, chunkIndex), chunk)
		}
		await this.state.storage.put(this.getManualBatchMetaKey(batchId), {
			batchId,
			startedAt,
			workflowInstanceCount: createdIds.length,
			chunkCount: workflowIdChunks.length,
		})

		return {
			batchId,
			totalWorkflowInstances: created + failed,
			totalCharacters,
			ownedUserWorkflows: totalUsers,
			unownedCharacterWorkflows: 0,
			created,
			failed,
			workflowInstanceIds: createdIds,
			startedAt,
		}
	}

	async getManualCharacterSyncBatchStatus(batchId: string): Promise<{
		batchId: string
		startedAt: string
		total: number
		statusCounts: {
			queued: number
			running: number
			waiting: number
			complete: number
			errored: number
			terminated: number
			unknown: number
		}
		failedInstances: Array<{
			id: string
			status: string
			error?: string
		}>
	}> {
		const metaKey = this.getManualBatchMetaKey(batchId)
		const stored = await this.state.storage.get<{
			batchId: string
			startedAt: string
			workflowInstanceCount?: number
			chunkCount?: number
		}>(metaKey)

		const legacyStored = !stored
			? await this.state.storage.get<{
					batchId: string
					startedAt: string
					workflowInstanceIds: string[]
				}>(`${EveCharacterDataDO.MANUAL_BATCH_STORAGE_PREFIX}${batchId}`)
			: null

		if (!stored && !legacyStored) {
			throw new Error('Manual sync batch not found')
		}

		const workflowInstanceIds: string[] = []
		if (stored) {
			for (let chunkIndex = 0; chunkIndex < (stored.chunkCount ?? 0); chunkIndex += 1) {
				const chunk = await this.state.storage.get<string[]>(
					this.getManualBatchChunkKey(batchId, chunkIndex)
				)
				if (chunk?.length) {
					workflowInstanceIds.push(...chunk)
				}
			}
		} else if (legacyStored) {
			workflowInstanceIds.push(...legacyStored.workflowInstanceIds)
		}

		const statusCounts = {
			queued: 0,
			running: 0,
			waiting: 0,
			complete: 0,
			errored: 0,
			terminated: 0,
			unknown: 0,
		}
		const failedInstances: Array<{ id: string; status: string; error?: string }> = []

		for (const workflowId of workflowInstanceIds) {
			try {
				const instance = await this.env.EVE_CHARACTER_SYNC.get(workflowId)
				const status = await instance.status()
				const runStatus = status.status
				if (runStatus in statusCounts) {
					statusCounts[runStatus as keyof typeof statusCounts]++
				} else {
					statusCounts.unknown++
				}
				if (runStatus === 'errored' || runStatus === 'terminated') {
					failedInstances.push({
						id: workflowId,
						status: runStatus,
						error:
							status.error && typeof status.error === 'object' && 'message' in status.error
								? String((status.error as { message?: unknown }).message ?? '')
								: undefined,
					})
				}
			} catch (error) {
				statusCounts.unknown++
				failedInstances.push({
					id: workflowId,
					status: 'unknown',
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}

		return {
			batchId: stored?.batchId ?? legacyStored!.batchId,
			startedAt: stored?.startedAt ?? legacyStored!.startedAt,
			total: workflowInstanceIds.length,
			statusCounts,
			failedInstances,
		}
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
