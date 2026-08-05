import { and, eq, inArray } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { buildCsvLine, createR2MultipartTextWriter } from '@repo/worker-utils'

import { createDb, schema } from '../db'
import { getExportArtifactExpiresAtIso } from './export-retention'

import type { FleetParticipationExportPageRequest, Fleets } from '@repo/fleets'
import type { Env } from '../context'

export const FLEET_PARTICIPATION_EXPORT_BUCKET_PREFIX = 'fleet-participation'
export const FLEET_PARTICIPATION_EXPORT_PAGE_SIZE = 500

export type FleetParticipationExportParams = {
	kind: 'fleet-corporation-participation'
	userId: string
	corporationId: string
	dateFrom: string
	dateTo: string
}

export function getFleetParticipationExportBucket(env: Pick<Env, 'FLEET_EXPORTS'>): R2Bucket {
	return env.FLEET_EXPORTS
}

export function buildFleetParticipationExportKey(exportId: string): string {
	return `${FLEET_PARTICIPATION_EXPORT_BUCKET_PREFIX}/${exportId}.csv`
}

export function buildFleetParticipationExportFileName(
	corporationId: string,
	dateFrom: string,
	dateTo: string
): string {
	return `fleet-participation-${corporationId}-${dateFrom.slice(0, 10)}-${dateTo.slice(0, 10)}.csv`
}

function formatDuration(seconds: number): string {
	let remaining = Math.max(0, Math.round(seconds))
	const units: Array<[string, number]> = [
		['d', 24 * 60 * 60],
		['h', 60 * 60],
		['m', 60],
		['s', 1],
	]
	const parts: string[] = []
	for (const [label, size] of units) {
		if (parts.length >= 2) break
		const value = Math.floor(remaining / size)
		if (value > 0 || (label === 's' && parts.length === 0)) {
			parts.push(`${value}${label}`)
			remaining -= value * size
		}
	}
	return parts.join(' ')
}

export async function writeFleetParticipationExportToBucket(args: {
	env: Pick<Env, 'FLEETS' | 'DATABASE_URL' | 'FLEET_EXPORTS'>
	exportId: string
	corporationId: string
	dateFrom: string
	dateTo: string
	fileName: string
	expiresAt?: string
}): Promise<{ rowCount: number; expiresAt: string }> {
	const expiresAt = args.expiresAt ?? getExportArtifactExpiresAtIso()
	const writer = await createR2MultipartTextWriter(
		getFleetParticipationExportBucket(args.env),
		buildFleetParticipationExportKey(args.exportId),
		{
			httpMetadata: { contentType: 'text/csv; charset=utf-8' },
			customMetadata: { fileName: args.fileName, expiresAt },
		}
	)
	const fleets = getStub<Fleets>(args.env.FLEETS, 'default')
	const db = createDb(args.env.DATABASE_URL)
	const ownershipCache = new Map<string, { userId: string; mainCharacterName: string } | null>()
	let cursor: string | null = null
	let rowCount = 0

	try {
		await writer.writeLine(
			buildCsvLine([
				'Date stamp',
				'Core UserID',
				'User Main Character Name',
				'Fleet Character ID',
				'Fleet Character Name',
				'Fleet Session ID',
				'Fleet Name',
				'Role',
				'Ships Flown',
				'Duration',
			])
		)

		do {
			const request: FleetParticipationExportPageRequest = {
				corporationId: args.corporationId,
				from: args.dateFrom,
				to: args.dateTo,
				cursor,
				limit: FLEET_PARTICIPATION_EXPORT_PAGE_SIZE,
			}
			const page = await fleets.getCorporationFleetParticipationPage(request)
			const characterIds = page.items.map((row) => row.fleetCharacterId)
			const linkedRows =
				characterIds.length === 0
					? []
					: await db
							.select({
								characterId: schema.userCharacters.characterId,
								userId: schema.userCharacters.userId,
							})
							.from(schema.userCharacters)
							.where(
								and(
									inArray(schema.userCharacters.characterId, characterIds),
									eq(schema.userCharacters.isDeleted, false)
								)
							)

			const userIds = [...new Set(linkedRows.map((row) => row.userId))]
			const primaryRows =
				userIds.length === 0
					? []
					: await db
							.select({
								userId: schema.userCharacters.userId,
								characterName: schema.userCharacters.characterName,
							})
							.from(schema.userCharacters)
							.where(
								and(
									inArray(schema.userCharacters.userId, userIds),
									eq(schema.userCharacters.is_primary, true),
									eq(schema.userCharacters.isDeleted, false)
								)
							)
			const primaryNames = new Map(primaryRows.map((row) => [row.userId, row.characterName]))
			const linkedUsers = new Map(linkedRows.map((row) => [row.characterId, row.userId]))

			for (const row of page.items) {
				if (!ownershipCache.has(row.fleetCharacterId)) {
					const userId = linkedUsers.get(row.fleetCharacterId)
					ownershipCache.set(
						row.fleetCharacterId,
						userId ? { userId, mainCharacterName: primaryNames.get(userId) ?? '' } : null
					)
				}
				const owner = ownershipCache.get(row.fleetCharacterId)
				await writer.writeLine(
					buildCsvLine([
						row.dateStamp,
						owner?.userId ?? '',
						owner?.mainCharacterName ?? '',
						row.fleetCharacterId,
						row.fleetCharacterName ?? '',
						row.fleetSessionId,
						row.fleetName,
						row.role,
						row.shipCount,
						formatDuration(row.durationSeconds),
					])
				)
				rowCount += 1
			}
			cursor = page.nextCursor
		} while (cursor)

		await writer.close()
		return { rowCount, expiresAt }
	} catch (error) {
		await writer.abort().catch(() => {})
		throw error
	}
}
