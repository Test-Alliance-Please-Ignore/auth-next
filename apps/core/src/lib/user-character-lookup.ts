import { and, eq } from '@repo/db-utils'

import { userCharacters } from '../db/schema'

import type { DbClient, schema } from '../db'

export async function getPrimaryCharacterSummaryByUserId(
	db: DbClient<typeof schema>,
	userId: string
): Promise<{ characterId: string; characterName: string } | null> {
	const row = await db.query.userCharacters.findFirst({
		where: and(eq(userCharacters.userId, userId), eq(userCharacters.is_primary, true)),
		columns: {
			characterId: true,
			characterName: true,
			is_primary: true,
		},
	})

	if (!row || row.is_primary !== true) {
		return null
	}

	return {
		characterId: row.characterId,
		characterName: row.characterName,
	}
}
