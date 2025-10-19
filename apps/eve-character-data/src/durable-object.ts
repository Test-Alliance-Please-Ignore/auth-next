import { DurableObject } from 'cloudflare:workers'

import { eq } from '@repo/db-utils'

import { createDb } from './db'
import {
	characterAttributes,
	characterCorporationHistory,
	characterPortraits,
	characterPublicInfo,
	characterSkills,
} from './db/schema'

import type {
	CharacterAttributesData,
	CharacterCorporationHistoryData,
	CharacterPortraitData,
	CharacterPublicData,
	CharacterSkillsData,
	EsiCharacterAttributes,
	EsiCharacterPortrait,
	EsiCharacterPublicInfo,
	EsiCharacterSkills,
	EsiCorporationHistoryEntry,
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
	private getTokenStoreStub(): DurableObjectStub<EveTokenStore> {
		const tokenStoreId = this.env.EVE_TOKEN_STORE.idFromName('default')
		return this.env.EVE_TOKEN_STORE.get(tokenStoreId)
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
