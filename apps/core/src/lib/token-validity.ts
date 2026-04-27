import { eq } from '@repo/db-utils'

import { userCharacters } from '../db/schema'

import type { TokenValidationResult, TokenValidationStatus, EveTokenStore } from '@repo/eve-token-store'
import type { DbClient, schema } from '../db'

const NON_DEGRADING_TOKEN_STATUSES: TokenValidationStatus[] = ['transient_error']

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
}: {
	db: DbClient<typeof schema>
	tokenStore: EveTokenStore
	characterId: string
	previousHasValidToken?: boolean | null
	touchLastCharacterRefresh?: boolean
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

	const validation = await tokenStore.validateToken(characterId)
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
}: {
	db: DbClient<typeof schema>
	tokenStore: EveTokenStore
	characters: Array<{ characterId: string; hasValidToken?: boolean | null }>
	maxConcurrency?: number
}): Promise<Map<string, boolean | null>> {
	const results = new Map<string, boolean | null>()
	if (characters.length === 0) return results

	let cursor = 0
	const workers = Math.max(1, Math.min(maxConcurrency, characters.length))

	await Promise.all(
		Array.from({ length: workers }, async () => {
			while (true) {
				const index = cursor
				cursor += 1
				if (index >= characters.length) return

				const character = characters[index]
				try {
					const result = await validateAndSyncCharacterTokenValidity({
						db,
						tokenStore,
						characterId: character.characterId,
						previousHasValidToken: character.hasValidToken ?? null,
					})
					results.set(character.characterId, result.nextHasValidToken)
				} catch {
					results.set(character.characterId, character.hasValidToken ?? null)
				}
			}
		})
	)

	return results
}
