import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import type { CharacterDataStore } from '@repo/character-data-store'
import type { SessionStore } from '@repo/session-store'
import type { Env } from './context'

// ========== Type Definitions ==========

export interface CharacterData {
	characterId: number
	name: string
	corporationId: number
	allianceId?: number | null
}

export interface CorporationData {
	corporationId: number
	name: string
	ticker: string
	allianceId?: number | null
}

export interface TagAssignment {
	tagUrn: string
	tagType: 'corporation' | 'alliance'
	displayName: string
	eveId: number
	sourceCharacterId: number
	metadata?: Record<string, unknown>
}

export interface EvaluationContext {
	characters: CharacterData[]
	env: Env
}

// ========== Tag Rule Interface ==========

export interface TagRule {
	ruleType: string
	evaluate(userId: string, context: EvaluationContext): Promise<TagAssignment[]>
}

// ========== Corporation Membership Rule ==========

export class CorporationMembershipRule implements TagRule {
	ruleType = 'corporation_membership'

	async evaluate(userId: string, context: EvaluationContext): Promise<TagAssignment[]> {
		const assignments: TagAssignment[] = []

		for (const character of context.characters) {
			try {
				// Fetch corporation data from CharacterDataStore DO
				const dataStoreStub = getStub<CharacterDataStore>(
					context.env.CHARACTER_DATA_STORE,
					'global'
				)
				const corpData = await dataStoreStub.getCorporation(character.corporationId)

				if (!corpData) {
					logger.warn('Failed to fetch corporation data', {
						characterId: character.characterId,
						corporationId: character.corporationId,
					})
					continue
				}

				// Create corporation tag assignment
				const corpUrn = `urn:eve:corporation:${character.corporationId}`
				assignments.push({
					tagUrn: corpUrn,
					tagType: 'corporation',
					displayName: corpData.name,
					eveId: character.corporationId,
					sourceCharacterId: character.characterId,
					metadata: {
						ticker: corpData.ticker,
					},
				})
			} catch (error) {
				logger.error('Error evaluating corporation membership', {
					characterId: character.characterId,
					corporationId: character.corporationId,
					error: String(error),
				})
			}
		}

		return assignments
	}
}

// ========== Alliance Membership Rule ==========

export class AllianceMembershipRule implements TagRule {
	ruleType = 'alliance_membership'

	async evaluate(userId: string, context: EvaluationContext): Promise<TagAssignment[]> {
		const assignments: TagAssignment[] = []

		for (const character of context.characters) {
			// Skip if character has no alliance
			if (!character.allianceId) {
				continue
			}

			try {
				// Fetch character data from CharacterDataStore DO to get alliance name
				const dataStoreStub = getStub<CharacterDataStore>(
					context.env.CHARACTER_DATA_STORE,
					'global'
				)
				const charData = await dataStoreStub.getCharacter(character.characterId)

				const allianceUrn = `urn:eve:alliance:${character.allianceId}`
				let allianceName = `Alliance ${character.allianceId}`

				if (charData && charData.alliance_id) {
					// Use alliance name from stored character data if available
					// Note: The CharacterDataStore may not have alliance name directly,
					// but in practice it would be enriched through corporation data
					allianceName = `Alliance ${character.allianceId}` // Placeholder
				}

				assignments.push({
					tagUrn: allianceUrn,
					tagType: 'alliance',
					displayName: allianceName,
					eveId: character.allianceId,
					sourceCharacterId: character.characterId,
				})
			} catch (error) {
				logger.error('Error evaluating alliance membership', {
					characterId: character.characterId,
					allianceId: character.allianceId,
					error: String(error),
				})
			}
		}

		return assignments
	}
}

// ========== Rule Engine ==========

export class TagRuleEngine {
	private rules: TagRule[] = []

	constructor() {
		// Register default rules
		this.registerRule(new CorporationMembershipRule())
		this.registerRule(new AllianceMembershipRule())
	}

	registerRule(rule: TagRule): void {
		this.rules.push(rule)
	}

	async evaluateAllRules(userId: string, context: EvaluationContext): Promise<TagAssignment[]> {
		const allAssignments: TagAssignment[] = []

		for (const rule of this.rules) {
			try {
				const assignments = await rule.evaluate(userId, context)
				allAssignments.push(...assignments)
			} catch (error) {
				logger.error('Rule evaluation failed', {
					ruleType: rule.ruleType,
					userId: userId.substring(0, 8) + '...',
					error: String(error),
				})
			}
		}

		return allAssignments
	}
}

// ========== Helper Functions ==========

export async function getUserCharacters(userId: string, env: Env): Promise<CharacterData[]> {
	try {
		const sessionStoreStub = getStub<SessionStore>(env.USER_SESSION_STORE, 'global')

		// Get all character links for this social user
		const characterLinks = await sessionStoreStub.getCharacterLinksBySocialUser(userId)

		if (!characterLinks || characterLinks.length === 0) {
			return []
		}

		// Fetch character data for each character from CharacterDataStore DO
		const dataStoreStub = getStub<CharacterDataStore>(env.CHARACTER_DATA_STORE, 'global')
		const characters: CharacterData[] = []

		for (const link of characterLinks) {
			try {
				const charData = await dataStoreStub.getCharacter(link.characterId)

				if (!charData) {
					logger.warn('Failed to fetch character data from CharacterDataStore', {
						characterId: link.characterId,
					})
					continue
				}

				characters.push({
					characterId: charData.character_id,
					name: charData.name,
					corporationId: charData.corporation_id,
					allianceId: charData.alliance_id || null,
				})
			} catch (error) {
				logger.error('Error fetching character data', {
					characterId: link.characterId,
					error: String(error),
				})
			}
		}

		return characters
	} catch (error) {
		logger.error('Error in getUserCharacters', {
			userId: userId.substring(0, 8) + '...',
			error: String(error),
		})
		return []
	}
}
