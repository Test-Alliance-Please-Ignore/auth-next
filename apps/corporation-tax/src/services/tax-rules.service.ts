import { isTaxIncomeRefType } from '@repo/corporation-tax'
import { and, asc, desc, eq, gte, inArray } from '@repo/db-utils'

import { taxRuleGroupAttachments, taxRuleGroups, taxRuleSets } from '../db/schema'

import type {
	CreateTaxRuleSetInput,
	ListTaxRuleSetsFilters,
	TaxRuleSet,
	UpdateTaxRuleSetInput,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

const RULE_PRIORITY_MIN = 0
const RULE_PRIORITY_MAX = 100

export class TaxRulesService {
	constructor(private db: CorporationTaxDb) {}

	async createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet> {
		if (!input.name.trim()) {
			throw new Error('Rule set name is required')
		}
		if (input.priority !== undefined) {
			if (
				!Number.isInteger(input.priority) ||
				input.priority < RULE_PRIORITY_MIN ||
				input.priority > RULE_PRIORITY_MAX
			) {
				throw new Error(
					`Rule priority must be an integer between ${RULE_PRIORITY_MIN} and ${RULE_PRIORITY_MAX}`
				)
			}
		}
		if (!Number.isInteger(input.taxRateBps) || input.taxRateBps < 0 || input.taxRateBps > 10_000) {
			throw new Error('Rule action taxRateBps must be an integer between 0 and 10000')
		}
		if (input.appliesToRefType && !isTaxIncomeRefType(input.appliesToRefType)) {
			throw new Error('Rule appliesToRefType must be a valid tax income ref type')
		}

		const ruleGroup = await this.db.query.taxRuleGroups.findFirst({
			where: eq(taxRuleGroups.id, input.ruleGroupId),
		})
		if (!ruleGroup) {
			throw new Error('Rule group not found')
		}

		const [ruleSet] = await this.db
			.insert(taxRuleSets)
			.values({
				ruleGroupId: input.ruleGroupId,
				name: input.name.trim(),
				priority: input.priority ?? 0,
				isActive: input.isActive ?? true,
				appliesToRefType: input.appliesToRefType ?? null,
				taxRateBps: input.taxRateBps,
				createdBy: actorUserId,
			})
			.returning({ id: taxRuleSets.id })
		if (!ruleSet) {
			throw new Error('Failed to create rule set')
		}

		const created = await this.getRuleSetById(ruleSet.id)
		if (!created) {
			throw new Error('Failed to load created rule set')
		}
		return created
	}

	async updateRuleSet(ruleSetId: string, input: UpdateTaxRuleSetInput): Promise<TaxRuleSet> {
		const updates: Partial<typeof taxRuleSets.$inferInsert> = {
			updatedAt: new Date(),
		}
		if (input.name !== undefined) {
			const name = input.name.trim()
			if (!name) {
				throw new Error('Rule set name is required')
			}
			updates.name = name
		}
		if (input.priority !== undefined) {
			if (
				!Number.isInteger(input.priority) ||
				input.priority < RULE_PRIORITY_MIN ||
				input.priority > RULE_PRIORITY_MAX
			) {
				throw new Error(
					`Rule priority must be an integer between ${RULE_PRIORITY_MIN} and ${RULE_PRIORITY_MAX}`
				)
			}
			updates.priority = input.priority
		}
		if (input.isActive !== undefined) {
			updates.isActive = input.isActive
		}
		if (input.appliesToRefType !== undefined) {
			if (input.appliesToRefType && !isTaxIncomeRefType(input.appliesToRefType)) {
				throw new Error('Rule appliesToRefType must be a valid tax income ref type')
			}
			updates.appliesToRefType = input.appliesToRefType
		}
		if (input.taxRateBps !== undefined) {
			if (
				!Number.isInteger(input.taxRateBps) ||
				input.taxRateBps < 0 ||
				input.taxRateBps > 10_000
			) {
				throw new Error('Rule action taxRateBps must be an integer between 0 and 10000')
			}
			updates.taxRateBps = input.taxRateBps
		}

		const [updated] = await this.db
			.update(taxRuleSets)
			.set(updates)
			.where(eq(taxRuleSets.id, ruleSetId))
			.returning({ id: taxRuleSets.id })
		if (!updated) {
			throw new Error('Rule set not found')
		}

		const ruleSet = await this.getRuleSetById(ruleSetId)
		if (!ruleSet) {
			throw new Error('Rule set not found')
		}
		return ruleSet
	}

	async deleteRuleSet(ruleSetId: string): Promise<void> {
		const [deleted] = await this.db
			.delete(taxRuleSets)
			.where(eq(taxRuleSets.id, ruleSetId))
			.returning({ id: taxRuleSets.id })
		if (!deleted) {
			throw new Error('Rule set not found')
		}
	}

	async listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]> {
		const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200)
		const offset = Math.max(filters?.offset ?? 0, 0)
		const whereConditions = [] as any[]
		if (filters?.onlyActive !== undefined) {
			whereConditions.push(eq(taxRuleSets.isActive, filters.onlyActive))
		}
		if (filters?.ruleGroupId) {
			whereConditions.push(eq(taxRuleSets.ruleGroupId, filters.ruleGroupId))
		} else if (filters?.corporationId) {
			const attachmentRows = await this.db
				.select({ ruleGroupId: taxRuleGroupAttachments.ruleGroupId })
				.from(taxRuleGroupAttachments)
				.where(eq(taxRuleGroupAttachments.corporationId, filters.corporationId))
			const attachedGroupIds = attachmentRows.map((row) => row.ruleGroupId)
			if (attachedGroupIds.length === 0) {
				return []
			}
			whereConditions.push(inArray(taxRuleSets.ruleGroupId, attachedGroupIds))
		}

		const rows = await this.db.query.taxRuleSets.findMany({
			where: whereConditions.length ? and(...whereConditions) : undefined,
			orderBy: [desc(taxRuleSets.priority), desc(taxRuleSets.createdAt)],
			limit,
			offset,
		})

		return rows.map((row) => this.toRuleSet(row))
	}

	async getCorporationRuleGroupIds(corporationId: string): Promise<string[]> {
		const rows = await this.db
			.select({ ruleGroupId: taxRuleGroupAttachments.ruleGroupId })
			.from(taxRuleGroupAttachments)
			.where(eq(taxRuleGroupAttachments.corporationId, corporationId))
			.orderBy(asc(taxRuleGroupAttachments.ruleGroupId))
		return rows.map((row) => row.ruleGroupId)
	}

	async getEarliestRuleSetMutationAfter(corporationId: string, since: Date): Promise<Date | null> {
		const groupIds = await this.getCorporationRuleGroupIds(corporationId)
		if (groupIds.length === 0) {
			return null
		}
		const earliestRule = await this.db.query.taxRuleSets.findFirst({
			where: and(inArray(taxRuleSets.ruleGroupId, groupIds), gte(taxRuleSets.updatedAt, since)),
			orderBy: [asc(taxRuleSets.updatedAt)],
			columns: { updatedAt: true },
		})
		return earliestRule?.updatedAt ?? null
	}

	async getRuleSetById(ruleSetId: string): Promise<TaxRuleSet | null> {
		const row = await this.db.query.taxRuleSets.findFirst({
			where: eq(taxRuleSets.id, ruleSetId),
		})

		return row ? this.toRuleSet(row) : null
	}

	private toRuleSet(row: typeof taxRuleSets.$inferSelect): TaxRuleSet {
		return {
			id: row.id,
			ruleGroupId: row.ruleGroupId,
			name: row.name,
			priority: row.priority,
			isActive: row.isActive,
			appliesToRefType: row.appliesToRefType,
			taxRateBps: row.taxRateBps,
			createdBy: row.createdBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}
}
