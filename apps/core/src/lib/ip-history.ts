import { and, desc, eq, inArray, sql } from '@repo/db-utils'
import { parseDateOrNull } from '@repo/worker-utils'

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

function normalizeSeenWindow(firstSeenAt: Date, lastSeenAt: Date): { firstSeenAt: Date; lastSeenAt: Date } {
	const now = new Date()
	const clampedFirstSeenAt = firstSeenAt.getTime() > now.getTime() ? now : firstSeenAt
	const clampedLastSeenAt = lastSeenAt.getTime() > now.getTime() ? now : lastSeenAt
	if (clampedFirstSeenAt.getTime() <= clampedLastSeenAt.getTime()) {
		return { firstSeenAt: clampedFirstSeenAt, lastSeenAt: clampedLastSeenAt }
	}
	return { firstSeenAt: clampedLastSeenAt, lastSeenAt: clampedFirstSeenAt }
}

export async function getUserIpHistory(db: Db, userId: string): Promise<UserIpHistoryEntry[]> {
	const rows = await db
		.select({
			ipAddressHash: userIpAddresses.ipAddressHash,
			firstSeenAt: sql<Date>`min(${userIpAddresses.firstSeenAt})`,
			lastSeenAt: sql<Date>`max(${userIpAddresses.lastSeenAt})`,
			seenCount: sql<number>`count(*)`,
			distinctUserCount: sql<number>`0`,
		})
		.from(userIpAddresses)
		.where(eq(userIpAddresses.userId, userId))
		.groupBy(userIpAddresses.ipAddressHash)
		.orderBy(desc(sql`max(${userIpAddresses.lastSeenAt})`))

	if (rows.length === 0) return []

	const hashRows = await db
		.select({
			ipAddressHash: userIpAddresses.ipAddressHash,
			distinctUserCount: sql<number>`count(distinct ${userIpAddresses.userId})`,
		})
		.from(userIpAddresses)
		.innerJoin(users, eq(users.id, userIpAddresses.userId))
		.where(
			inArray(
				userIpAddresses.ipAddressHash,
				rows.map((row) => row.ipAddressHash)
			)
		)
		.groupBy(userIpAddresses.ipAddressHash)

	const distinctUsersByHash = new Map(
		hashRows.map((row) => [row.ipAddressHash, Number(row.distinctUserCount)])
	)

	const normalizedRows = rows
		.map((row) => {
			const now = new Date()
			const firstSeenAt = parseDateOrNull(row.firstSeenAt) ?? now
			const lastSeenAt = parseDateOrNull(row.lastSeenAt) ?? firstSeenAt
			const normalizedSeenWindow = normalizeSeenWindow(firstSeenAt, lastSeenAt)
			return {
				...row,
				firstSeenAt: normalizedSeenWindow.firstSeenAt,
				lastSeenAt: normalizedSeenWindow.lastSeenAt,
				distinctUserCount: distinctUsersByHash.get(row.ipAddressHash) ?? 0,
			}
		})
		.sort((left, right) => right.lastSeenAt.getTime() - left.lastSeenAt.getTime())

	return normalizedRows
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
				const now = new Date()
				const firstSeenAt = parseDateOrNull(row.firstSeenAt) ?? now
				const lastSeenAt = parseDateOrNull(row.lastSeenAt) ?? firstSeenAt
				return {
				userId: row.userId,
				mainCharacterId: details.mainCharacterId,
				mainCharacterName: details.mainCharacterName ?? null,
				isAdmin: details.isAdmin,
				seenCount: row.seenCount,
				...normalizeSeenWindow(firstSeenAt, lastSeenAt),
			}
		})
		.filter((row): row is IpHashUserMatch => row !== null)
}
