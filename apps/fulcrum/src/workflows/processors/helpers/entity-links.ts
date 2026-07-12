import { getIdClassification } from '@repo/eve-types'

import type { CoreBinding } from '../../../types/core-binding'
import { logger } from '@repo/hono-helpers'

export interface EntityLinkCandidate {
	entityId: string
	entityType?: string | null
}

function chunk<T>(items: T[], size: number): T[][] {
	if (items.length === 0) return []
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}

function normalizeEntityKind(
	entityId: string,
	entityType?: string | null,
): 'character' | 'corporation' | 'alliance' | 'other' {
	switch (entityType) {
		case 'character':
		case 'character_id':
		case 'character_2010_2016':
		case 'character_post_2016':
		case 'dust_character':
		case 'dust_character_post_2016':
			return 'character'
		case 'corporation':
		case 'corporation_id':
			return 'corporation'
		case 'alliance':
		case 'alliance_id':
			return 'alliance'
		case 'mailing_list':
		case 'faction':
		case 'other':
			return 'other'
		default: {
			const classification = getIdClassification(entityId).type
			switch (classification) {
				case 'character':
				case 'character_2010_2016':
				case 'character_post_2016':
				case 'dust_character':
				case 'dust_character_post_2016':
					return 'character'
				case 'corporation':
					return 'corporation'
				case 'alliance':
					return 'alliance'
				default:
					return 'other'
			}
		}
	}
}

function buildEveWhoHref(kind: 'character' | 'corporation' | 'alliance', entityId: string): string {
	switch (kind) {
		case 'character':
			return `https://evewho.com/character/${entityId}`
		case 'corporation':
			return `https://evewho.com/corporation/${entityId}`
		case 'alliance':
			return `https://evewho.com/alliance/${entityId}`
	}
}

export class EntityLinkCoordinator {
	private readonly hrefCache = new Map<string, string | null>()

	async resolveDisplayHrefs(
		core: CoreBinding,
		candidates: EntityLinkCandidate[],
		label: string,
	): Promise<Record<string, string>> {
		if (candidates.length === 0) {
			return {}
		}

		const uniqueCandidates = new Map<string, EntityLinkCandidate>()
		for (const candidate of candidates) {
			const entityId = candidate.entityId?.trim()
			if (!entityId) continue
			uniqueCandidates.set(entityId, {
				entityId,
				entityType: candidate.entityType ?? null,
			})
		}

		const result: Record<string, string> = {}
		const charactersToResolve: string[] = []

		for (const candidate of uniqueCandidates.values()) {
			const cachedHref = this.hrefCache.get(candidate.entityId)
			if (cachedHref !== undefined) {
				if (cachedHref) {
					result[candidate.entityId] = cachedHref
				}
				continue
			}

			const kind = normalizeEntityKind(candidate.entityId, candidate.entityType)
			if (kind === 'corporation' || kind === 'alliance') {
				const href = buildEveWhoHref(kind, candidate.entityId)
				this.hrefCache.set(candidate.entityId, href)
				result[candidate.entityId] = href
				continue
			}

			if (kind === 'character') {
				charactersToResolve.push(candidate.entityId)
				continue
			}

			this.hrefCache.set(candidate.entityId, null)
		}

		if (charactersToResolve.length > 0) {
			for (const batch of chunk(charactersToResolve, 25)) {
				await Promise.all(
					batch.map(async (characterId) => {
						try {
							const ownership = await core.getCharacterOwnership(characterId)
							const href = ownership?.userId
								? `/hr/users/${ownership.userId}`
								: buildEveWhoHref('character', characterId)
							this.hrefCache.set(characterId, href)
							result[characterId] = href
						} catch (error) {
							const href = buildEveWhoHref('character', characterId)
							this.hrefCache.set(characterId, href)
							result[characterId] = href
							logger.warn(`[${label}] Failed to resolve character ownership`, {
								characterId,
								error: error instanceof Error ? error.message : String(error),
							})
						}
					}),
				)
			}
		}

		return result
	}
}
