import { asc, desc, eq } from '@repo/db-utils'

import { taxCorporationExclusions } from '../db/schema'

import type {
	ListTaxCorporationExclusionsFilters,
	TaxCorporationExclusion,
	UpsertTaxCorporationExclusionInput,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

export class TaxCorporationExclusionsService {
	constructor(private db: CorporationTaxDb) {}

	async upsertExclusion(
		actorUserId: string,
		corporationId: string,
		input: UpsertTaxCorporationExclusionInput
	): Promise<TaxCorporationExclusion> {
		const reason = input.reason?.trim() || null
		const now = new Date()
		const [upserted] = await this.db
			.insert(taxCorporationExclusions)
			.values({
				corporationId,
				reason,
				createdBy: actorUserId,
				updatedBy: actorUserId,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: taxCorporationExclusions.corporationId,
				set: {
					reason,
					updatedBy: actorUserId,
					updatedAt: now,
				},
			})
			.returning()

		if (!upserted) {
			throw new Error('Failed to upsert corporation exclusion')
		}

		return this.toExclusion(upserted)
	}

	async deleteExclusion(corporationId: string): Promise<void> {
		await this.db
			.delete(taxCorporationExclusions)
			.where(eq(taxCorporationExclusions.corporationId, corporationId))
	}

	async getExclusion(corporationId: string): Promise<TaxCorporationExclusion | null> {
		const row = await this.db.query.taxCorporationExclusions.findFirst({
			where: eq(taxCorporationExclusions.corporationId, corporationId),
		})
		return row ? this.toExclusion(row) : null
	}

	async listExclusions(
		filters?: ListTaxCorporationExclusionsFilters
	): Promise<TaxCorporationExclusion[]> {
		const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 500)
		const offset = Math.max(filters?.offset ?? 0, 0)
		const rows = await this.db.query.taxCorporationExclusions.findMany({
			orderBy: [
				asc(taxCorporationExclusions.createdAt),
				desc(taxCorporationExclusions.updatedAt),
				asc(taxCorporationExclusions.corporationId),
			],
			limit,
			offset,
		})
		return rows.map((row) => this.toExclusion(row))
	}

	async isExcluded(corporationId: string): Promise<boolean> {
		const row = await this.db.query.taxCorporationExclusions.findFirst({
			where: eq(taxCorporationExclusions.corporationId, corporationId),
			columns: { corporationId: true },
		})
		return Boolean(row)
	}

	async getExcludedCorporationIdSet(): Promise<Set<string>> {
		const rows = await this.db.query.taxCorporationExclusions.findMany({
			columns: { corporationId: true },
			limit: 10_000,
		})
		return new Set(rows.map((row) => row.corporationId))
	}

	private toExclusion(
		row: typeof taxCorporationExclusions.$inferSelect
	): TaxCorporationExclusion {
		return {
			corporationId: row.corporationId,
			reason: row.reason,
			createdBy: row.createdBy,
			updatedBy: row.updatedBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
