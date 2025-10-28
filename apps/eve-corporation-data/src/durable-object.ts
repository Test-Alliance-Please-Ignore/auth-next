import { DurableObject } from 'cloudflare:workers'

import { and, desc, eq, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from './db'
import {
	characterCorporationRoles,
	corporationAssets,
	corporationConfig,
	corporationContracts,
	corporationIndustryJobs,
	corporationKillmails,
	corporationMembers,
	corporationMemberTracking,
	corporationOrders,
	corporationPublicInfo,
	corporationStructures,
	corporationWalletJournal,
	corporationWallets,
	corporationWalletTransactions,
} from './db/schema'
import { DirectorManager } from './director-manager'

import type {
	CharacterCorporationRolesData,
	CorporationAccessVerification,
	CorporationAssetData,
	CorporationAssetsData,
	CorporationConfigData,
	CorporationContractData,
	CorporationCoreData,
	CorporationFinancialData,
	CorporationIndustryJobData,
	CorporationKillmailData,
	CorporationMarketData,
	CorporationMemberData,
	CorporationMemberTrackingData,
	CorporationOrderData,
	CorporationPublicData,
	CorporationRole,
	CorporationStructureData,
	CorporationWalletData,
	CorporationWalletJournalData,
	CorporationWalletTransactionData,
	DirectorHealth,
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationStructure,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EveCorporationData,
} from '@repo/eve-corporation-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'

/**
 * EveCorporationData Durable Object
 *
 * Each corporation gets its own Durable Object instance for data isolation.
 * Uses PostgreSQL for persistent storage and eve-token-store for ESI access.
 *
 * Instance ID pattern: `{corporationId}`
 * Example: `98000001`
 */
export class EveCorporationDataDO extends DurableObject<Env> implements EveCorporationData {
	private db: ReturnType<typeof createDb>

	/**
	 * Initialize the Durable Object with database connection
	 */
	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	// ========================================================================
	// HELPER METHODS
	// ========================================================================

	/**
	 * Get token store stub for ESI requests
	 */
	private getTokenStoreStub(): EveTokenStore {
		return getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
	}

	/**
	 * Get the configured character ID for this corporation
	 * @deprecated Use DirectorManager.selectDirector() instead for multi-director support
	 * @throws Error if corporation not configured
	 */
	private async getConfiguredCharacter(
		corporationId: string
	): Promise<{ characterId: string; corporationId: string }> {
		// Try to get a healthy director first
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		const directorManager = new DirectorManager(
			this.db,
			config.corporationId,
			this.getTokenStoreStub()
		)
		const director = await directorManager.selectDirector()

		if (!director) {
			throw new Error('No healthy directors available. Please add or verify directors.')
		}

		return {
			characterId: director.characterId,
			corporationId: config.corporationId,
		}
	}

	/**
	 * Get DirectorManager instance for this corporation
	 */
	private async getDirectorManager(): Promise<DirectorManager> {
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		return new DirectorManager(this.db, config.corporationId, this.getTokenStoreStub())
	}

	/**
	 * Check if character has a required role
	 */
	private async hasRequiredRole(
		characterId: string,
		requiredRole: CorporationRole
	): Promise<boolean> {
		const rolesData = await this.db.query.characterCorporationRoles.findFirst({
			where: eq(characterCorporationRoles.characterId, characterId),
		})

		if (!rolesData) {
			return false
		}

		// Check all role types
		const allRoles = [
			...(rolesData.roles || []),
			...(rolesData.rolesAtHq || []),
			...(rolesData.rolesAtBase || []),
			...(rolesData.rolesAtOther || []),
		]

		return allRoles.includes(requiredRole)
	}

	/**
	 * Verify character has one of the required roles
	 */
	private async verifyRole(characterId: string, roles: CorporationRole[]): Promise<void> {
		for (const role of roles) {
			if (await this.hasRequiredRole(characterId, role)) {
				return // Has at least one required role
			}
		}

		throw new Error(`Character lacks required role(s): ${roles.join(', ')}`)
	}

	// ========================================================================
	// CONFIGURATION METHODS
	// ========================================================================

	/**
	 * Configure which character to use for API access (legacy method for backwards compatibility)
	 * @deprecated Use addDirector() instead
	 */
	async setCharacter(
		corporationId: string,
		characterId: string,
		characterName: string
	): Promise<void> {
		// Ensure corporation config exists
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			await this.db.insert(corporationConfig).values({
				corporationId: String(corporationId),
				isVerified: false,
				lastVerified: null,
				updatedAt: new Date(),
			})
		}

		// Add as a director instead
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())

		// Check if director already exists
		const directors = await directorManager.getAllDirectors()
		const existingDirector = directors.find((d) => d.characterId === characterId)

		if (!existingDirector) {
			await directorManager.addDirector(characterId, characterName, 100)
		}
	}

	/**
	 * Get the configured character for this corporation
	 * @deprecated Use getDirectors() instead for multi-director support
	 */
	async getConfiguration(): Promise<CorporationConfigData | null> {
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			return null
		}

		// Get the first director (primary) for backwards compatibility
		const directorManager = new DirectorManager(
			this.db,
			config.corporationId,
			this.getTokenStoreStub()
		)
		const directors = await directorManager.getAllDirectors()
		const primaryDirector = directors[0] // First director by priority

		return {
			corporationId: config.corporationId,
			characterId: primaryDirector?.characterId || '',
			characterName: primaryDirector?.characterName || '',
			lastVerified: config.lastVerified,
			isVerified: config.isVerified,
			createdAt: config.createdAt,
			updatedAt: config.updatedAt,
		}
	}

	/**
	 * Verify that the configured character has access to corporation data
	 * @deprecated Use verifyAllDirectorsHealth() instead for multi-director support
	 */
	async verifyAccess(): Promise<CorporationAccessVerification> {
		console.log('[EveCorporationData] verifyAccess: Starting verification')
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			console.log('[EveCorporationData] verifyAccess: No configuration found')
			return {
				hasAccess: false,
				characterId: null,
				characterName: null,
				verifiedRoles: [],
				lastVerified: null,
			}
		}

		// Use the new director verification system
		const directorManager = new DirectorManager(
			this.db,
			config.corporationId,
			this.getTokenStoreStub()
		)
		const result = await directorManager.verifyAllDirectorsHealth()

		console.log('[EveCorporationData] verifyAccess: Verification complete', {
			verified: result.verified,
			failed: result.failed,
		})

		// Get the first healthy director for backwards compatibility
		const healthyDirectors = await directorManager.getHealthyDirectors()
		const primaryDirector = healthyDirectors[0]

		if (!primaryDirector) {
			return {
				hasAccess: false,
				characterId: null,
				characterName: null,
				verifiedRoles: [],
				lastVerified: config.lastVerified,
			}
		}

		// Get roles for the primary director
		const rolesData = await this.db.query.characterCorporationRoles.findFirst({
			where: eq(characterCorporationRoles.characterId, primaryDirector.characterId),
		})

		const verifiedRoles = rolesData
			? [
					...(rolesData.roles || []),
					...(rolesData.rolesAtHq || []),
					...(rolesData.rolesAtBase || []),
					...(rolesData.rolesAtOther || []),
				]
			: []

		return {
			hasAccess: result.verified > 0,
			characterId: primaryDirector.characterId,
			characterName: primaryDirector.characterName,
			verifiedRoles,
			lastVerified: config.lastVerified,
		}
	}

	// ========================================================================
	// DIRECTOR MANAGEMENT METHODS
	// ========================================================================

	/**
	 * Add a new director character for this corporation
	 */
	async addDirector(
		corporationId: string,
		characterId: string,
		characterName: string,
		priority = 100
	): Promise<void> {
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			// Create config if it doesn't exist
			await this.db.insert(corporationConfig).values({
				corporationId: String(corporationId),
				isVerified: false,
				lastVerified: null,
				updatedAt: new Date(),
			})
		}

		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		await directorManager.addDirector(characterId, characterName, priority)
	}

	/**
	 * Remove a director character from this corporation
	 */
	async removeDirector(corporationId: string, characterId: string): Promise<void> {
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		await directorManager.removeDirector(characterId)
	}

	/**
	 * Update a director's priority
	 */
	async updateDirectorPriority(
		corporationId: string,
		characterId: string,
		priority: number
	): Promise<void> {
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		await directorManager.updateDirectorPriority(characterId, priority)
	}

	/**
	 * Get all directors for this corporation
	 */
	async getDirectors(corporationId: string): Promise<DirectorHealth[]> {
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		return await directorManager.getAllDirectors()
	}

	/**
	 * Get healthy directors for this corporation
	 */
	async getHealthyDirectors(corporationId: string): Promise<DirectorHealth[]> {
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		return await directorManager.getHealthyDirectors()
	}

	/**
	 * Verify health of a specific director
	 */
	async verifyDirectorHealth(corporationId: string, directorId: string): Promise<boolean> {
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		return await directorManager.verifyDirectorHealth(directorId)
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(
		corporationId: string
	): Promise<{ verified: number; failed: number }> {
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())
		return await directorManager.verifyAllDirectorsHealth()
	}

	// ========================================================================
	// FETCH AND STORE METHODS (private)
	// ========================================================================

	/**
	 * Fetch and store public corporation information
	 */
	private async fetchAndStorePublicInfo(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const tokenStore = this.getTokenStoreStub()
		const response = await tokenStore.fetchPublicEsi<any>(`/corporations/${corporationId}`)

		// ESI returns numeric IDs at runtime despite our type definitions
		// Cast to any to force proper conversion
		const data = response.data as any

		// Convert all numeric IDs to strings explicitly
		const ceoIdStr: string = String(data.ceo_id)
		const creatorIdStr: string = String(data.creator_id)
		const homeStationIdStr: string | null = data.home_station_id
			? String(data.home_station_id)
			: null
		const allianceIdStr: string | null = data.alliance_id ? String(data.alliance_id) : null
		const factionIdStr: string | null = data.faction_id ? String(data.faction_id) : null

		await this.db
			.insert(corporationPublicInfo)
			.values({
				corporationId: String(corporationId),
				name: data.name,
				ticker: data.ticker,
				ceoId: ceoIdStr,
				creatorId: creatorIdStr,
				dateFounded: data.date_founded ? new Date(data.date_founded) : null,
				description: data.description || null,
				homeStationId: homeStationIdStr,
				memberCount: data.member_count,
				shares: data.shares ? data.shares.toString() : null,
				taxRate: data.tax_rate.toString(),
				url: data.url || null,
				allianceId: allianceIdStr,
				factionId: factionIdStr,
				warEligible: data.war_eligible || null,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: corporationPublicInfo.corporationId,
				set: {
					name: data.name,
					ticker: data.ticker,
					ceoId: ceoIdStr,
					memberCount: data.member_count,
					shares: data.shares ? data.shares.toString() : null,
					taxRate: data.tax_rate.toString(),
					url: data.url || null,
					allianceId: allianceIdStr,
					factionId: factionIdStr,
					warEligible: data.war_eligible || null,
					updatedAt: sql`excluded.updated_at`,
				},
			})
	}

	/**
	 * Fetch and store corporation members
	 */
	private async fetchAndStoreMembers(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		const tokenStore = this.getTokenStoreStub()

		// ESI returns numbers for character IDs, but we need strings
		const response = await tokenStore.fetchEsi<number[]>(
			`/corporations/${corporationId}/members`,
			characterId
		)

		// Convert numeric IDs to strings
		const memberIds: EsiCorporationMembers = response.data.map(String)

		// Upsert members in batch to improve performance
		if (memberIds.length > 0) {
			const values = memberIds.map((memberId) => ({
				corporationId: String(corporationId),
				characterId: memberId,
			}))

			try {
				await this.db
					.insert(corporationMembers)
					.values(values)
					.onConflictDoNothing({
						target: [corporationMembers.corporationId, corporationMembers.characterId],
					})
			} catch (error) {
				console.error('[fetchAndStoreMembers] Database insert failed:', {
					error,
					errorMessage: error instanceof Error ? error.message : String(error),
					errorStack: error instanceof Error ? error.stack : undefined,
					errorName: error instanceof Error ? error.name : undefined,
					errorCause: error instanceof Error ? error.cause : undefined,
					corporationId: String(corporationId),
					memberCount: memberIds.length,
					firstMember: memberIds[0],
				})
				throw error
			}
		}
	}

	/**
	 * Fetch and store member tracking data
	 */
	private async fetchAndStoreMemberTracking(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				character_id: number
				base_id?: number
				location_id?: number
				logoff_date?: string
				logon_date?: string
				ship_type_id?: number
				start_date?: string
			}>
		>(`/corporations/${corporationId}/membertracking`, characterId)

		const rawData = response.data

		// Convert numeric IDs to strings
		const trackingData: EsiCorporationMemberTracking[] = rawData.map((member) => ({
			character_id: String(member.character_id),
			base_id: member.base_id ? String(member.base_id) : undefined,
			location_id: member.location_id ? String(member.location_id) : undefined,
			logoff_date: member.logoff_date,
			logon_date: member.logon_date,
			ship_type_id: member.ship_type_id ? String(member.ship_type_id) : undefined,
			start_date: member.start_date,
		}))

		for (const member of trackingData) {
			await this.db
				.insert(corporationMemberTracking)
				.values({
					corporationId: String(corporationId),
					characterId: member.character_id,
					baseId: member.base_id || null,
					locationId: member.location_id || null,
					logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
					logonDate: member.logon_date ? new Date(member.logon_date) : null,
					shipTypeId: member.ship_type_id || null,
					startDate: member.start_date ? new Date(member.start_date) : null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationMemberTracking.corporationId, corporationMemberTracking.characterId],
					set: {
						baseId: member.base_id || null,
						locationId: member.location_id || null,
						logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
						logonDate: member.logon_date ? new Date(member.logon_date) : null,
						shipTypeId: member.ship_type_id || null,
						startDate: member.start_date ? new Date(member.start_date) : null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation wallets
	 */
	private async fetchAndStoreWallets(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationWallet[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/wallets`,
			characterId
		)

		const wallets = response.data

		for (const wallet of wallets) {
			await this.db
				.insert(corporationWallets)
				.values({
					corporationId: String(corporationId),
					division: wallet.division,
					balance: wallet.balance.toString(),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: wallet.balance.toString(),
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store wallet journal for a division
	 */
	private async fetchAndStoreWalletJournal(
		corporationId: string,
		division: number,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				id: number
				amount?: number
				balance?: number
				context_id?: number
				context_id_type?: string
				date: string
				description: string
				first_party_id?: number
				reason?: string
				ref_type: string
				second_party_id?: number
				tax?: number
				tax_receiver_id?: number
			}>
		>(`/corporations/${corporationId}/wallets/${division}/journal`, characterId)

		const rawEntries = response.data

		// Convert numeric IDs to strings
		const entries: EsiCorporationWalletJournalEntry[] = rawEntries.map((entry) => ({
			id: String(entry.id),
			amount: entry.amount,
			balance: entry.balance,
			context_id: entry.context_id ? String(entry.context_id) : undefined,
			context_id_type: entry.context_id_type,
			date: entry.date,
			description: entry.description,
			first_party_id: entry.first_party_id ? String(entry.first_party_id) : undefined,
			reason: entry.reason,
			ref_type: entry.ref_type,
			second_party_id: entry.second_party_id ? String(entry.second_party_id) : undefined,
			tax: entry.tax,
			tax_receiver_id: entry.tax_receiver_id ? String(entry.tax_receiver_id) : undefined,
		}))

		for (const entry of entries) {
			await this.db
				.insert(corporationWalletJournal)
				.values({
					corporationId: String(corporationId),
					division,
					journalId: entry.id,
					amount: entry.amount?.toString() || null,
					balance: entry.balance?.toString() || null,
					contextId: entry.context_id || null,
					contextIdType: entry.context_id_type || null,
					date: new Date(entry.date),
					description: entry.description,
					firstPartyId: entry.first_party_id || null,
					reason: entry.reason || null,
					refType: entry.ref_type,
					secondPartyId: entry.second_party_id || null,
					tax: entry.tax?.toString() || null,
					taxReceiverId: entry.tax_receiver_id || null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						corporationWalletJournal.corporationId,
						corporationWalletJournal.division,
						corporationWalletJournal.journalId,
					],
					set: {
						amount: entry.amount?.toString() || null,
						balance: entry.balance?.toString() || null,
						contextId: entry.context_id || null,
						contextIdType: entry.context_id_type || null,
						description: entry.description,
						reason: entry.reason || null,
						tax: entry.tax?.toString() || null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store wallet transactions for a division
	 */
	private async fetchAndStoreWalletTransactions(
		corporationId: string,
		division: number,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				transaction_id: number
				client_id: number
				date: string
				is_buy: boolean
				is_personal: boolean
				journal_ref_id: number
				location_id: number
				quantity: number
				type_id: number
				unit_price: number
			}>
		>(`/corporations/${corporationId}/wallets/${division}/transactions`, characterId)

		const rawTransactions = response.data

		// Convert numeric IDs to strings
		const transactions: EsiCorporationWalletTransaction[] = rawTransactions.map((tx) => ({
			transaction_id: String(tx.transaction_id),
			client_id: String(tx.client_id),
			date: tx.date,
			is_buy: tx.is_buy,
			is_personal: tx.is_personal,
			journal_ref_id: String(tx.journal_ref_id),
			location_id: String(tx.location_id),
			quantity: tx.quantity,
			type_id: String(tx.type_id),
			unit_price: String(tx.unit_price),
		}))

		for (const tx of transactions) {
			await this.db
				.insert(corporationWalletTransactions)
				.values({
					corporationId: String(corporationId),
					division,
					transactionId: tx.transaction_id,
					clientId: tx.client_id,
					date: new Date(tx.date),
					isBuy: tx.is_buy,
					isPersonal: tx.is_personal,
					journalRefId: tx.journal_ref_id,
					locationId: tx.location_id,
					quantity: tx.quantity,
					typeId: tx.type_id,
					unitPrice: tx.unit_price,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						corporationWalletTransactions.corporationId,
						corporationWalletTransactions.division,
						corporationWalletTransactions.transactionId,
					],
					set: {
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation assets (paginated)
	 */
	private async fetchAndStoreAssets(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()

		// Assets are paginated, fetch all pages
		let page = 1
		let hasMorePages = true

		while (hasMorePages) {
			// ESI returns numbers for IDs, but we need strings
			const response = await tokenStore.fetchEsi<
				Array<{
					item_id: number
					is_singleton: boolean
					location_flag: string
					location_id: number
					location_type: string
					quantity: number
					type_id: number
					is_blueprint_copy?: boolean
				}>
			>(`/corporations/${corporationId}/assets?page=${page}`, characterId)

			const rawAssets = response.data

			if (!rawAssets || rawAssets.length === 0) {
				hasMorePages = false
				break
			}

			// Convert numeric IDs to strings
			const assets: EsiCorporationAsset[] = rawAssets.map((asset) => ({
				item_id: String(asset.item_id),
				is_singleton: asset.is_singleton,
				location_flag: asset.location_flag,
				location_id: String(asset.location_id),
				location_type: asset.location_type,
				quantity: asset.quantity,
				type_id: String(asset.type_id),
				is_blueprint_copy: asset.is_blueprint_copy,
			}))

			for (const asset of assets) {
				await this.db
					.insert(corporationAssets)
					.values({
						corporationId: String(corporationId),
						itemId: asset.item_id,
						isSingleton: asset.is_singleton,
						locationFlag: asset.location_flag,
						locationId: asset.location_id,
						locationType: asset.location_type,
						quantity: asset.quantity,
						typeId: asset.type_id,
						isBlueprintCopy: asset.is_blueprint_copy ?? null,
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [corporationAssets.corporationId, corporationAssets.itemId],
						set: {
							isSingleton: asset.is_singleton,
							locationFlag: asset.location_flag,
							locationId: asset.location_id,
							locationType: asset.location_type,
							quantity: asset.quantity,
							typeId: asset.type_id,
							isBlueprintCopy: asset.is_blueprint_copy ?? null,
							updatedAt: sql`excluded.updated_at`,
						},
					})
			}

			page++
		}
	}

	/**
	 * Fetch and store corporation structures
	 */
	private async fetchAndStoreStructures(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Station_Manager'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				structure_id: number
				type_id: number
				system_id: number
				profile_id: number
				fuel_expires?: string
				next_reinforce_apply?: string
				next_reinforce_hour?: number
				reinforce_hour?: number
				state: string
				state_timer_end?: string
				state_timer_start?: string
				unanchors_at?: string
				services?: Array<{ name: string; state: string }>
			}>
		>(`/corporations/${corporationId}/structures`, characterId)

		const rawStructures = response.data

		// Convert numeric IDs to strings
		const structures: EsiCorporationStructure[] = rawStructures.map((structure) => ({
			structure_id: String(structure.structure_id),
			type_id: String(structure.type_id),
			system_id: String(structure.system_id),
			profile_id: String(structure.profile_id),
			fuel_expires: structure.fuel_expires,
			next_reinforce_apply: structure.next_reinforce_apply,
			next_reinforce_hour: structure.next_reinforce_hour,
			reinforce_hour: structure.reinforce_hour,
			state: structure.state,
			state_timer_end: structure.state_timer_end,
			state_timer_start: structure.state_timer_start,
			unanchors_at: structure.unanchors_at,
			services: structure.services,
		}))

		for (const structure of structures) {
			await this.db
				.insert(corporationStructures)
				.values({
					corporationId: String(corporationId),
					structureId: structure.structure_id,
					typeId: structure.type_id,
					systemId: structure.system_id,
					profileId: structure.profile_id,
					fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
					nextReinforceApply: structure.next_reinforce_apply
						? new Date(structure.next_reinforce_apply)
						: null,
					nextReinforceHour: structure.next_reinforce_hour || null,
					reinforceHour: structure.reinforce_hour || null,
					state: structure.state,
					stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
					stateTimerStart: structure.state_timer_start
						? new Date(structure.state_timer_start)
						: null,
					unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
					services: structure.services || null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationStructures.corporationId, corporationStructures.structureId],
					set: {
						state: structure.state,
						fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
						nextReinforceApply: structure.next_reinforce_apply
							? new Date(structure.next_reinforce_apply)
							: null,
						nextReinforceHour: structure.next_reinforce_hour || null,
						reinforceHour: structure.reinforce_hour || null,
						stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
						stateTimerStart: structure.state_timer_start
							? new Date(structure.state_timer_start)
							: null,
						unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
						services: structure.services || null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation market orders
	 */
	private async fetchAndStoreOrders(corporationId: string, _forceRefresh = false): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant', 'Trader'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				order_id: number
				duration: number
				escrow?: number
				is_buy_order: boolean
				issued: string
				issued_by: number
				location_id: number
				min_volume?: number
				price: number
				range: string
				region_id: number
				type_id: number
				volume_remain: number
				volume_total: number
				wallet_division: number
			}>
		>(`/corporations/${corporationId}/orders`, characterId)

		const rawOrders = response.data

		// Convert numeric IDs to strings
		const orders: EsiCorporationOrder[] = rawOrders.map((order) => ({
			order_id: String(order.order_id),
			duration: order.duration,
			escrow: order.escrow,
			is_buy_order: order.is_buy_order,
			issued: order.issued,
			issued_by: String(order.issued_by),
			location_id: String(order.location_id),
			min_volume: order.min_volume,
			price: order.price,
			range: order.range,
			region_id: String(order.region_id),
			type_id: String(order.type_id),
			volume_remain: order.volume_remain,
			volume_total: order.volume_total,
			wallet_division: order.wallet_division,
		}))

		for (const order of orders) {
			await this.db
				.insert(corporationOrders)
				.values({
					corporationId: String(corporationId),
					orderId: order.order_id,
					duration: order.duration,
					escrow: order.escrow?.toString() || null,
					isBuyOrder: order.is_buy_order,
					issued: new Date(order.issued),
					issuedBy: order.issued_by,
					locationId: order.location_id,
					minVolume: order.min_volume || null,
					price: order.price.toString(),
					range: order.range,
					regionId: order.region_id,
					typeId: order.type_id,
					volumeRemain: order.volume_remain,
					volumeTotal: order.volume_total,
					walletDivision: order.wallet_division,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationOrders.corporationId, corporationOrders.orderId],
					set: {
						volumeRemain: order.volume_remain,
						price: order.price.toString(),
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation contracts
	 */
	private async fetchAndStoreContracts(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				contract_id: number
				acceptor_id?: number
				assignee_id: number
				availability: string
				buyout?: number
				collateral?: number
				date_accepted?: string
				date_completed?: string
				date_expired: string
				date_issued: string
				days_to_complete?: number
				end_location_id?: number
				for_corporation: boolean
				issuer_corporation_id: number
				issuer_id: number
				price?: number
				reward?: number
				start_location_id?: number
				status: string
				title?: string
				type: string
				volume?: number
			}>
		>(`/corporations/${corporationId}/contracts`, characterId)

		const rawContracts = response.data

		// Convert numeric IDs to strings
		const contracts: EsiCorporationContract[] = rawContracts.map((contract) => ({
			contract_id: String(contract.contract_id),
			acceptor_id: contract.acceptor_id ? String(contract.acceptor_id) : undefined,
			assignee_id: String(contract.assignee_id),
			availability: contract.availability,
			buyout: contract.buyout,
			collateral: contract.collateral,
			date_accepted: contract.date_accepted,
			date_completed: contract.date_completed,
			date_expired: contract.date_expired,
			date_issued: contract.date_issued,
			days_to_complete: contract.days_to_complete,
			end_location_id: contract.end_location_id ? String(contract.end_location_id) : undefined,
			for_corporation: contract.for_corporation,
			issuer_corporation_id: String(contract.issuer_corporation_id),
			issuer_id: String(contract.issuer_id),
			price: contract.price,
			reward: contract.reward,
			start_location_id: contract.start_location_id
				? String(contract.start_location_id)
				: undefined,
			status: contract.status,
			title: contract.title,
			type: contract.type,
			volume: contract.volume,
		}))

		for (const contract of contracts) {
			await this.db
				.insert(corporationContracts)
				.values({
					corporationId: String(corporationId),
					contractId: contract.contract_id,
					acceptorId: contract.acceptor_id || null,
					assigneeId: contract.assignee_id,
					availability: contract.availability,
					buyout: contract.buyout?.toString() || null,
					collateral: contract.collateral?.toString() || null,
					dateAccepted: contract.date_accepted ? new Date(contract.date_accepted) : null,
					dateCompleted: contract.date_completed ? new Date(contract.date_completed) : null,
					dateExpired: new Date(contract.date_expired),
					dateIssued: new Date(contract.date_issued),
					daysToComplete: contract.days_to_complete || null,
					endLocationId: contract.end_location_id || null,
					forCorporation: contract.for_corporation,
					issuerCorporationId: contract.issuer_corporation_id,
					issuerId: contract.issuer_id,
					price: contract.price?.toString() || null,
					reward: contract.reward?.toString() || null,
					startLocationId: contract.start_location_id || null,
					status: contract.status,
					title: contract.title || null,
					type: contract.type,
					volume: contract.volume?.toString() || null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationContracts.corporationId, corporationContracts.contractId],
					set: {
						status: contract.status,
						dateAccepted: contract.date_accepted ? new Date(contract.date_accepted) : null,
						dateCompleted: contract.date_completed ? new Date(contract.date_completed) : null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation industry jobs
	 */
	private async fetchAndStoreIndustryJobs(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Factory_Manager'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				job_id: number
				installer_id: number
				facility_id: number
				location_id: number
				activity_id: number
				blueprint_id: number
				blueprint_type_id: number
				blueprint_location_id: number
				output_location_id: number
				runs: number
				cost?: number
				licensed_runs?: number
				probability?: number
				product_type_id?: number
				status: string
				duration: number
				start_date: string
				end_date: string
				pause_date?: string
				completed_date?: string
				completed_character_id?: number
				successful_runs?: number
			}>
		>(`/corporations/${corporationId}/industry/jobs`, characterId)

		const rawJobs = response.data

		// Convert numeric IDs to strings
		const jobs: EsiCorporationIndustryJob[] = rawJobs.map((job) => ({
			job_id: String(job.job_id),
			installer_id: String(job.installer_id),
			facility_id: String(job.facility_id),
			location_id: String(job.location_id),
			activity_id: String(job.activity_id),
			blueprint_id: String(job.blueprint_id),
			blueprint_type_id: String(job.blueprint_type_id),
			blueprint_location_id: String(job.blueprint_location_id),
			output_location_id: String(job.output_location_id),
			runs: job.runs,
			cost: job.cost,
			licensed_runs: job.licensed_runs,
			probability: job.probability,
			product_type_id: job.product_type_id ? String(job.product_type_id) : undefined,
			status: job.status,
			duration: job.duration,
			start_date: job.start_date,
			end_date: job.end_date,
			pause_date: job.pause_date,
			completed_date: job.completed_date,
			completed_character_id: job.completed_character_id
				? String(job.completed_character_id)
				: undefined,
			successful_runs: job.successful_runs,
		}))

		for (const job of jobs) {
			await this.db
				.insert(corporationIndustryJobs)
				.values({
					corporationId: String(corporationId),
					jobId: job.job_id,
					installerId: job.installer_id,
					facilityId: job.facility_id,
					locationId: job.location_id,
					activityId: job.activity_id,
					blueprintId: job.blueprint_id,
					blueprintTypeId: job.blueprint_type_id,
					blueprintLocationId: job.blueprint_location_id,
					outputLocationId: job.output_location_id,
					runs: job.runs,
					cost: job.cost?.toString() || null,
					licensedRuns: job.licensed_runs || null,
					probability: job.probability?.toString() || null,
					productTypeId: job.product_type_id || null,
					status: job.status,
					duration: job.duration,
					startDate: new Date(job.start_date),
					endDate: new Date(job.end_date),
					pauseDate: job.pause_date ? new Date(job.pause_date) : null,
					completedDate: job.completed_date ? new Date(job.completed_date) : null,
					completedCharacterId: job.completed_character_id || null,
					successfulRuns: job.successful_runs || null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationIndustryJobs.corporationId, corporationIndustryJobs.jobId],
					set: {
						status: job.status,
						pauseDate: job.pause_date ? new Date(job.pause_date) : null,
						completedDate: job.completed_date ? new Date(job.completed_date) : null,
						completedCharacterId: job.completed_character_id || null,
						successfulRuns: job.successful_runs || null,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	/**
	 * Fetch and store corporation killmails
	 */
	private async fetchAndStoreKillmails(
		corporationId: string,
		_forceRefresh = false
	): Promise<void> {
		const { characterId } = await this.getConfiguredCharacter(corporationId)
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()
		// ESI returns numbers for IDs, but we need strings
		const response = await tokenStore.fetchEsi<
			Array<{
				killmail_id: number
				killmail_hash: string
			}>
		>(`/corporations/${corporationId}/killmails/recent`, characterId)

		const rawKillmails = response.data

		// Convert numeric IDs to strings
		const killmails: EsiCorporationKillmail[] = rawKillmails.map((km) => ({
			killmail_id: String(km.killmail_id),
			killmail_hash: km.killmail_hash,
		}))

		for (const km of killmails) {
			// Note: killmail_time is not in the ESI response, we'll use updatedAt
			await this.db
				.insert(corporationKillmails)
				.values({
					corporationId: String(corporationId),
					killmailId: km.killmail_id,
					killmailHash: km.killmail_hash,
					killmailTime: new Date(), // ESI doesn't provide time in this endpoint
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationKillmails.corporationId, corporationKillmails.killmailId],
					set: {
						killmailHash: km.killmail_hash,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}
	}

	// ========================================================================
	// FETCH ORCHESTRATION METHODS (public)
	// ========================================================================

	/**
	 * Fetch all accessible corporation data in parallel
	 */
	async fetchAllCorporationData(corporationId: string, forceRefresh = false): Promise<void> {
		console.log('[EveCorporationData] fetchAllCorporationData: Starting', {
			corporationId,
			forceRefresh,
		})

		// Public data
		console.log('[EveCorporationData] fetchAllCorporationData: Fetching public data')
		await this.fetchPublicData(corporationId, forceRefresh)
		console.log('[EveCorporationData] fetchAllCorporationData: Public data fetched')

		// Try to fetch all other data, but don't fail if role verification fails
		console.log('[EveCorporationData] fetchAllCorporationData: Starting parallel fetches')
		const fetchPromises = [
			this.fetchCoreData(corporationId, forceRefresh).catch((e) =>
				console.error('[EveCorporationData] Failed to fetch core data:', e)
			),
			this.fetchFinancialData(corporationId, undefined, forceRefresh).catch((e) =>
				console.error('[EveCorporationData] Failed to fetch financial data:', e)
			),
			this.fetchAssetsData(corporationId, forceRefresh).catch((e) =>
				console.error('[EveCorporationData] Failed to fetch assets data:', e)
			),
			this.fetchMarketData(corporationId, forceRefresh).catch((e) =>
				console.error('[EveCorporationData] Failed to fetch market data:', e)
			),
			this.fetchKillmails(corporationId, forceRefresh).catch((e) =>
				console.error('[EveCorporationData] Failed to fetch killmails:', e)
			),
		]

		const results = await Promise.allSettled(fetchPromises)
		console.log('[EveCorporationData] fetchAllCorporationData: All fetches completed', {
			fulfilled: results.filter((r) => r.status === 'fulfilled').length,
			rejected: results.filter((r) => r.status === 'rejected').length,
		})
	}

	/**
	 * Fetch public corporation data
	 */
	async fetchPublicData(corporationId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStorePublicInfo(corporationId, forceRefresh)
	}

	/**
	 * Fetch core corporation data (members, tracking)
	 */
	async fetchCoreData(corporationId: string, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreMembers(corporationId, forceRefresh),
			this.fetchAndStoreMemberTracking(corporationId, forceRefresh).catch((e) =>
				console.error('Member tracking failed:', e)
			),
		])
	}

	/**
	 * Fetch financial data (wallets, journal, transactions)
	 */
	async fetchFinancialData(
		corporationId: string,
		division?: number,
		forceRefresh = false
	): Promise<void> {
		// Fetch wallets first
		await this.fetchAndStoreWallets(corporationId, forceRefresh)

		// Fetch journal and transactions for specified division(s)
		const divisions = division ? [division] : [1, 2, 3, 4, 5, 6, 7]

		const promises = divisions.flatMap((div) => [
			this.fetchAndStoreWalletJournal(corporationId, div, forceRefresh).catch((e) =>
				console.error(`Failed to fetch journal for division ${div}:`, e)
			),
			this.fetchAndStoreWalletTransactions(corporationId, div, forceRefresh).catch((e) =>
				console.error(`Failed to fetch transactions for division ${div}:`, e)
			),
		])

		await Promise.allSettled(promises)
	}

	/**
	 * Fetch assets and structures
	 */
	async fetchAssetsData(corporationId: string, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreAssets(corporationId, forceRefresh),
			this.fetchAndStoreStructures(corporationId, forceRefresh).catch((e) =>
				console.error('Structures fetch failed:', e)
			),
		])
	}

	/**
	 * Fetch market and industry data
	 */
	async fetchMarketData(corporationId: string, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreOrders(corporationId, forceRefresh).catch((e) =>
				console.error('Orders fetch failed:', e)
			),
			this.fetchAndStoreContracts(corporationId, forceRefresh).catch((e) =>
				console.error('Contracts fetch failed:', e)
			),
			this.fetchAndStoreIndustryJobs(corporationId, forceRefresh).catch((e) =>
				console.error('Industry jobs fetch failed:', e)
			),
		])
	}

	/**
	 * Fetch killmails
	 */
	async fetchKillmails(corporationId: string, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreKillmails(corporationId, forceRefresh)
	}

	// ========================================================================
	// GETTER METHODS (public)
	// ========================================================================

	/**
	 * Get corporation public information
	 */
	async getCorporationInfo(): Promise<CorporationPublicData | null> {
		const result = await this.db.query.corporationPublicInfo.findFirst()

		if (!result) {
			return null
		}

		return {
			corporationId: result.corporationId,
			name: result.name,
			ticker: result.ticker,
			ceoId: result.ceoId,
			creatorId: result.creatorId,
			dateFounded: result.dateFounded,
			description: result.description,
			homeStationId: result.homeStationId,
			memberCount: result.memberCount,
			shares: result.shares,
			taxRate: result.taxRate,
			url: result.url,
			allianceId: result.allianceId,
			factionId: result.factionId,
			warEligible: result.warEligible,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Get corporation members list
	 */
	async getMembers(corporationId: string): Promise<CorporationMemberData[]> {
		const results = await this.db.query.corporationMembers.findMany({
			where: eq(corporationMembers.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			characterId: r.characterId,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation member tracking data
	 */
	async getMemberTracking(corporationId: string): Promise<CorporationMemberTrackingData[]> {
		const results = await this.db.query.corporationMemberTracking.findMany({
			where: eq(corporationMemberTracking.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			characterId: r.characterId,
			baseId: r.baseId,
			locationId: r.locationId,
			logoffDate: r.logoffDate,
			logonDate: r.logonDate,
			shipTypeId: r.shipTypeId,
			startDate: r.startDate,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation core data
	 */
	async getCoreData(corporationId: string): Promise<CorporationCoreData | null> {
		const [publicInfo, members, memberTracking] = await Promise.all([
			this.getCorporationInfo(),
			this.getMembers(corporationId),
			this.getMemberTracking(corporationId),
		])

		if (!publicInfo) {
			return null
		}

		return {
			publicInfo,
			members,
			memberTracking,
		}
	}

	/**
	 * Get corporation wallets
	 */
	async getWallets(corporationId: string, division?: number): Promise<CorporationWalletData[]> {
		const results = division
			? await this.db.query.corporationWallets.findMany({
					where: and(
						eq(corporationWallets.corporationId, corporationId),
						eq(corporationWallets.division, division)
					),
				})
			: await this.db.query.corporationWallets.findMany({
					where: eq(corporationWallets.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			balance: r.balance,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get wallet journal entries
	 */
	async getWalletJournal(
		corporationId: string,
		division?: number,
		limit = 1000
	): Promise<CorporationWalletJournalData[]> {
		const results = division
			? await this.db.query.corporationWalletJournal.findMany({
					where: and(
						eq(corporationWalletJournal.corporationId, corporationId),
						eq(corporationWalletJournal.division, division)
					),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})
			: await this.db.query.corporationWalletJournal.findMany({
					where: eq(corporationWalletJournal.corporationId, corporationId),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			journalId: r.journalId,
			amount: r.amount,
			balance: r.balance,
			contextId: r.contextId,
			contextIdType: r.contextIdType,
			date: r.date,
			description: r.description,
			firstPartyId: r.firstPartyId,
			reason: r.reason,
			refType: r.refType,
			secondPartyId: r.secondPartyId,
			tax: r.tax,
			taxReceiverId: r.taxReceiverId,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get wallet transactions
	 */
	async getWalletTransactions(
		corporationId: string,
		division?: number,
		limit = 1000
	): Promise<CorporationWalletTransactionData[]> {
		const results = division
			? await this.db.query.corporationWalletTransactions.findMany({
					where: and(
						eq(corporationWalletTransactions.corporationId, corporationId),
						eq(corporationWalletTransactions.division, division)
					),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})
			: await this.db.query.corporationWalletTransactions.findMany({
					where: eq(corporationWalletTransactions.corporationId, corporationId),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			division: r.division,
			transactionId: r.transactionId,
			clientId: r.clientId,
			date: r.date,
			isBuy: r.isBuy,
			isPersonal: r.isPersonal,
			journalRefId: r.journalRefId,
			locationId: r.locationId,
			quantity: r.quantity,
			typeId: r.typeId,
			unitPrice: r.unitPrice,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete financial data
	 */
	async getFinancialData(
		corporationId: string,
		division?: number
	): Promise<CorporationFinancialData | null> {
		const [wallets, journalEntries, transactions] = await Promise.all([
			this.getWallets(corporationId, division),
			this.getWalletJournal(corporationId, division),
			this.getWalletTransactions(corporationId, division),
		])

		if (wallets.length === 0 && journalEntries.length === 0 && transactions.length === 0) {
			return null
		}

		return {
			wallets,
			journalEntries,
			transactions,
		}
	}

	/**
	 * Get corporation assets
	 */
	async getAssets(corporationId: string, limit = 10000): Promise<CorporationAssetData[]> {
		const results = await this.db.query.corporationAssets.findMany({
			where: eq(corporationAssets.corporationId, corporationId),
			limit,
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			itemId: r.itemId,
			isSingleton: r.isSingleton,
			locationFlag: r.locationFlag,
			locationId: r.locationId,
			locationType: r.locationType,
			quantity: r.quantity,
			typeId: r.typeId,
			isBlueprintCopy: r.isBlueprintCopy,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation structures
	 */
	async getStructures(corporationId: string): Promise<CorporationStructureData[]> {
		const results = await this.db.query.corporationStructures.findMany({
			where: eq(corporationStructures.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			structureId: r.structureId,
			typeId: r.typeId,
			systemId: r.systemId,
			profileId: r.profileId,
			fuelExpires: r.fuelExpires,
			nextReinforceApply: r.nextReinforceApply,
			nextReinforceHour: r.nextReinforceHour,
			reinforceHour: r.reinforceHour,
			state: r.state,
			stateTimerEnd: r.stateTimerEnd,
			stateTimerStart: r.stateTimerStart,
			unanchorsAt: r.unanchorsAt,
			services: r.services,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete assets data
	 */
	async getAssetsData(corporationId: string): Promise<CorporationAssetsData | null> {
		const [assets, structures] = await Promise.all([
			this.getAssets(corporationId),
			this.getStructures(corporationId),
		])

		if (assets.length === 0 && structures.length === 0) {
			return null
		}

		return {
			assets,
			structures,
		}
	}

	/**
	 * Get corporation market orders
	 */
	async getOrders(corporationId: string): Promise<CorporationOrderData[]> {
		const results = await this.db.query.corporationOrders.findMany({
			where: eq(corporationOrders.corporationId, corporationId),
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			orderId: r.orderId,
			duration: r.duration,
			escrow: r.escrow,
			isBuyOrder: r.isBuyOrder,
			issued: r.issued,
			issuedBy: r.issuedBy,
			locationId: r.locationId,
			minVolume: r.minVolume,
			price: r.price,
			range: r.range,
			regionId: r.regionId,
			typeId: r.typeId,
			volumeRemain: r.volumeRemain,
			volumeTotal: r.volumeTotal,
			walletDivision: r.walletDivision,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation contracts
	 */
	async getContracts(corporationId: string, status?: string): Promise<CorporationContractData[]> {
		const results = status
			? await this.db.query.corporationContracts.findMany({
					where: and(
						eq(corporationContracts.corporationId, corporationId),
						eq(corporationContracts.status, status)
					),
				})
			: await this.db.query.corporationContracts.findMany({
					where: eq(corporationContracts.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			contractId: r.contractId,
			acceptorId: r.acceptorId,
			assigneeId: r.assigneeId,
			availability: r.availability,
			buyout: r.buyout,
			collateral: r.collateral,
			dateAccepted: r.dateAccepted,
			dateCompleted: r.dateCompleted,
			dateExpired: r.dateExpired,
			dateIssued: r.dateIssued,
			daysToComplete: r.daysToComplete,
			endLocationId: r.endLocationId,
			forCorporation: r.forCorporation,
			issuerCorporationId: r.issuerCorporationId,
			issuerId: r.issuerId,
			price: r.price,
			reward: r.reward,
			startLocationId: r.startLocationId,
			status: r.status,
			title: r.title,
			type: r.type,
			volume: r.volume,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get corporation industry jobs
	 */
	async getIndustryJobs(
		corporationId: string,
		status?: string
	): Promise<CorporationIndustryJobData[]> {
		const results = status
			? await this.db.query.corporationIndustryJobs.findMany({
					where: and(
						eq(corporationIndustryJobs.corporationId, corporationId),
						eq(corporationIndustryJobs.status, status)
					),
				})
			: await this.db.query.corporationIndustryJobs.findMany({
					where: eq(corporationIndustryJobs.corporationId, corporationId),
				})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			jobId: r.jobId,
			installerId: r.installerId,
			facilityId: r.facilityId,
			locationId: r.locationId,
			activityId: r.activityId,
			blueprintId: r.blueprintId,
			blueprintTypeId: r.blueprintTypeId,
			blueprintLocationId: r.blueprintLocationId,
			outputLocationId: r.outputLocationId,
			runs: r.runs,
			cost: r.cost,
			licensedRuns: r.licensedRuns,
			probability: r.probability,
			productTypeId: r.productTypeId,
			status: r.status,
			duration: r.duration,
			startDate: r.startDate,
			endDate: r.endDate,
			pauseDate: r.pauseDate,
			completedDate: r.completedDate,
			completedCharacterId: r.completedCharacterId,
			successfulRuns: r.successfulRuns,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get complete market data
	 */
	async getMarketData(corporationId: string): Promise<CorporationMarketData | null> {
		const [orders, contracts, industryJobs] = await Promise.all([
			this.getOrders(corporationId),
			this.getContracts(corporationId),
			this.getIndustryJobs(corporationId),
		])

		if (orders.length === 0 && contracts.length === 0 && industryJobs.length === 0) {
			return null
		}

		return {
			orders,
			contracts,
			industryJobs,
		}
	}

	/**
	 * Get corporation killmails
	 */
	async getKillmails(corporationId: string, limit = 100): Promise<CorporationKillmailData[]> {
		const results = await this.db.query.corporationKillmails.findMany({
			where: eq(corporationKillmails.corporationId, corporationId),
			orderBy: desc(corporationKillmails.killmailTime),
			limit,
		})

		return results.map((r) => ({
			id: r.id,
			corporationId: r.corporationId,
			killmailId: r.killmailId,
			killmailHash: r.killmailHash,
			killmailTime: r.killmailTime,
			updatedAt: r.updatedAt,
		}))
	}

	/**
	 * Get character's corporation roles
	 */
	async getCharacterRoles(characterId: string): Promise<CharacterCorporationRolesData | null> {
		const result = await this.db.query.characterCorporationRoles.findFirst({
			where: eq(characterCorporationRoles.characterId, characterId),
		})

		if (!result) {
			return null
		}

		return {
			id: result.id,
			corporationId: result.corporationId,
			characterId: result.characterId,
			roles: result.roles,
			rolesAtHq: result.rolesAtHq || undefined,
			rolesAtBase: result.rolesAtBase || undefined,
			rolesAtOther: result.rolesAtOther || undefined,
			updatedAt: result.updatedAt,
		}
	}

	/**
	 * Fetch handler for HTTP requests (minimal implementation)
	 */
	async fetch(_request: Request): Promise<Response> {
		return new Response('EveCorporationData Durable Object', { status: 200 })
	}
}
