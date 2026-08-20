import { getStub } from '@repo/do-utils'
import { getEsiInstanceForCharacter } from '@repo/esi'
import { logger } from '@repo/hono-helpers'

import type { CharacterKillmailBasic } from '@repo/esi'
import type { EveTokenStore } from '@repo/eve-token-store'
import type { KillmailDetail } from '@repo/universe'
import type { Env } from '../context'

export class SrpKillmailNotFoundError extends Error {
	constructor(public readonly path: string) {
		super(`Killmail not found for ${path}`)
		this.name = 'SrpKillmailNotFoundError'
	}
}

/**
 * SRP-specific killmail policy over the shared ESI boundary.
 *
 * Caching, ETags, rate limits, and access-token acquisition are owned by ESI.
 * SRP only retains its domain reaction to a deleted character response.
 */
export class SrpKillmailEsiClient {
	constructor(private readonly env: Env) {}

	private async handleCharacterDeleted(characterId: string, error: unknown): Promise<never> {
		const message = error instanceof Error ? error.message : String(error)
		if (!message.includes('Character has been deleted')) {
			throw error
		}

		try {
			await getStub<EveTokenStore>(this.env.EVE_TOKEN_STORE, 'default').markCharacterDeleted(
				characterId
			)
		} catch (markDeletedError) {
			logger.warn('[SrpKillmailEsiClient] Failed to mark character as deleted', {
				characterId,
				error:
					markDeletedError instanceof Error ? markDeletedError.message : String(markDeletedError),
			})
		}

		throw error
	}

	async fetchCharacterKillmailPage(
		characterId: string,
		page: number
	): Promise<{ data: CharacterKillmailBasic[]; pages: number }> {
		try {
			return await getEsiInstanceForCharacter(
				this.env.ESI,
				characterId
			).fetchCharacterBasicKillmailPage(characterId, page)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (message.includes('404')) {
				throw new SrpKillmailNotFoundError(
					`/characters/${characterId}/killmails/recent?page=${page}`
				)
			}
			return await this.handleCharacterDeleted(characterId, error)
		}
	}

	async fetchCharacterKillmailDetail(
		characterId: string,
		killmailId: string,
		killmailHash: string
	): Promise<KillmailDetail | null> {
		try {
			return await getEsiInstanceForCharacter(
				this.env.ESI,
				characterId
			).fetchCharacterKillmailDetail(characterId, killmailId, killmailHash)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			if (message.includes('404')) {
				return null
			}
			if (message.includes('Character has been deleted')) {
				return await this.handleCharacterDeleted(characterId, error)
			}
			throw error
		}
	}
}
