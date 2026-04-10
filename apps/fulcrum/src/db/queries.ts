import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { and, eq, inArray, lt } from 'drizzle-orm'
import { characterReports, schema } from './schema'

export type DbClient = NeonHttpDatabase<typeof schema>

// Helper: Build query to get report by ID (pure function)
export function buildGetReportQuery(reportId: string) {
	return eq(characterReports.id, reportId)
}

// Get report by ID
export async function getReport(db: DbClient, reportId: string) {
	return await db.query.characterReports.findFirst({
		where: buildGetReportQuery(reportId),
	})
}

// Check if report is cancelled
export async function isReportCancelled(
	db: DbClient,
	reportId: string,
): Promise<boolean> {
	const report = await getReport(db, reportId)
	return report?.status === 'cancelled'
}

// Helper: Build update report status query (pure function)
export function buildUpdateReportStatusQuery(
	reportId: string,
	status: string,
	updates?: Partial<{
		r2Bucket: string
		r2Key: string
		workflowInstanceId: string
		characterName: string
		errorMessage: string
		viewedAt: Date
	}>,
) {
	return {
		where: eq(characterReports.id, reportId),
		set: {
			status,
			...updates,
			updatedAt: new Date(),
		},
	}
}

// Update report status
export async function updateReportStatus(
	db: DbClient,
	reportId: string,
	status: string,
	updates?: Partial<{
		r2Bucket: string
		r2Key: string
		workflowInstanceId: string
		characterName: string
		errorMessage: string
		viewedAt: Date
	}>,
) {
	const query = buildUpdateReportStatusQuery(reportId, status, updates)
	await db
		.update(characterReports)
		.set(query.set)
		.where(query.where)
}

// Helper: Build create report query (pure function)
export function buildCreateReportQuery(params: {
	id: string
	characterId: string
	characterName?: string
	requestorUserId: string
	requestorCorporationId: string
	requestSource: string
	applicationId?: string
	retentionDays: number
	expiresAt?: Date
}) {
	return {
		id: params.id,
		characterId: params.characterId,
		characterName: params.characterName,
		status: 'pending',
		requestorUserId: params.requestorUserId,
		requestorCorporationId: params.requestorCorporationId,
		requestSource: params.requestSource,
		applicationId: params.applicationId,
		retentionDays: params.retentionDays,
		expiresAt: params.expiresAt,
	}
}

// Create a new character report
export async function createCharacterReport(
	db: DbClient,
	params: {
		id: string
		characterId: string
		characterName?: string
		requestorUserId: string
		requestorCorporationId: string
		requestSource: string
		applicationId?: string
		retentionDays: number
		expiresAt?: Date
	},
) {
	const values = buildCreateReportQuery(params)
	await db.insert(characterReports).values(values)
}

// Get an existing in-progress report for a character (pending or processing)
export async function getInProgressReportForCharacter(
	db: DbClient,
	characterId: string,
) {
	return await db.query.characterReports.findFirst({
		where: and(
			eq(characterReports.characterId, characterId),
			inArray(characterReports.status, ['pending', 'processing']),
		),
		orderBy: (reports, { desc }) => [desc(reports.createdAt)],
	})
}

// Get stale in-progress reports (pending/processing older than cutoff)
export async function getStaleInProgressReports(
	db: DbClient,
	cutoff: Date,
	limit = 200,
) {
	return await db.query.characterReports.findMany({
		where: and(
			inArray(characterReports.status, ['pending', 'processing']),
			lt(characterReports.updatedAt, cutoff),
		),
		orderBy: (reports, { asc }) => [asc(reports.updatedAt)],
		limit,
	})
}

// Get reports with filters
export async function listReports(
	db: DbClient,
	filters?: {
		corporationId?: string
		status?: string
		characterId?: string
	},
	limit = 50,
	offset = 0,
) {
	const conditions = []

	if (filters?.corporationId) {
		conditions.push(eq(characterReports.requestorCorporationId, filters.corporationId))
	}

	if (filters?.status) {
		conditions.push(eq(characterReports.status, filters.status))
	}

	if (filters?.characterId) {
		conditions.push(eq(characterReports.characterId, filters.characterId))
	}

	return await db.query.characterReports.findMany({
		where: conditions.length > 1 ? and(...conditions) : conditions[0],
		limit,
		offset,
		orderBy: (reports, { desc }) => [desc(reports.createdAt)],
	})
}

// Update viewed_at timestamp
export async function markReportViewed(db: DbClient, reportId: string) {
	const report = await getReport(db, reportId)

	// Only update if not already viewed
	if (report && !report.viewedAt) {
		await updateReportStatus(db, reportId, report.status, {
			viewedAt: new Date(),
		})
	}
}

// Get expired reports (expires_at < now AND status = completed)
export async function getExpiredReports(db: DbClient) {
	const now = new Date()

	return await db.query.characterReports.findMany({
		where: and(
			lt(characterReports.expiresAt, now),
			eq(characterReports.status, 'completed'),
		),
		columns: {
			id: true,
			characterId: true,
			r2Bucket: true,
			r2Key: true,
		},
	})
}
