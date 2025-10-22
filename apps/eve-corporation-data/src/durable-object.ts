import { and, desc, eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import type { EveTokenStore, EsiResponse } from '@repo/eve-token-store'
import { DurableObject } from 'cloudflare:workers'

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
	EsiCharacterRoles,
	EsiCorporationAsset,
	EsiCorporationContract,
	EsiCorporationIndustryJob,
	EsiCorporationKillmail,
	EsiCorporationMembers,
	EsiCorporationMemberTracking,
	EsiCorporationOrder,
	EsiCorporationPublicInfo,
	EsiCorporationStructure,
	EsiCorporationWallet,
	EsiCorporationWalletJournalEntry,
	EsiCorporationWalletTransaction,
	EveCorporationData,
} from '@repo/eve-corporation-data'

import { createDb } from './db'
import {
	characterCorporationRoles,
	corporationAssets,
	corporationConfig,
	corporationContracts,
	corporationDirectors,
	corporationIndustryJobs,
	corporationKillmails,
	corporationMembers,
	corporationMemberTracking,
	corporationOrders,
	corporationPublicInfo,
	corporationStructures,
	corporationWallets,
	corporationWalletJournal,
	corporationWalletTransactions,
} from './db/schema'
import { DirectorManager, type DirectorHealth, type SelectedDirector } from './director-manager'

import type { Env } from './context'

/**
 * EveCorporationData Durable Object
 *
 * Each corporation gets its own Durable Object instance for data isolation.
 * Uses PostgreSQL for persistent storage and eve-token-store for ESI access.
 *
 * Instance ID pattern: `corp-{corporationId}`
 * Example: `corp-98000001`
 */
export class EveCorporationDataDO extends DurableObject<Env> implements EveCorporationData {
	private db: ReturnType<typeof createDb>

	/**
	 * Initialize the Durable Object with database connection
	 */
	constructor(public state: DurableObjectState, public env: Env) {
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
	private async getConfiguredCharacter(): Promise<{ characterId: number; corporationId: number }> {
		// Try to get a healthy director first
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			throw new Error('Corporation not configured.')
		}

		const directorManager = new DirectorManager(this.db, config.corporationId, this.getTokenStoreStub())
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
	private async hasRequiredRole(characterId: number, requiredRole: CorporationRole): Promise<boolean> {
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
	private async verifyRole(characterId: number, roles: CorporationRole[]): Promise<void> {
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
	async setCharacter(corporationId: number, characterId: number, characterName: string): Promise<void> {
		// Ensure corporation config exists
		const config = await this.db.query.corporationConfig.findFirst({
			where: eq(corporationConfig.corporationId, corporationId),
		})

		if (!config) {
			await this.db.insert(corporationConfig).values({
				corporationId,
				isVerified: false,
				lastVerified: null,
				updatedAt: new Date(),
			})
		}

		// Add as a director instead
		const directorManager = new DirectorManager(this.db, corporationId, this.getTokenStoreStub())

		// Check if director already exists
		const directors = await directorManager.getAllDirectors()
		const existingDirector = directors.find(d => d.characterId === characterId)

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
		const directorManager = new DirectorManager(this.db, config.corporationId, this.getTokenStoreStub())
		const directors = await directorManager.getAllDirectors()
		const primaryDirector = directors[0] // First director by priority

		return {
			corporationId: config.corporationId,
			characterId: primaryDirector?.characterId || 0,
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
		const directorManager = new DirectorManager(this.db, config.corporationId, this.getTokenStoreStub())
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
	async addDirector(characterId: number, characterName: string, priority = 100): Promise<void> {
		const config = await this.db.query.corporationConfig.findFirst()

		if (!config) {
			// Create config if it doesn't exist
			await this.db.insert(corporationConfig).values({
				corporationId: this.state.id.toString() as unknown as number, // Extract corp ID from DO ID
				isVerified: false,
				lastVerified: null,
				updatedAt: new Date(),
			})
		}

		const directorManager = await this.getDirectorManager()
		await directorManager.addDirector(characterId, characterName, priority)
	}

	/**
	 * Remove a director character from this corporation
	 */
	async removeDirector(characterId: number): Promise<void> {
		const directorManager = await this.getDirectorManager()
		await directorManager.removeDirector(characterId)
	}

	/**
	 * Update a director's priority
	 */
	async updateDirectorPriority(characterId: number, priority: number): Promise<void> {
		const directorManager = await this.getDirectorManager()
		await directorManager.updateDirectorPriority(characterId, priority)
	}

	/**
	 * Get all directors for this corporation
	 */
	async getDirectors(): Promise<DirectorHealth[]> {
		const directorManager = await this.getDirectorManager()
		return await directorManager.getAllDirectors()
	}

	/**
	 * Get healthy directors for this corporation
	 */
	async getHealthyDirectors(): Promise<DirectorHealth[]> {
		const directorManager = await this.getDirectorManager()
		return await directorManager.getHealthyDirectors()
	}

	/**
	 * Verify health of a specific director
	 */
	async verifyDirectorHealth(directorId: string): Promise<boolean> {
		const directorManager = await this.getDirectorManager()
		return await directorManager.verifyDirectorHealth(directorId)
	}

	/**
	 * Verify health of all directors
	 */
	async verifyAllDirectorsHealth(): Promise<{ verified: number; failed: number }> {
		const directorManager = await this.getDirectorManager()
		return await directorManager.verifyAllDirectorsHealth()
	}

	// ========================================================================
	// FETCH AND STORE METHODS (private)
	// ========================================================================

	/**
	 * Fetch and store public corporation information
	 */
	private async fetchAndStorePublicInfo(corporationId: number, _forceRefresh = false): Promise<void> {
		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationPublicInfo> = await tokenStore.fetchPublicEsi(
			`/corporations/${corporationId}`
		)

		const data = response.data

		await this.db
			.insert(corporationPublicInfo)
			.values({
				corporationId,
				name: data.name,
				ticker: data.ticker,
				ceoId: data.ceo_id,
				creatorId: data.creator_id,
				dateFounded: data.date_founded ? new Date(data.date_founded) : null,
				description: data.description || null,
				homeStationId: data.home_station_id || null,
				memberCount: data.member_count,
				shares: data.shares ? data.shares.toString() : null,
				taxRate: data.tax_rate.toString(),
				url: data.url || null,
				allianceId: data.alliance_id || null,
				factionId: data.faction_id || null,
				warEligible: data.war_eligible || null,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: corporationPublicInfo.corporationId,
				set: {
					name: data.name,
					ticker: data.ticker,
					ceoId: data.ceo_id,
					memberCount: data.member_count,
					shares: data.shares ? data.shares.toString() : null,
					taxRate: data.tax_rate.toString(),
					url: data.url || null,
					allianceId: data.alliance_id || null,
					factionId: data.faction_id || null,
					warEligible: data.war_eligible || null,
					updatedAt: new Date(),
				},
			})
	}

	/**
	 * Fetch and store corporation members
	 */
	private async fetchAndStoreMembers(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		const tokenStore = this.getTokenStoreStub()

		const response: EsiResponse<EsiCorporationMembers> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/members`,
			characterId
		)

		const memberIds = response.data

		// Store each member
		for (const memberId of memberIds) {
			await this.db
				.insert(corporationMembers)
				.values({
					corporationId,
					characterId: memberId,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationMembers.corporationId, corporationMembers.characterId],
					set: {
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store member tracking data
	 */
	private async fetchAndStoreMemberTracking(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationMemberTracking[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/membertracking`,
			characterId
		)

		const trackingData = response.data

		for (const member of trackingData) {
			await this.db
				.insert(corporationMemberTracking)
				.values({
					corporationId,
					characterId: member.character_id,
					baseId: member.base_id || null,
					locationId: member.location_id ? member.location_id.toString() : null,
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
						locationId: member.location_id ? member.location_id.toString() : null,
						logoffDate: member.logoff_date ? new Date(member.logoff_date) : null,
						logonDate: member.logon_date ? new Date(member.logon_date) : null,
						shipTypeId: member.ship_type_id || null,
						startDate: member.start_date ? new Date(member.start_date) : null,
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store corporation wallets
	 */
	private async fetchAndStoreWallets(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
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
					corporationId,
					division: wallet.division,
					balance: wallet.balance.toString(),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationWallets.corporationId, corporationWallets.division],
					set: {
						balance: wallet.balance.toString(),
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store wallet journal for a division
	 */
	private async fetchAndStoreWalletJournal(division: number, _forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationWalletJournalEntry[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/wallets/${division}/journal`,
			characterId
		)

		const entries = response.data

		for (const entry of entries) {
			await this.db
				.insert(corporationWalletJournal)
				.values({
					corporationId,
					division,
					journalId: entry.id.toString(),
					amount: entry.amount?.toString() || null,
					balance: entry.balance?.toString() || null,
					contextId: entry.context_id ? entry.context_id.toString() : null,
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
						contextId: entry.context_id ? entry.context_id.toString() : null,
						contextIdType: entry.context_id_type || null,
						description: entry.description,
						reason: entry.reason || null,
						tax: entry.tax?.toString() || null,
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store wallet transactions for a division
	 */
	private async fetchAndStoreWalletTransactions(division: number, _forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationWalletTransaction[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/wallets/${division}/transactions`,
			characterId
		)

		const transactions = response.data

		for (const tx of transactions) {
			await this.db
				.insert(corporationWalletTransactions)
				.values({
					corporationId,
					division,
					transactionId: tx.transaction_id.toString(),
					clientId: tx.client_id,
					date: new Date(tx.date),
					isBuy: tx.is_buy,
					isPersonal: tx.is_personal,
					journalRefId: tx.journal_ref_id.toString(),
					locationId: tx.location_id.toString(),
					quantity: tx.quantity,
					typeId: tx.type_id,
					unitPrice: tx.unit_price.toString(),
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [
						corporationWalletTransactions.corporationId,
						corporationWalletTransactions.division,
						corporationWalletTransactions.transactionId,
					],
					set: {
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store corporation assets (paginated)
	 */
	private async fetchAndStoreAssets(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()

		// Assets are paginated, fetch all pages
		let page = 1
		let hasMorePages = true

		while (hasMorePages) {
			const response: EsiResponse<EsiCorporationAsset[]> = await tokenStore.fetchEsi(
				`/corporations/${corporationId}/assets?page=${page}`,
				characterId
			)

			const assets = response.data

			if (!assets || assets.length === 0) {
				hasMorePages = false
				break
			}

			for (const asset of assets) {
				await this.db
					.insert(corporationAssets)
					.values({
						corporationId,
						itemId: asset.item_id.toString(),
						isSingleton: asset.is_singleton,
						locationFlag: asset.location_flag,
						locationId: asset.location_id.toString(),
						locationType: asset.location_type,
						quantity: asset.quantity,
						typeId: asset.type_id,
						isBlueprintCopy: asset.is_blueprint_copy || null,
						updatedAt: new Date(),
					})
					.onConflictDoUpdate({
						target: [corporationAssets.corporationId, corporationAssets.itemId],
						set: {
							isSingleton: asset.is_singleton,
							locationFlag: asset.location_flag,
							locationId: asset.location_id.toString(),
							locationType: asset.location_type,
							quantity: asset.quantity,
							typeId: asset.type_id,
							isBlueprintCopy: asset.is_blueprint_copy || null,
							updatedAt: new Date(),
						},
					})
			}

			page++
		}
	}

	/**
	 * Fetch and store corporation structures
	 */
	private async fetchAndStoreStructures(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Station_Manager'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationStructure[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/structures`,
			characterId
		)

		const structures = response.data

		for (const structure of structures) {
			await this.db
				.insert(corporationStructures)
				.values({
					corporationId,
					structureId: structure.structure_id.toString(),
					typeId: structure.type_id,
					systemId: structure.system_id,
					profileId: structure.profile_id,
					fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
					nextReinforceApply: structure.next_reinforce_apply ? new Date(structure.next_reinforce_apply) : null,
					nextReinforceHour: structure.next_reinforce_hour || null,
					reinforceHour: structure.reinforce_hour || null,
					state: structure.state,
					stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
					stateTimerStart: structure.state_timer_start ? new Date(structure.state_timer_start) : null,
					unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
					services: structure.services || null,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationStructures.corporationId, corporationStructures.structureId],
					set: {
						state: structure.state,
						fuelExpires: structure.fuel_expires ? new Date(structure.fuel_expires) : null,
						nextReinforceApply: structure.next_reinforce_apply ? new Date(structure.next_reinforce_apply) : null,
						nextReinforceHour: structure.next_reinforce_hour || null,
						reinforceHour: structure.reinforce_hour || null,
						stateTimerEnd: structure.state_timer_end ? new Date(structure.state_timer_end) : null,
						stateTimerStart: structure.state_timer_start ? new Date(structure.state_timer_start) : null,
						unanchorsAt: structure.unanchors_at ? new Date(structure.unanchors_at) : null,
						services: structure.services || null,
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store corporation market orders
	 */
	private async fetchAndStoreOrders(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Accountant', 'Junior_Accountant', 'Trader'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationOrder[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/orders`,
			characterId
		)

		const orders = response.data

		for (const order of orders) {
			await this.db
				.insert(corporationOrders)
				.values({
					corporationId,
					orderId: order.order_id.toString(),
					duration: order.duration,
					escrow: order.escrow?.toString() || null,
					isBuyOrder: order.is_buy_order,
					issued: new Date(order.issued),
					issuedBy: order.issued_by,
					locationId: order.location_id.toString(),
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
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store corporation contracts
	 */
	private async fetchAndStoreContracts(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationContract[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/contracts`,
			characterId
		)

		const contracts = response.data

		for (const contract of contracts) {
			await this.db
				.insert(corporationContracts)
				.values({
					corporationId,
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
					endLocationId: contract.end_location_id ? contract.end_location_id.toString() : null,
					forCorporation: contract.for_corporation,
					issuerCorporationId: contract.issuer_corporation_id,
					issuerId: contract.issuer_id,
					price: contract.price?.toString() || null,
					reward: contract.reward?.toString() || null,
					startLocationId: contract.start_location_id ? contract.start_location_id.toString() : null,
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
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store corporation industry jobs
	 */
	private async fetchAndStoreIndustryJobs(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Factory_Manager'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationIndustryJob[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/industry/jobs`,
			characterId
		)

		const jobs = response.data

		for (const job of jobs) {
			await this.db
				.insert(corporationIndustryJobs)
				.values({
					corporationId,
					jobId: job.job_id,
					installerId: job.installer_id,
					facilityId: job.facility_id.toString(),
					locationId: job.location_id.toString(),
					activityId: job.activity_id,
					blueprintId: job.blueprint_id.toString(),
					blueprintTypeId: job.blueprint_type_id,
					blueprintLocationId: job.blueprint_location_id.toString(),
					outputLocationId: job.output_location_id.toString(),
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
						updatedAt: new Date(),
					},
				})
		}
	}

	/**
	 * Fetch and store corporation killmails
	 */
	private async fetchAndStoreKillmails(_forceRefresh = false): Promise<void> {
		const { characterId, corporationId } = await this.getConfiguredCharacter()
		await this.verifyRole(characterId, ['Director'])

		const tokenStore = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationKillmail[]> = await tokenStore.fetchEsi(
			`/corporations/${corporationId}/killmails/recent`,
			characterId
		)

		const killmails = response.data

		for (const km of killmails) {
			// Note: killmail_time is not in the ESI response, we'll use updatedAt
			await this.db
				.insert(corporationKillmails)
				.values({
					corporationId,
					killmailId: km.killmail_id,
					killmailHash: km.killmail_hash,
					killmailTime: new Date(), // ESI doesn't provide time in this endpoint
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [corporationKillmails.corporationId, corporationKillmails.killmailId],
					set: {
						killmailHash: km.killmail_hash,
						updatedAt: new Date(),
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
	async fetchAllCorporationData(forceRefresh = false): Promise<void> {
		console.log('[EveCorporationData] fetchAllCorporationData: Starting', { forceRefresh })

		const { corporationId } = await this.getConfiguredCharacter()
		console.log('[EveCorporationData] fetchAllCorporationData: Got corporationId', { corporationId })

		// Public data
		console.log('[EveCorporationData] fetchAllCorporationData: Fetching public data')
		await this.fetchPublicData(corporationId, forceRefresh)
		console.log('[EveCorporationData] fetchAllCorporationData: Public data fetched')

		// Try to fetch all other data, but don't fail if role verification fails
		console.log('[EveCorporationData] fetchAllCorporationData: Starting parallel fetches')
		const fetchPromises = [
			this.fetchCoreData(forceRefresh).catch((e) => console.error('[EveCorporationData] Failed to fetch core data:', e)),
			this.fetchFinancialData(undefined, forceRefresh).catch((e) =>
				console.error('[EveCorporationData] Failed to fetch financial data:', e)
			),
			this.fetchAssetsData(forceRefresh).catch((e) => console.error('[EveCorporationData] Failed to fetch assets data:', e)),
			this.fetchMarketData(forceRefresh).catch((e) => console.error('[EveCorporationData] Failed to fetch market data:', e)),
			this.fetchKillmails(forceRefresh).catch((e) => console.error('[EveCorporationData] Failed to fetch killmails:', e)),
		]

		const results = await Promise.allSettled(fetchPromises)
		console.log('[EveCorporationData] fetchAllCorporationData: All fetches completed', {
			fulfilled: results.filter(r => r.status === 'fulfilled').length,
			rejected: results.filter(r => r.status === 'rejected').length,
		})
	}

	/**
	 * Fetch public corporation data
	 */
	async fetchPublicData(corporationId: number, forceRefresh = false): Promise<void> {
		await this.fetchAndStorePublicInfo(corporationId, forceRefresh)
	}

	/**
	 * Fetch core corporation data (members, tracking)
	 */
	async fetchCoreData(forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreMembers(forceRefresh),
			this.fetchAndStoreMemberTracking(forceRefresh).catch((e) => console.error('Member tracking failed:', e)),
		])
	}

	/**
	 * Fetch financial data (wallets, journal, transactions)
	 */
	async fetchFinancialData(division?: number, forceRefresh = false): Promise<void> {
		// Fetch wallets first
		await this.fetchAndStoreWallets(forceRefresh)

		// Fetch journal and transactions for specified division(s)
		const divisions = division ? [division] : [1, 2, 3, 4, 5, 6, 7]

		const promises = divisions.flatMap((div) => [
			this.fetchAndStoreWalletJournal(div, forceRefresh).catch((e) =>
				console.error(`Failed to fetch journal for division ${div}:`, e)
			),
			this.fetchAndStoreWalletTransactions(div, forceRefresh).catch((e) =>
				console.error(`Failed to fetch transactions for division ${div}:`, e)
			),
		])

		await Promise.allSettled(promises)
	}

	/**
	 * Fetch assets and structures
	 */
	async fetchAssetsData(forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreAssets(forceRefresh),
			this.fetchAndStoreStructures(forceRefresh).catch((e) => console.error('Structures fetch failed:', e)),
		])
	}

	/**
	 * Fetch market and industry data
	 */
	async fetchMarketData(forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreOrders(forceRefresh).catch((e) => console.error('Orders fetch failed:', e)),
			this.fetchAndStoreContracts(forceRefresh).catch((e) => console.error('Contracts fetch failed:', e)),
			this.fetchAndStoreIndustryJobs(forceRefresh).catch((e) => console.error('Industry jobs fetch failed:', e)),
		])
	}

	/**
	 * Fetch killmails
	 */
	async fetchKillmails(forceRefresh = false): Promise<void> {
		await this.fetchAndStoreKillmails(forceRefresh)
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
	async getMembers(): Promise<CorporationMemberData[]> {
		const results = await this.db.query.corporationMembers.findMany()

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
	async getMemberTracking(): Promise<CorporationMemberTrackingData[]> {
		const results = await this.db.query.corporationMemberTracking.findMany()

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
	async getCoreData(): Promise<CorporationCoreData | null> {
		const [publicInfo, members, memberTracking] = await Promise.all([
			this.getCorporationInfo(),
			this.getMembers(),
			this.getMemberTracking(),
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
	async getWallets(division?: number): Promise<CorporationWalletData[]> {
		const results = division
			? await this.db.query.corporationWallets.findMany({
					where: eq(corporationWallets.division, division),
				})
			: await this.db.query.corporationWallets.findMany()

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
	async getWalletJournal(division?: number, limit = 1000): Promise<CorporationWalletJournalData[]> {
		const results = division
			? await this.db.query.corporationWalletJournal.findMany({
					where: eq(corporationWalletJournal.division, division),
					orderBy: desc(corporationWalletJournal.date),
					limit,
				})
			: await this.db.query.corporationWalletJournal.findMany({
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
	async getWalletTransactions(division?: number, limit = 1000): Promise<CorporationWalletTransactionData[]> {
		const results = division
			? await this.db.query.corporationWalletTransactions.findMany({
					where: eq(corporationWalletTransactions.division, division),
					orderBy: desc(corporationWalletTransactions.date),
					limit,
				})
			: await this.db.query.corporationWalletTransactions.findMany({
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
	async getFinancialData(division?: number): Promise<CorporationFinancialData | null> {
		const [wallets, journalEntries, transactions] = await Promise.all([
			this.getWallets(division),
			this.getWalletJournal(division),
			this.getWalletTransactions(division),
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
	async getAssets(limit = 10000): Promise<CorporationAssetData[]> {
		const results = await this.db.query.corporationAssets.findMany({
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
	async getStructures(): Promise<CorporationStructureData[]> {
		const results = await this.db.query.corporationStructures.findMany()

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
	async getAssetsData(): Promise<CorporationAssetsData | null> {
		const [assets, structures] = await Promise.all([this.getAssets(), this.getStructures()])

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
	async getOrders(): Promise<CorporationOrderData[]> {
		const results = await this.db.query.corporationOrders.findMany()

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
	async getContracts(status?: string): Promise<CorporationContractData[]> {
		const results = status
			? await this.db.query.corporationContracts.findMany({
					where: eq(corporationContracts.status, status),
				})
			: await this.db.query.corporationContracts.findMany()

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
	async getIndustryJobs(status?: string): Promise<CorporationIndustryJobData[]> {
		const results = status
			? await this.db.query.corporationIndustryJobs.findMany({
					where: eq(corporationIndustryJobs.status, status),
				})
			: await this.db.query.corporationIndustryJobs.findMany()

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
	async getMarketData(): Promise<CorporationMarketData | null> {
		const [orders, contracts, industryJobs] = await Promise.all([
			this.getOrders(),
			this.getContracts(),
			this.getIndustryJobs(),
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
	async getKillmails(limit = 100): Promise<CorporationKillmailData[]> {
		const results = await this.db.query.corporationKillmails.findMany({
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
	async getCharacterRoles(characterId: number): Promise<CharacterCorporationRolesData | null> {
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
