import type { EveTokenStore } from '@repo/eve-token-store'

/**
 * EntityResolverService
 *
 * Utility service for resolving EVE Online entity IDs to human-readable names.
 * Uses the EVE Token Store Durable Object's bulk resolution capabilities.
 */
export class EntityResolverService {
	private nameCache: Map<number, string>

	constructor(private eveTokenStore: EveTokenStore) {
		this.nameCache = new Map()
	}

	/**
	 * Resolve multiple entity IDs to names in bulk
	 * Caches results for the duration of the request
	 *
	 * @param ids - Array of entity IDs to resolve
	 * @returns Map of ID to name
	 */
	async resolveEntityNames(ids: number[]): Promise<Map<number, string>> {
		if (ids.length === 0) {
			return new Map()
		}

		// Filter out IDs we already have cached
		const uncachedIds = ids.filter((id) => !this.nameCache.has(id))

		// If we have uncached IDs, fetch them
		if (uncachedIds.length > 0) {
			try {
				const resolved = await this.eveTokenStore.resolveIds(uncachedIds)

				// Store in cache
				for (const [id, name] of Object.entries(resolved)) {
					this.nameCache.set(Number(id), name)
				}
			} catch (error) {
				console.error('Error resolving entity names:', error)
			}
		}

		// Build result map from cache
		const result = new Map<number, string>()
		for (const id of ids) {
			const name = this.nameCache.get(id)
			if (name) {
				result.set(id, name)
			}
		}

		return result
	}

	/**
	 * Resolve a single character ID to name
	 */
	async resolveCharacterName(characterId: number): Promise<string | null> {
		const names = await this.resolveEntityNames([characterId])
		return names.get(characterId) || null
	}

	/**
	 * Resolve a single corporation ID to name
	 */
	async resolveCorporationName(corporationId: number): Promise<string | null> {
		const names = await this.resolveEntityNames([corporationId])
		return names.get(corporationId) || null
	}

	/**
	 * Resolve a single alliance ID to name
	 */
	async resolveAllianceName(allianceId: number): Promise<string | null> {
		const names = await this.resolveEntityNames([allianceId])
		return names.get(allianceId) || null
	}

	/**
	 * Resolve a single solar system ID to name
	 */
	async resolveSystemName(systemId: number): Promise<string | null> {
		const names = await this.resolveEntityNames([systemId])
		return names.get(systemId) || null
	}

	/**
	 * Enrich corporation history entries with resolved names
	 *
	 * @param history - Array of corporation history entries
	 * @returns Enriched history with corporationName added to each entry
	 */
	async enrichCorporationHistory<T extends { corporationId: number }>(
		history: T[]
	): Promise<Array<T & { corporationName: string }>> {
		if (history.length === 0) {
			return []
		}

		// Extract unique corporation IDs
		const corpIds = [...new Set(history.map((entry) => entry.corporationId))]

		// Resolve all corporation names in bulk
		const names = await this.resolveEntityNames(corpIds)

		// Add names to history entries
		return history.map((entry) => ({
			...entry,
			corporationName: names.get(entry.corporationId) || `Corporation #${entry.corporationId}`,
		}))
	}
}
