import { and, eq } from '@repo/db-utils'

import { userCharacters } from '../db/schema'

import type { DbClient, schema } from '../db'

/**
 * Resolve all corporation IDs the user is affiliated with through linked characters.
 * This is intentionally HR-agnostic and only reflects persisted character affiliation.
 */
export async function getUserCorporationAffiliationIds(
	db: DbClient<typeof schema>,
	userId: string
): Promise<string[]> {
	const rows = await db.query.userCharacters.findMany({
		where: and(eq(userCharacters.userId, userId), eq(userCharacters.isDeleted, false)),
		columns: {
			corporationId: true,
		},
	})

	return [...new Set(rows.map((row) => row.corporationId).filter(Boolean))] as string[]
}

/**
 * Check whether the user is affiliated with a specific corporation through any linked character.
 */
export async function hasUserCorporationAffiliation(
	db: DbClient<typeof schema>,
	userId: string,
	corporationId: string
): Promise<boolean> {
	const corporationIds = await getUserCorporationAffiliationIds(db, userId)
	return corporationIds.includes(corporationId)
}
