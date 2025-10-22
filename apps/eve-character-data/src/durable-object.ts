import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import { createDb } from './db'
import {
	characterAssets,
	characterAttributes,
	characterCorporationHistory,
	characterLocation,
	characterMarketOrders,
	characterMarketTransactions,
	characterPortraits,
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
	CharacterMarketOrderData,
	CharacterMarketTransactionData,
	CharacterPortraitData,
	CharacterPublicData,
	CharacterSkillsData,
	CharacterWalletJournalData,
	EsiCharacterAttributes,
	EsiCharacterPortrait,
	EsiCharacterPublicInfo,
	EsiCharacterSkills,
	EsiCorporationHistoryEntry,
	EsiMarketOrder,
	EsiMarketTransaction,
	EsiWalletJournalEntry,
	EveCharacterData,
} from '@repo/eve-character-data'
import type { EsiResponse, EveTokenStore } from '@repo/eve-token-store'
import type { Env } from './context'

/**
 * EveCharacterData Durable Object
 *
 * This Durable Object stores character data from ESI in PostgreSQL
 * Uses eve-token-store as ESI gateway for fetching data
 */
export class EveCharacterDataDO extends DurableObject<Env> implements EveCharacterData {
	private db: ReturnType<typeof createDb>

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

	/**
	 * Fetch and store all public character data
	 */
	async fetchCharacterData(characterId: number, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStorePublicInfo(characterId, forceRefresh),
			this.fetchAndStorePortrait(characterId, forceRefresh),
			this.fetchAndStoreCorporationHistory(characterId, forceRefresh),
		])
	}

	/**
	 * Fetch and store authenticated character data
	 */
	async fetchAuthenticatedData(characterId: number, forceRefresh = false): Promise<void> {
		await Promise.all([
			this.fetchAndStoreSkills(characterId, forceRefresh),
			this.fetchAndStoreAttributes(characterId, forceRefresh),
		])
	}

	/**
	 * Fetch and store wallet journal entries
	 */
	async fetchWalletJournal(characterId: number, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreWalletJournal(characterId, forceRefresh)
	}

	/**
	 * Fetch and store market transactions
	 */
	async fetchMarketTransactions(characterId: number, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreMarketTransactions(characterId, forceRefresh)
	}

	/**
	 * Fetch and store market orders
	 */
	async fetchMarketOrders(characterId: number, forceRefresh = false): Promise<void> {
		await this.fetchAndStoreMarketOrders(characterId, forceRefresh)
	}

	/**
	 * Get character public info from database
	 */
	async getCharacterInfo(characterId: number): Promise<CharacterPublicData | null> {
		const result = await this.db.query.characterPublicInfo.findFirst({
			where: eq(characterPublicInfo.characterId, characterId),
		})

		if (!result) {
			return null
		}

		return {
			characterId: result.characterId,
			name: result.name,
			corporationId: result.corporationId,
			allianceId: result.allianceId ?? undefined,
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
	 * Get when character data was last updated
	 */
	async getLastUpdated(characterId: number): Promise<Date | null> {
		const result = await this.db.query.characterPublicInfo.findFirst({
			where: eq(characterPublicInfo.characterId, characterId),
			columns: {
				updatedAt: true,
			},
		})

		return result?.updatedAt ?? null
	}

	/**
	 * Get token store stub for this character
	 */
	private getTokenStoreStub(): EveTokenStore {
		return getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default')
	}

	/**
	 * Fetch and store public character info
	 */
	private async fetchAndStorePublicInfo(
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterPublicData> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiCharacterPublicInfo> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}`,
			characterId
		)

		const data = response.data

		// Upsert to database
		await this.db
			.insert(characterPublicInfo)
			.values({
				characterId,
				name: data.name,
				corporationId: data.corporation_id,
				allianceId: data.alliance_id,
				birthday: data.birthday,
				raceId: data.race_id,
				bloodlineId: data.bloodline_id,
				securityStatus: data.security_status,
				description: data.description,
				gender: data.gender,
				factionId: data.faction_id,
				title: data.title,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: characterPublicInfo.characterId,
				set: {
					name: data.name,
					corporationId: data.corporation_id,
					allianceId: data.alliance_id,
					birthday: data.birthday,
					raceId: data.race_id,
					bloodlineId: data.bloodline_id,
					securityStatus: data.security_status,
					description: data.description,
					gender: data.gender,
					factionId: data.faction_id,
					title: data.title,
					updatedAt: new Date(),
				},
			})

		return (await this.getCharacterInfo(characterId))!
	}

	/**
	 * Fetch and store character portrait
	 */
	private async fetchAndStorePortrait(
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterPortraitData> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiCharacterPortrait> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/portrait`,
			characterId
		)

		const data = response.data

		// Upsert to database
		await this.db
			.insert(characterPortraits)
			.values({
				characterId,
				px64x64: data.px64x64,
				px128x128: data.px128x128,
				px256x256: data.px256x256,
				px512x512: data.px512x512,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: characterPortraits.characterId,
				set: {
					px64x64: data.px64x64,
					px128x128: data.px128x128,
					px256x256: data.px256x256,
					px512x512: data.px512x512,
					updatedAt: new Date(),
				},
			})

		const result = await this.db.query.characterPortraits.findFirst({
			where: eq(characterPortraits.characterId, characterId),
		})

		return {
			characterId: result!.characterId,
			px64x64: result!.px64x64 ?? undefined,
			px128x128: result!.px128x128 ?? undefined,
			px256x256: result!.px256x256 ?? undefined,
			px512x512: result!.px512x512 ?? undefined,
			createdAt: result!.createdAt,
			updatedAt: result!.updatedAt,
		}
	}

	/**
	 * Fetch and store corporation history
	 */
	private async fetchAndStoreCorporationHistory(
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterCorporationHistoryData[]> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiCorporationHistoryEntry[]> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/corporationhistory`,
			characterId
		)

		const entries = response.data

		// Upsert each entry
		for (const entry of entries) {
			await this.db
				.insert(characterCorporationHistory)
				.values({
					characterId,
					recordId: entry.record_id,
					corporationId: entry.corporation_id,
					startDate: entry.start_date,
					isDeleted: entry.is_deleted,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterCorporationHistory.characterId, characterCorporationHistory.recordId],
					set: {
						corporationId: entry.corporation_id,
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
			characterId: r.characterId,
			recordId: r.recordId,
			corporationId: r.corporationId,
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
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterSkillsData> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiCharacterSkills> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/skills`,
			characterId
		)

		const data = response.data

		// Upsert to database
		await this.db
			.insert(characterSkills)
			.values({
				characterId,
				totalSp: data.total_sp,
				unallocatedSp: data.unallocated_sp,
				skills: data.skills,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: characterSkills.characterId,
				set: {
					totalSp: data.total_sp,
					unallocatedSp: data.unallocated_sp,
					skills: data.skills,
					updatedAt: new Date(),
				},
			})

		const result = await this.db.query.characterSkills.findFirst({
			where: eq(characterSkills.characterId, characterId),
		})

		return {
			characterId: result!.characterId,
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
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterAttributesData> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiCharacterAttributes> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/attributes`,
			characterId
		)

		const data = response.data

		// Upsert to database
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

		const result = await this.db.query.characterAttributes.findFirst({
			where: eq(characterAttributes.characterId, characterId),
		})

		return {
			characterId: result!.characterId,
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
	private async fetchAndStoreWalletJournal(
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterWalletJournalData[]> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiWalletJournalEntry[]> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/wallet/journal`,
			characterId
		)

		const entries = response.data

		// Upsert each entry
		for (const entry of entries) {
			await this.db
				.insert(characterWalletJournal)
				.values({
					characterId,
					journalId: entry.id,
					date: new Date(entry.date),
					refType: entry.ref_type,
					amount: entry.amount.toString(),
					balance: entry.balance?.toString() ?? '0',
					description: entry.description,
					firstPartyId: entry.first_party_id,
					secondPartyId: entry.second_party_id,
					reason: entry.reason,
					tax: entry.tax?.toString(),
					taxReceiverId: entry.tax_receiver_id,
					contextId: entry.context_id,
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
						firstPartyId: entry.first_party_id,
						secondPartyId: entry.second_party_id,
						reason: entry.reason,
						tax: entry.tax?.toString(),
						taxReceiverId: entry.tax_receiver_id,
						contextId: entry.context_id,
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
			characterId: r.characterId,
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
	}

	/**
	 * Fetch and store market transactions
	 */
	private async fetchAndStoreMarketTransactions(
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterMarketTransactionData[]> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiMarketTransaction[]> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/wallet/transactions`,
			characterId
		)

		const transactions = response.data

		// Upsert each transaction
		for (const txn of transactions) {
			await this.db
				.insert(characterMarketTransactions)
				.values({
					characterId,
					transactionId: txn.transaction_id,
					date: new Date(txn.date),
					typeId: txn.type_id,
					quantity: txn.quantity,
					unitPrice: txn.unit_price.toString(),
					clientId: txn.client_id,
					locationId: txn.location_id,
					isBuy: txn.is_buy,
					isPersonal: txn.is_personal,
					journalRefId: txn.journal_ref_id,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterMarketTransactions.characterId, characterMarketTransactions.transactionId],
					set: {
						date: new Date(txn.date),
						typeId: txn.type_id,
						quantity: txn.quantity,
						unitPrice: txn.unit_price.toString(),
						clientId: txn.client_id,
						locationId: txn.location_id,
						isBuy: txn.is_buy,
						isPersonal: txn.is_personal,
						journalRefId: txn.journal_ref_id,
						updatedAt: new Date(),
					},
				})
		}

		const results = await this.db.query.characterMarketTransactions.findMany({
			where: eq(characterMarketTransactions.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: r.characterId,
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
	}

	/**
	 * Fetch and store market orders
	 */
	private async fetchAndStoreMarketOrders(
		characterId: number,
		_forceRefresh = false
	): Promise<CharacterMarketOrderData[]> {
		const tokenStoreStub = this.getTokenStoreStub()
		const response: EsiResponse<EsiMarketOrder[]> = await tokenStoreStub.fetchEsi(
			`/characters/${characterId}/orders`,
			characterId
		)

		const orders = response.data

		// Upsert each order
		for (const order of orders) {
			await this.db
				.insert(characterMarketOrders)
				.values({
					characterId,
					orderId: order.order_id,
					typeId: order.type_id,
					locationId: order.location_id,
					isBuyOrder: order.is_buy_order ?? false,
					price: order.price.toString(),
					volumeTotal: order.volume_total,
					volumeRemain: order.volume_remain,
					issued: new Date(order.issued),
					state: order.state,
					minVolume: order.min_volume ?? 1,
					range: order.range,
					duration: order.duration,
					escrow: order.escrow?.toString(),
					regionId: order.region_id,
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: [characterMarketOrders.characterId, characterMarketOrders.orderId],
					set: {
						typeId: order.type_id,
						locationId: order.location_id,
						isBuyOrder: order.is_buy_order ?? false,
						price: order.price.toString(),
						volumeTotal: order.volume_total,
						volumeRemain: order.volume_remain,
						issued: new Date(order.issued),
						state: order.state,
						minVolume: order.min_volume ?? 1,
						range: order.range,
						duration: order.duration,
						escrow: order.escrow?.toString(),
						regionId: order.region_id,
						updatedAt: new Date(),
					},
				})
		}

		const results = await this.db.query.characterMarketOrders.findMany({
			where: eq(characterMarketOrders.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: r.characterId,
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
	}

	/**
	 * Get character portrait data
	 */
	async getPortrait(characterId: number) {
		const result = await this.db.query.characterPortraits.findFirst({
			where: eq(characterPortraits.characterId, characterId),
		})

		if (!result) return null

		return {
			characterId: result.characterId,
			px64x64: result.px64x64 ?? undefined,
			px128x128: result.px128x128 ?? undefined,
			px256x256: result.px256x256 ?? undefined,
			px512x512: result.px512x512 ?? undefined,
		}
	}

	/**
	 * Get character corporation history
	 */
	async getCorporationHistory(characterId: number) {
		const results = await this.db.query.characterCorporationHistory.findMany({
			where: eq(characterCorporationHistory.characterId, characterId),
		})

		return results.map((r) => ({
			recordId: r.recordId,
			corporationId: r.corporationId,
			startDate: r.startDate,
			isDeleted: r.isDeleted ?? undefined,
		}))
	}

	/**
	 * Get character skills
	 */
	async getSkills(characterId: number) {
		const result = await this.db.query.characterSkills.findFirst({
			where: eq(characterSkills.characterId, characterId),
		})

		if (!result) return null

		return {
			skills: result.skills,
			total_sp: result.totalSp,
			unallocated_sp: result.unallocatedSp ?? undefined,
		}
	}

	/**
	 * Get character attributes
	 */
	async getAttributes(characterId: number) {
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
	async getSensitiveData(characterId: number) {
		// Query all sensitive data tables
		const [location, wallet, assets, status, skillQueue, walletJournal, marketTransactions, marketOrders] =
			await Promise.all([
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
			skillQueue: skillQueue?.queue ?? undefined,
			walletJournal:
				walletJournal.length > 0
					? walletJournal.map((r) => ({
							id: r.id,
							characterId: r.characterId,
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
							characterId: r.characterId,
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
							characterId: r.characterId,
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
	async getWalletJournal(characterId: number): Promise<CharacterWalletJournalData[]> {
		const results = await this.db.query.characterWalletJournal.findMany({
			where: eq(characterWalletJournal.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: r.characterId,
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
	}

	/**
	 * Get market transactions for a character
	 */
	async getMarketTransactions(characterId: number): Promise<CharacterMarketTransactionData[]> {
		const results = await this.db.query.characterMarketTransactions.findMany({
			where: eq(characterMarketTransactions.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: r.characterId,
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
	}

	/**
	 * Get market orders for a character
	 */
	async getMarketOrders(characterId: number): Promise<CharacterMarketOrderData[]> {
		const results = await this.db.query.characterMarketOrders.findMany({
			where: eq(characterMarketOrders.characterId, characterId),
		})

		return results.map((r) => ({
			id: r.id,
			characterId: r.characterId,
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
