import { getStub } from '@repo/do-utils'
import { getIdClassification } from '@repo/eve-types'

import type { Esi } from '@repo/esi'

export interface CharacterAffiliationDisplayCandidate {
	characterId: string
	characterName?: string
	forceCharacter?: boolean
}

interface CharacterAffiliationRecord {
	corporationId: string
	allianceId?: string | null
}

function chunk<T>(items: T[], size: number): T[][] {
	if (items.length === 0) return []
	const chunks: T[][] = []
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size))
	}
	return chunks
}

function isLikelyCharacterId(characterId: string): boolean {
	const type = getIdClassification(characterId).type
	return (
		type === 'character' ||
		type === 'character_2010_2016' ||
		type === 'character_post_2016' ||
		type === 'dust_character' ||
		type === 'dust_character_post_2016'
	)
}

function toDisplayName(prefix: string | null, rawName: string): string {
	return prefix ? `[${prefix}] ${rawName}` : rawName
}

/**
 * Run-scoped affiliation and ticker cache for character name display.
 *
 * This coordinator resolves each character's affiliation at most once per
 * workflow run, then reuses the resolved alliance/corporation ticker when
 * constructing display names in multiple report sections.
 */
export class CharacterAffiliationCoordinator {
	private readonly displayNameCache = new Map<string, string>()
	private readonly corporationTickerCache = new Map<string, string | null>()
	private readonly allianceTickerCache = new Map<string, string | null>()

	async resolveDisplayNames(
		env: {
			ESI: DurableObjectNamespace
		},
		characterId: string,
		candidates: CharacterAffiliationDisplayCandidate[],
		label: string,
	): Promise<Record<string, string>> {
		if (candidates.length === 0) {
			return {}
		}

		const uniqueCandidates = new Map<string, CharacterAffiliationDisplayCandidate>()
		for (const candidate of candidates) {
			if (!candidate.characterId) continue
			const existing = uniqueCandidates.get(candidate.characterId)
			if (!existing) {
				uniqueCandidates.set(candidate.characterId, candidate)
				continue
			}
			const merged: CharacterAffiliationDisplayCandidate = {
				characterId: candidate.characterId,
				characterName: existing.characterName ?? candidate.characterName,
				forceCharacter: Boolean(existing.forceCharacter || candidate.forceCharacter),
			}
			uniqueCandidates.set(candidate.characterId, merged)
		}

		const result: Record<string, string> = {}
		const missingCandidates: CharacterAffiliationDisplayCandidate[] = []
		for (const candidate of uniqueCandidates.values()) {
			const cachedDisplayName = this.displayNameCache.get(candidate.characterId)
			if (cachedDisplayName) {
				result[candidate.characterId] = cachedDisplayName
				continue
			}
			if (!candidate.forceCharacter && !isLikelyCharacterId(candidate.characterId)) {
				const rawName = candidate.characterName ?? candidate.characterId
				this.displayNameCache.set(candidate.characterId, rawName)
				result[candidate.characterId] = rawName
				continue
			}
			missingCandidates.push(candidate)
		}

		if (missingCandidates.length === 0) {
			return result
		}

		const missingCharacterIds = missingCandidates.map((candidate) => candidate.characterId)
		const affiliationByCharacterId = new Map<string, CharacterAffiliationRecord>()

		try {
			const esiStub = getStub<Esi>(env.ESI, 'default')
			for (const batch of chunk(missingCharacterIds, 1000)) {
				const affiliations = await esiStub.fetchCharacterAffiliation(characterId, batch, {
					cacheMode: 'default',
				})
				for (const affiliation of affiliations) {
					affiliationByCharacterId.set(String(affiliation.character_id), {
						corporationId: String(affiliation.corporation_id),
						allianceId: affiliation.alliance_id ? String(affiliation.alliance_id) : null,
					})
				}
			}
		} catch (error) {
			console.warn(`[${label}] Failed to resolve character affiliations`, {
				characterId,
				requestedCount: missingCharacterIds.length,
				error: error instanceof Error ? error.message : String(error),
			})
		}

		const uniqueCorporationIds = new Set<string>()
		const uniqueAllianceIds = new Set<string>()
		for (const affiliation of affiliationByCharacterId.values()) {
			uniqueCorporationIds.add(affiliation.corporationId)
			if (affiliation.allianceId) {
				uniqueAllianceIds.add(affiliation.allianceId)
			}
		}

		await this.prefetchAllianceTickers(env, uniqueAllianceIds, label)
		await this.prefetchCorporationTickers(env, uniqueCorporationIds, label)

		for (const candidate of uniqueCandidates.values()) {
			const rawName = candidate.characterName ?? candidate.characterId
			const affiliation = affiliationByCharacterId.get(candidate.characterId)
			if (!affiliation) {
				this.displayNameCache.set(candidate.characterId, rawName)
				result[candidate.characterId] = rawName
				continue
			}

			const ticker = this.resolveTickerForAffiliation(affiliation)
			const displayName = toDisplayName(ticker, rawName)
			this.displayNameCache.set(candidate.characterId, displayName)
			result[candidate.characterId] = displayName
		}

		return result
	}

	private async prefetchCorporationTickers(
		env: {
			ESI: DurableObjectNamespace
		},
		corporationIds: Set<string>,
		label: string,
	): Promise<void> {
		const unresolved = [...corporationIds].filter((corporationId) => !this.corporationTickerCache.has(corporationId))
		if (unresolved.length === 0) {
			return
		}

		const esiStub = getStub<Esi>(env.ESI, 'default')
		for (const batch of chunk(unresolved, 25)) {
			await Promise.all(
				batch.map(async (corporationId) => {
					try {
						const corporation = await esiStub.fetchCorporationPublicInfo(corporationId)
						this.corporationTickerCache.set(corporationId, corporation?.ticker?.trim() || null)
					} catch (error) {
						this.corporationTickerCache.set(corporationId, null)
						console.warn(`[${label}] Failed to resolve corporation ticker`, {
							corporationId,
							error: error instanceof Error ? error.message : String(error),
						})
					}
				}),
			)
		}
	}

	private async prefetchAllianceTickers(
		env: {
			ESI: DurableObjectNamespace
		},
		allianceIds: Set<string>,
		label: string,
	): Promise<void> {
		const unresolved = [...allianceIds].filter((allianceId) => !this.allianceTickerCache.has(allianceId))
		if (unresolved.length === 0) {
			return
		}

		const esiStub = getStub<Esi>(env.ESI, 'default')
		for (const batch of chunk(unresolved, 25)) {
			await Promise.all(
				batch.map(async (allianceId) => {
					try {
						const alliance = await esiStub.fetchAlliancePublicInfo(allianceId)
						this.allianceTickerCache.set(allianceId, alliance?.ticker?.trim() || null)
					} catch (error) {
						this.allianceTickerCache.set(allianceId, null)
						console.warn(`[${label}] Failed to resolve alliance ticker`, {
							allianceId,
							error: error instanceof Error ? error.message : String(error),
						})
					}
				}),
			)
		}
	}

	private resolveTickerForAffiliation(affiliation: CharacterAffiliationRecord): string | null {
		if (affiliation.allianceId) {
			const allianceTicker = this.allianceTickerCache.get(affiliation.allianceId)
			if (allianceTicker) {
				return allianceTicker
			}
		}

		const corpTicker = this.corporationTickerCache.get(affiliation.corporationId)
		return corpTicker ?? null
	}
}
