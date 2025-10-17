import { logger } from '@repo/hono-helpers'

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
				// Fetch corporation data from ESI
				const corpResponse = await context.env.ESI.fetch(
					new Request(`http://esi/esi/corporations/${character.corporationId}`)
				)

				if (!corpResponse.ok) {
					logger.warn('Failed to fetch corporation data', {
						characterId: character.characterId,
						corporationId: character.corporationId,
						status: corpResponse.status,
					})
					continue
				}

				const corpData = (await corpResponse.json()) as CorporationData

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
				// Fetch alliance data from ESI (via character data store)
				// For now, we'll construct the URN with the alliance name from character data
				// In a real implementation, we'd fetch from ESI's alliance endpoint
				const allianceUrn = `urn:eve:alliance:${character.allianceId}`

				// Try to fetch alliance name from ESI character data which includes alliance info
				let allianceName = `Alliance ${character.allianceId}`

				try {
					const charResponse = await context.env.ESI.fetch(
						new Request(`http://esi/esi/characters/${character.characterId}`)
					)

					if (charResponse.ok) {
						const charData = (await charResponse.json()) as CharacterData & { allianceName?: string }
						if (charData.allianceName) {
							allianceName = charData.allianceName
						}
					}
				} catch (error) {
					logger.warn('Failed to fetch alliance name from character data', {
						characterId: character.characterId,
						allianceId: character.allianceId,
						error: String(error),
					})
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
		const response = await env.SOCIAL_AUTH.fetch(
			new Request(`http://social-auth/api/users/${userId}/characters`)
		)

		if (!response.ok) {
			logger.error('Failed to fetch user characters', {
				userId: userId.substring(0, 8) + '...',
				status: response.status,
			})
			return []
		}

		const data = (await response.json()) as {
			success: boolean
			characters?: Array<{
				characterId: number
				characterName: string
			}>
		}

		if (!data.success || !data.characters) {
			return []
		}

		// Fetch character data for each character from ESI
		const characters: CharacterData[] = []

		for (const char of data.characters) {
			try {
				const charResponse = await env.ESI.fetch(
					new Request(`http://esi/esi/characters/${char.characterId}`)
				)

				if (!charResponse.ok) {
					logger.warn('Failed to fetch character data from ESI', {
						characterId: char.characterId,
						status: charResponse.status,
					})
					continue
				}

				const charData = (await charResponse.json()) as {
					characterId: number
					name: string
					corporationId: number
					allianceId?: number | null
				}

				characters.push({
					characterId: charData.characterId,
					name: charData.name,
					corporationId: charData.corporationId,
					allianceId: charData.allianceId || null,
				})
			} catch (error) {
				logger.error('Error fetching character data', {
					characterId: char.characterId,
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
