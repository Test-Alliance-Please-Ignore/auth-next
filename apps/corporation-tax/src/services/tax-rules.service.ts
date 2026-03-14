import { and, desc, eq, isNull, or } from '@repo/db-utils'

import { taxRuleActions, taxRuleConditions, taxRuleSets } from '../db/schema'

import type {
	CreateTaxRuleSetInput,
	ListTaxRuleSetsFilters,
	TaxRuleSet,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'

export class TaxRulesService {
	constructor(private db: CorporationTaxDb) {}

	async createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet> {
		if (!input.name.trim()) {
			throw new Error('Rule set name is required')
		}
		if (!input.actions || input.actions.length === 0) {
			throw new Error('At least one rule action is required')
		}

		for (const action of input.actions) {
			if (!Number.isInteger(action.taxRateBps) || action.taxRateBps < 0 || action.taxRateBps > 10_000) {
				throw new Error('Rule action taxRateBps must be an integer between 0 and 10000')
			}
			if (!action.label.trim()) {
				throw new Error('Rule action label is required')
			}
		}

		const now = new Date()

		const created = await this.db.transaction(async (tx) => {
			const [ruleSet] = await tx
				.insert(taxRuleSets)
				.values({
					corporationId: input.corporationId ?? null,
					name: input.name.trim(),
					priority: input.priority ?? 0,
					isActive: input.isActive ?? true,
					effectiveFrom: input.effectiveFrom ?? now,
					effectiveTo: input.effectiveTo ?? null,
					createdBy: actorUserId,
				})
				.returning()

			if (!ruleSet) {
				throw new Error('Failed to create rule set')
			}

			if (input.conditions.length > 0) {
				await tx.insert(taxRuleConditions).values(
					input.conditions.map((condition) => ({
						ruleSetId: ruleSet.id,
						appliesToRefType: condition.appliesToRefType ?? null,
						walletDivision: condition.walletDivision ?? null,
						partyType: condition.partyType ?? null,
						minAmount: condition.minAmount ?? null,
						maxAmount: condition.maxAmount ?? null,
						isEssOnly: condition.isEssOnly ?? false,
						essBankType: condition.essBankType ?? null,
					}))
				)
			}

			await tx.insert(taxRuleActions).values(
				input.actions.map((action) => ({
					ruleSetId: ruleSet.id,
					taxRateBps: action.taxRateBps,
					isTaxable: action.isTaxable ?? true,
					label: action.label.trim(),
				}))
			)

			return ruleSet.id
		})

		const ruleSet = await this.getRuleSetById(created)
		if (!ruleSet) {
			throw new Error('Failed to load created rule set')
		}

		return ruleSet
	}

	async listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]> {
		const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200)
		const offset = Math.max(filters?.offset ?? 0, 0)
		const includeGlobal = filters?.includeGlobal ?? true

		const whereConditions = []
		if (filters?.onlyActive !== undefined) {
			whereConditions.push(eq(taxRuleSets.isActive, filters.onlyActive))
		}

		if (filters?.corporationId) {
			if (includeGlobal) {
				whereConditions.push(
					or(
						eq(taxRuleSets.corporationId, filters.corporationId),
						isNull(taxRuleSets.corporationId)
					)
				)
			} else {
				whereConditions.push(eq(taxRuleSets.corporationId, filters.corporationId))
			}
		}

		const rows = await this.db.query.taxRuleSets.findMany({
			where: whereConditions.length ? and(...whereConditions) : undefined,
			orderBy: [desc(taxRuleSets.priority), desc(taxRuleSets.createdAt)],
			limit,
			offset,
			with: {
				conditions: true,
				actions: true,
			},
		})

		return rows.map((row) => this.toRuleSet(row))
	}

	async getRuleSetById(ruleSetId: string): Promise<TaxRuleSet | null> {
		const row = await this.db.query.taxRuleSets.findFirst({
			where: eq(taxRuleSets.id, ruleSetId),
			with: {
				conditions: true,
				actions: true,
			},
		})

		return row ? this.toRuleSet(row) : null
	}

	private toRuleSet(
		row: typeof taxRuleSets.$inferSelect & {
			conditions: Array<typeof taxRuleConditions.$inferSelect>
			actions: Array<typeof taxRuleActions.$inferSelect>
		}
	): TaxRuleSet {
		return {
			id: row.id,
			corporationId: row.corporationId,
			name: row.name,
			priority: row.priority,
			isActive: row.isActive,
			effectiveFrom: row.effectiveFrom,
			effectiveTo: row.effectiveTo,
			createdBy: row.createdBy,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			conditions: row.conditions.map((condition) => ({
				id: condition.id,
				ruleSetId: condition.ruleSetId,
				appliesToRefType: condition.appliesToRefType,
				walletDivision: condition.walletDivision,
				partyType: condition.partyType,
				minAmount: condition.minAmount,
				maxAmount: condition.maxAmount,
				isEssOnly: condition.isEssOnly,
				essBankType: condition.essBankType,
				createdAt: condition.createdAt,
				updatedAt: condition.updatedAt,
			})),
			actions: row.actions.map((action) => ({
				id: action.id,
				ruleSetId: action.ruleSetId,
				taxRateBps: action.taxRateBps,
				isTaxable: action.isTaxable,
				label: action.label,
				createdAt: action.createdAt,
				updatedAt: action.updatedAt,
			})),
		}
	}
}
