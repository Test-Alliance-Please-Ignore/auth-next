import { and, asc, eq } from '@repo/db-utils'

import {
	taxCorporationExclusions,
	taxRuleGroupAttachments,
	taxRuleGroups,
	taxRuleSets,
} from '../db/schema'

import type {
	CreateTaxRuleGroupInput,
	ListTaxRuleGroupsFilters,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	UpdateTaxRuleGroupInput,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

const DEFAULT_GLOBAL_RULE_GROUP_NAME = 'Alliance Global (default)'

export class TaxRuleGroupService {
	constructor(private db: CorporationTaxDb) {}

	async ensureDefaultGlobalGroup(createdBy: string): Promise<TaxRuleGroup> {
		const existing = await this.db.query.taxRuleGroups.findFirst({
			where: eq(taxRuleGroups.isDefaultGlobal, true),
		})
		if (existing) {
			if (
				existing.name !== DEFAULT_GLOBAL_RULE_GROUP_NAME ||
				existing.description !== 'System default alliance global rule group'
			) {
				const [normalized] = await this.db
					.update(taxRuleGroups)
					.set({
						name: DEFAULT_GLOBAL_RULE_GROUP_NAME,
						description: 'System default alliance global rule group',
						updatedAt: new Date(),
					})
					.where(eq(taxRuleGroups.id, existing.id))
					.returning()
				if (normalized) {
					return this.toRuleGroup(normalized)
				}
			}
			return this.toRuleGroup(existing)
		}

		const [created] = await this.db
			.insert(taxRuleGroups)
			.values({
				name: DEFAULT_GLOBAL_RULE_GROUP_NAME,
				description: 'System default alliance global rule group',
				isDefaultGlobal: true,
				isSystem: true,
				createdBy,
			})
			.returning()
		if (!created) {
			throw new Error('Failed to create default global rule group')
		}
		return this.toRuleGroup(created)
	}

	async listRuleGroups(filters?: ListTaxRuleGroupsFilters): Promise<TaxRuleGroup[]> {
		const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 500)
		const offset = Math.max(filters?.offset ?? 0, 0)

		if (filters?.corporationId) {
			const rows = await this.db
				.select({
					id: taxRuleGroups.id,
					name: taxRuleGroups.name,
					description: taxRuleGroups.description,
					isDefaultGlobal: taxRuleGroups.isDefaultGlobal,
					isSystem: taxRuleGroups.isSystem,
					createdBy: taxRuleGroups.createdBy,
					createdAt: taxRuleGroups.createdAt,
					updatedAt: taxRuleGroups.updatedAt,
				})
				.from(taxRuleGroups)
				.innerJoin(
					taxRuleGroupAttachments,
					and(
						eq(taxRuleGroupAttachments.ruleGroupId, taxRuleGroups.id),
						eq(taxRuleGroupAttachments.corporationId, filters.corporationId)
					)
				)
				.orderBy(asc(taxRuleGroups.name))
				.limit(limit)
				.offset(offset)

			return rows.map((row) =>
				this.toRuleGroup({
					id: row.id,
					name: row.name,
					description: row.description,
					isDefaultGlobal: row.isDefaultGlobal,
					isSystem: row.isSystem,
					createdBy: row.createdBy,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				})
			)
		}

		const rows = await this.db.query.taxRuleGroups.findMany({
			orderBy: [asc(taxRuleGroups.isDefaultGlobal), asc(taxRuleGroups.name)],
			limit,
			offset,
		})
		return rows
			.sort((a, b) => {
				if (a.isDefaultGlobal !== b.isDefaultGlobal) {
					return a.isDefaultGlobal ? -1 : 1
				}
				return a.name.localeCompare(b.name)
			})
			.map((row) => this.toRuleGroup(row))
	}

	async createRuleGroup(
		actorUserId: string,
		input: CreateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		const name = input.name.trim()
		if (!name) {
			throw new Error('Rule group name is required')
		}

		const [created] = await this.db
			.insert(taxRuleGroups)
			.values({
				name,
				description: input.description?.trim() || null,
				createdBy: actorUserId,
				isDefaultGlobal: false,
				isSystem: false,
			})
			.returning()
		if (!created) {
			throw new Error('Failed to create rule group')
		}
		return this.toRuleGroup(created)
	}

	async updateRuleGroup(
		ruleGroupId: string,
		input: UpdateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		const existing = await this.db.query.taxRuleGroups.findFirst({
			where: eq(taxRuleGroups.id, ruleGroupId),
		})
		if (!existing) {
			throw new Error('Rule group not found')
		}
		if (existing.isSystem || existing.isDefaultGlobal) {
			throw new Error('Default global rule group cannot be updated')
		}

		const updates: Partial<typeof taxRuleGroups.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (input.name !== undefined) {
			const name = input.name.trim()
			if (!name) {
				throw new Error('Rule group name is required')
			}
			updates.name = name
		}
		if (input.description !== undefined) {
			updates.description = input.description?.trim() || null
		}

		const [updated] = await this.db
			.update(taxRuleGroups)
			.set(updates)
			.where(eq(taxRuleGroups.id, ruleGroupId))
			.returning()
		if (!updated) throw new Error('Rule group not found')
		return this.toRuleGroup(updated)
	}

	async deleteRuleGroup(ruleGroupId: string): Promise<void> {
		const group = await this.db.query.taxRuleGroups.findFirst({
			where: eq(taxRuleGroups.id, ruleGroupId),
		})
		if (!group) {
			throw new Error('Rule group not found')
		}
		if (group.isSystem || group.isDefaultGlobal) {
			throw new Error('Default global rule group cannot be deleted')
		}

		const existingRules = await this.db.query.taxRuleSets.findFirst({
			where: eq(taxRuleSets.ruleGroupId, ruleGroupId),
			columns: { id: true },
		})
		if (existingRules) {
			throw new Error('Rule group has attached rules and cannot be deleted')
		}

		await this.db
			.delete(taxRuleGroupAttachments)
			.where(eq(taxRuleGroupAttachments.ruleGroupId, ruleGroupId))
		await this.db.delete(taxRuleGroups).where(eq(taxRuleGroups.id, ruleGroupId))
	}

	async listRuleGroupAttachments(ruleGroupId: string): Promise<TaxRuleGroupAttachment[]> {
		const rows = await this.db
			.select({
				id: taxRuleGroupAttachments.id,
				ruleGroupId: taxRuleGroupAttachments.ruleGroupId,
				corporationId: taxRuleGroupAttachments.corporationId,
				createdAt: taxRuleGroupAttachments.createdAt,
				updatedAt: taxRuleGroupAttachments.updatedAt,
				exclusionReason: taxCorporationExclusions.reason,
			})
			.from(taxRuleGroupAttachments)
			.leftJoin(
				taxCorporationExclusions,
				eq(taxCorporationExclusions.corporationId, taxRuleGroupAttachments.corporationId)
			)
			.where(eq(taxRuleGroupAttachments.ruleGroupId, ruleGroupId))
			.orderBy(asc(taxRuleGroupAttachments.createdAt), asc(taxRuleGroupAttachments.corporationId))
		return rows.map((row) =>
			this.toRuleGroupAttachment(
				{
					id: row.id,
					ruleGroupId: row.ruleGroupId,
					corporationId: row.corporationId,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				},
				row.exclusionReason
			)
		)
	}

	async attachCorporation(
		ruleGroupId: string,
		corporationId: string
	): Promise<TaxRuleGroupAttachment> {
		const [attached] = await this.db
			.insert(taxRuleGroupAttachments)
			.values({
				ruleGroupId,
				corporationId,
			})
			.onConflictDoNothing()
			.returning()
		if (attached) {
			return this.toRuleGroupAttachment(attached)
		}

		const existing = await this.db.query.taxRuleGroupAttachments.findFirst({
			where: and(
				eq(taxRuleGroupAttachments.ruleGroupId, ruleGroupId),
				eq(taxRuleGroupAttachments.corporationId, corporationId)
			),
		})
		if (!existing) {
			throw new Error('Failed to attach corporation to rule group')
		}
		return this.toRuleGroupAttachment(existing)
	}

	async detachCorporation(ruleGroupId: string, corporationId: string): Promise<void> {
		await this.db
			.delete(taxRuleGroupAttachments)
			.where(
				and(
					eq(taxRuleGroupAttachments.ruleGroupId, ruleGroupId),
					eq(taxRuleGroupAttachments.corporationId, corporationId)
				)
			)
	}

	private toRuleGroup(row: typeof taxRuleGroups.$inferSelect): TaxRuleGroup {
		return {
			id: row.id,
			name: row.name,
			description: row.description,
			isDefaultGlobal: row.isDefaultGlobal,
			isSystem: row.isSystem,
			createdBy: row.createdBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private toRuleGroupAttachment(
		row: typeof taxRuleGroupAttachments.$inferSelect,
		exclusionReason: string | null = null
	): TaxRuleGroupAttachment {
		return {
			id: row.id,
			ruleGroupId: row.ruleGroupId,
			corporationId: row.corporationId,
			isExcluded: exclusionReason !== null,
			exclusionReason,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
