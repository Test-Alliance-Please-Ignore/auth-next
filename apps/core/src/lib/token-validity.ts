import { eq, inArray } from '@repo/db-utils'

import { userCharacters } from '../db/schema'

import type { TokenValidationResult, TokenValidationStatus, EveTokenStore } from '@repo/eve-token-store'
import type { DbClient, schema } from '../db'

const NON_DEGRADING_TOKEN_STATUSES: TokenValidationStatus[] = ['transient_error']
const DEFAULT_TOKEN_VALIDITY_CACHE_MS = 86_400_000

export function isNonDegradingTokenStatus(status: TokenValidationStatus): boolean {
	return NON_DEGRADING_TOKEN_STATUSES.includes(status)
}

export function resolveNextTokenValidity(
	previousHasValidToken: boolean | null,
	validation: TokenValidationResult
): boolean | null {
	if (isNonDegradingTokenStatus(validation.status)) {
		return previousHasValidToken
	}
	return validation.isValid
}

export async function validateAndSyncCharacterTokenValidity({
	db,
	tokenStore,
	characterId,
	previousHasValidToken,
	touchLastCharacterRefresh = false,
	forceValidate = false,
}: {
	db: DbClient<typeof schema>
	tokenStore: EveTokenStore
	characterId: string
	previousHasValidToken?: boolean | null
	touchLastCharacterRefresh?: boolean
	forceValidate?: boolean
}): Promise<{
	previousHasValidToken: boolean | null
	nextHasValidToken: boolean | null
	validation: TokenValidationResult
}> {
	let previous = previousHasValidToken ?? null
	if (previousHasValidToken === undefined) {
		const existingCharacter = await db.query.userCharacters.findFirst({
			where: eq(userCharacters.characterId, characterId),
			columns: { hasValidToken: true },
		})
		previous = existingCharacter?.hasValidToken ?? null
	}

	const validation = await tokenStore.validateToken(characterId, undefined, { force: forceValidate })
	const next = resolveNextTokenValidity(previous, validation)
	const shouldWrite =
		touchLastCharacterRefresh || previous !== next

	if (shouldWrite) {
		const updateValues: {
			hasValidToken: boolean | null
			updatedAt: Date
			lastCharacterRefresh?: Date
		} = {
			hasValidToken: next,
			updatedAt: new Date(),
		}
		if (touchLastCharacterRefresh) {
			updateValues.lastCharacterRefresh = new Date()
		}

		await db
			.update(userCharacters)
			.set(updateValues)
			.where(eq(userCharacters.characterId, characterId))
	}

	return {
		previousHasValidToken: previous,
		nextHasValidToken: next,
		validation,
	}
}

export async function validateAndSyncCharacterTokenValidityBatch({
	db,
	tokenStore,
	characters,
	maxConcurrency = 10,
	validityCacheMs = DEFAULT_TOKEN_VALIDITY_CACHE_MS,
	forceValidate = false,
}: {
	db: DbClient<typeof schema>
	tokenStore: EveTokenStore
	characters: Array<{ characterId: string; hasValidToken?: boolean | null }>
	maxConcurrency?: number
	validityCacheMs?: number
	forceValidate?: boolean
}): Promise<Map<string, boolean | null>> {
	const results = new Map<string, boolean | null>()
	if (characters.length === 0) return results

	const uniqueCharacterIds = [...new Set(characters.map((character) => character.characterId))]
	const existingRows =
		uniqueCharacterIds.length > 0
			? await db.query.userCharacters.findMany({
				where: inArray(userCharacters.characterId, uniqueCharacterIds),
				columns: {
					characterId: true,
					hasValidToken: true,
					lastCharacterRefresh: true,
				},
			})
			: []
	const existingByCharacterId = new Map(existingRows.map((row) => [row.characterId, row]))

	let cursor = 0
	const workers = Math.max(1, Math.min(maxConcurrency, characters.length))

	await Promise.all(
		Array.from({ length: workers }, async () => {
			while (true) {
				const index = cursor
				cursor += 1
				if (index >= characters.length) return

				const character = characters[index]
				const existing = existingByCharacterId.get(character.characterId)
				const previousHasValidToken =
					existing?.hasValidToken ?? character.hasValidToken ?? null
				const isFresh =
					!forceValidate &&
					previousHasValidToken !== null &&
					existing?.lastCharacterRefresh != null &&
					Date.now() - existing.lastCharacterRefresh.getTime() <= validityCacheMs

				if (isFresh) {
					results.set(character.characterId, previousHasValidToken)
					continue
				}

				try {
					const result = await validateAndSyncCharacterTokenValidity({
						db,
						tokenStore,
						characterId: character.characterId,
						previousHasValidToken,
						touchLastCharacterRefresh: true,
					})
					results.set(character.characterId, result.nextHasValidToken)
				} catch {
					results.set(character.characterId, previousHasValidToken)
				}
			}
		})
	)

	return results
}
