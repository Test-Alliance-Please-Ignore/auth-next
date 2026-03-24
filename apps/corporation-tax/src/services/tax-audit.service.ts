import { and, desc, eq, gte, ilike, lte, sql } from '@repo/db-utils'

import { taxAuditLog } from '../db/schema'

import type {
	ListTaxAuditLogFilters,
	TaxAuditLogEntry,
	TaxPagedResult,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

export class TaxAuditService {
	constructor(private db: CorporationTaxDb) {}

	async logAction(input: {
		corporationId?: string
		actorUserId: string
		action: string
		before?: Record<string, unknown> | null
		after?: Record<string, unknown> | null
	}): Promise<void> {
		await this.db.insert(taxAuditLog).values({
			corporationId: input.corporationId ?? null,
			actorUserId: input.actorUserId,
			action: input.action,
			before: input.before ?? null,
			after: input.after ?? null,
		})
	}

	async listAuditLog(
		filters: ListTaxAuditLogFilters = {}
	): Promise<TaxPagedResult<TaxAuditLogEntry>> {
		const conditions = []

		if (filters.corporationId) {
			conditions.push(eq(taxAuditLog.corporationId, filters.corporationId))
		}
		if (filters.actorUserId) {
			conditions.push(eq(taxAuditLog.actorUserId, filters.actorUserId))
		}
		if (filters.action) {
			conditions.push(ilike(taxAuditLog.action, `%${filters.action}%`))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxAuditLog.createdAt, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxAuditLog.createdAt, filters.toDate))
		}

		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const where = conditions.length > 0 ? and(...conditions) : undefined
		const [rows, countRows] = await Promise.all([
			this.db.query.taxAuditLog.findMany({
				where,
				orderBy: [desc(taxAuditLog.createdAt)],
				limit,
				offset,
			}),
			this.db
				.select({ count: sql<number>`count(*)` })
				.from(taxAuditLog)
				.where(where),
		])

		return {
			rows: rows.map((row) => ({
				id: row.id,
				corporationId: row.corporationId,
				actorUserId: row.actorUserId,
				action: row.action,
				before: row.before,
				after: row.after,
				createdAt: row.createdAt,
			})),
			totalRows: Number(countRows[0]?.count ?? 0),
		}
	}
}
