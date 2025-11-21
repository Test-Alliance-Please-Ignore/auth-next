import { DurableObject } from 'cloudflare:workers'

import { and, eq, inArray } from '@repo/db-utils'
import { getEsiInstanceForCharacter, getEsiInstanceForCorporation } from '@repo/esi'

import { createDb } from './db'
import { userCharacters, users } from './db/schema'

import type { Core } from '@repo/core'
import type { CharacterPublicInfo } from '@repo/esi'
import type { Env } from './context'

export class CoreDO extends DurableObject<Env> implements Core {
	private db: ReturnType<typeof createDb>

	constructor(
		public state: DurableObjectState,
		public env: Env
	) {
		super(state, env)
		this.db = createDb(env.DATABASE_URL)
	}

	private async getCharacterInfo(characterId: string): Promise<CharacterPublicInfo | null> {
		const instance = getEsiInstanceForCharacter(this.env.ESI, characterId)
		const characterInfo = await instance.fetchCharacterPublicInfo(characterId)
		return characterInfo
	}

	private async getCharacterAllianceInfo(
		characterId: string
	): Promise<{ allianceId: string; allianceName: string } | null> {
		const characterInfo = await this.getCharacterInfo(characterId)
		if (!characterInfo) {
			return null
		}
		const instance = getEsiInstanceForCorporation(this.env.ESI, characterInfo.corporation_id)
		const corporationInfo = await instance.fetchCorporationPublicInfo(characterInfo.corporation_id)

		if (!corporationInfo.alliance_id) {
			return null
		}

		return {
			allianceId: String(corporationInfo.alliance_id),
			allianceName: corporationInfo.name,
		}
	}

	async getUserCharacters(
		userId: string,
		includeDeleted: boolean = false
	): Promise<Array<{ characterId: string; characterName: string; isDeleted: boolean }>> {
		const characters = await this.db.query.userCharacters.findMany({
			where: and(eq(userCharacters.isDeleted, includeDeleted), eq(userCharacters.userId, userId)),
		})
		return characters.map((c) => ({
			characterId: c.characterId,
			characterName: c.characterName,
			isDeleted: c.isDeleted,
		}))
	}

	async getUserCorporations(
		userId: string
	): Promise<Array<{ corporationId: string; corporationName: string }>> {
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return []
		}

		const characters = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const corporations = (
			await Promise.all(
				characters.map(async (c) => {
					const characterInfo = await this.getCharacterInfo(c.characterId)
					if (!characterInfo) {
						return null
					}
					return {
						corporationId: characterInfo.corporation_id,
						corporationName: characterInfo.name,
					}
				})
			)
		).filter((c): c is NonNullable<typeof c> => c !== null)

		return corporations
	}

	async getUserCorporationsBatch(
		userIds: string[]
	): Promise<Map<string, Array<{ corporationId: string; corporationName: string }>>> {
		const result = new Map<string, Array<{ corporationId: string; corporationName: string }>>()

		if (userIds.length === 0) {
			return result
		}

		// Batch fetch all user characters
		const allCharacters = await this.db.query.userCharacters.findMany({
			where: inArray(userCharacters.userId, userIds),
		})

		// Group characters by userId
		const charactersByUser = new Map<string, Array<(typeof allCharacters)[number]>>()
		for (const char of allCharacters) {
			if (!charactersByUser.has(char.userId)) {
				charactersByUser.set(char.userId, [])
			}
			charactersByUser.get(char.userId)!.push(char)
		}

		// Fetch character info for all characters in parallel
		const allCharacterIds = allCharacters.map((c) => c.characterId)
		const characterInfoMap = new Map<string, CharacterPublicInfo>()

		await Promise.all(
			allCharacterIds.map(async (characterId) => {
				const info = await this.getCharacterInfo(characterId)
				if (info) {
					characterInfoMap.set(characterId, info)
				}
			})
		)

		// Build result map
		for (const userId of userIds) {
			const chars = charactersByUser.get(userId) || []
			const corporations: Array<{ corporationId: string; corporationName: string }> = []

			for (const char of chars) {
				const info = characterInfoMap.get(char.characterId)
				if (info) {
					corporations.push({
						corporationId: info.corporation_id,
						corporationName: info.name,
					})
				}
			}

			result.set(userId, corporations)
		}

		return result
	}

	async getUserAlliances(
		userId: string
	): Promise<Array<{ allianceId: string; allianceName: string }>> {
		const user = await this.db.query.users.findFirst({
			where: eq(users.id, userId),
		})

		if (!user) {
			return []
		}

		const characters = await this.db.query.userCharacters.findMany({
			where: eq(userCharacters.userId, userId),
		})

		const alliances = await Promise.all(
			characters.map(async (c) => {
				const allianceInfo = await this.getCharacterAllianceInfo(c.characterId)
				if (!allianceInfo) {
					return null
				}
				return allianceInfo
			})
		)

		return alliances.filter((a): a is NonNullable<typeof a> => a !== null)
	}

	async getUserDiscordUserId(userId: string): Promise<string | null> {
		throw new Error('Not implemented')
	}
}
