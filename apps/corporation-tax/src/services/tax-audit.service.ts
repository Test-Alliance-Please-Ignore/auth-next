import { and, desc, eq, gte, lte } from '@repo/db-utils'

import { taxAuditLog } from '../db/schema'

import type { ListTaxAuditLogFilters, TaxAuditLogEntry } from '@repo/corporation-tax'
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

	async listAuditLog(filters: ListTaxAuditLogFilters = {}): Promise<TaxAuditLogEntry[]> {
		const conditions = []

		if (filters.corporationId) {
			conditions.push(eq(taxAuditLog.corporationId, filters.corporationId))
		}
		if (filters.actorUserId) {
			conditions.push(eq(taxAuditLog.actorUserId, filters.actorUserId))
		}
		if (filters.action) {
			conditions.push(eq(taxAuditLog.action, filters.action))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxAuditLog.createdAt, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxAuditLog.createdAt, filters.toDate))
		}

		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const rows = await this.db.query.taxAuditLog.findMany({
			where: conditions.length > 0 ? and(...conditions) : undefined,
			orderBy: [desc(taxAuditLog.createdAt)],
			limit,
			offset,
		})

		return rows.map((row) => ({
			id: row.id,
			corporationId: row.corporationId,
			actorUserId: row.actorUserId,
			action: row.action,
			before: row.before,
			after: row.after,
			createdAt: row.createdAt,
		}))
	}
}
