import { and, desc, eq, inArray, sql } from '@repo/db-utils'

import { userCharacters, userIpAddresses, users } from '../db/schema'

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '../db/schema'

type Db = PostgresJsDatabase<typeof schema>

export interface UserIpHistoryEntry {
	ipAddressHash: string
	firstSeenAt: Date
	lastSeenAt: Date
	seenCount: number
	distinctUserCount: number
}

export interface IpHashUserMatch {
	userId: string
	mainCharacterId: string
	mainCharacterName: string | null
	isAdmin: boolean
	seenCount: number
	firstSeenAt: Date
	lastSeenAt: Date
}

export async function getUserIpHistory(db: Db, userId: string): Promise<UserIpHistoryEntry[]> {
	const rows = await db
		.select({
			ipAddressHash: userIpAddresses.ipAddressHash,
			firstSeenAt: sql<Date>`min(${userIpAddresses.firstSeenAt})`,
			lastSeenAt: sql<Date>`max(${userIpAddresses.lastSeenAt})`,
			seenCount: sql<number>`count(*)`,
			distinctUserCount: sql<number>`(
				select count(distinct u2.user_id)
				from user_ip_addresses u2
				where u2.ip_address_hash = ${userIpAddresses.ipAddressHash}
			)`,
		})
		.from(userIpAddresses)
		.where(eq(userIpAddresses.userId, userId))
		.groupBy(userIpAddresses.ipAddressHash)
		.orderBy(desc(sql`max(${userIpAddresses.lastSeenAt})`))

	return rows
}

export async function getIpHashMatches(db: Db, ipAddressHash: string): Promise<IpHashUserMatch[]> {
	const userRows = await db
		.select({
			userId: userIpAddresses.userId,
			seenCount: sql<number>`count(*)`,
			firstSeenAt: sql<Date>`min(${userIpAddresses.firstSeenAt})`,
			lastSeenAt: sql<Date>`max(${userIpAddresses.lastSeenAt})`,
		})
		.from(userIpAddresses)
		.where(eq(userIpAddresses.ipAddressHash, ipAddressHash))
		.groupBy(userIpAddresses.userId)
		.orderBy(desc(sql`max(${userIpAddresses.lastSeenAt})`))

	if (userRows.length === 0) return []

	const userIds = userRows.map((row) => row.userId)
	const userDetails = await db
		.select({
			id: users.id,
			mainCharacterId: users.mainCharacterId,
			isAdmin: users.is_admin,
			mainCharacterName: userCharacters.characterName,
		})
		.from(users)
		.leftJoin(
			userCharacters,
			and(
				eq(userCharacters.userId, users.id),
				eq(userCharacters.characterId, users.mainCharacterId)
			)
		)
		.where(inArray(users.id, userIds))

	const detailsByUserId = new Map(userDetails.map((row) => [row.id, row]))

	return userRows
		.map((row) => {
			const details = detailsByUserId.get(row.userId)
			if (!details) return null
			return {
				userId: row.userId,
				mainCharacterId: details.mainCharacterId,
				mainCharacterName: details.mainCharacterName ?? null,
				isAdmin: details.isAdmin,
				seenCount: row.seenCount,
				firstSeenAt: row.firstSeenAt,
				lastSeenAt: row.lastSeenAt,
			}
		})
		.filter((row): row is IpHashUserMatch => row !== null)
}
