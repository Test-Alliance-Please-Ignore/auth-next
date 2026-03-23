import { getStub } from '@repo/do-utils'

import type {
	CreateTaxRuleGroupInput,
	CreateTaxRuleSetInput,
	ListTaxAuditLogFilters,
	ListTaxCorporationExclusionsFilters,
	ListTaxRuleGroupsFilters,
	ListTaxRuleSetsFilters,
	TaxAuditLogEntry,
	TaxCorporationExclusion,
	TaxPagedResult,
	TaxRuleGroup,
	TaxRuleGroupAttachment,
	TaxRuleSet,
	UpdateTaxRuleGroupInput,
	UpdateTaxRuleSetInput,
	UpsertTaxCorporationExclusionInput,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { Env } from '../context'
import type { TaxAuditService } from '../services/tax-audit.service'
import type { TaxCorporationExclusionsService } from '../services/tax-corporation-exclusions.service'
import type { TaxRuleGroupService } from '../services/tax-rule-groups.service'
import type { TaxRulesService } from '../services/tax-rules.service'

type RulesRpcContext = {
	env: Env
	exclusionsService: TaxCorporationExclusionsService
	auditService: TaxAuditService
	ruleGroupService: TaxRuleGroupService
	rulesService: TaxRulesService
	getCorporationIdsForRuleGroup: (ruleGroupId: string) => Promise<string[]>
	touchRuleMembershipMutation: (corporationId: string) => Promise<void>
	toAuditPayload: (value: unknown) => Record<string, unknown> | null
}

export class TaxRulesRpc {
	constructor(private readonly ctx: RulesRpcContext) {}

	async upsertCorporationExclusion(
		actorUserId: string,
		corporationId: string,
		input: UpsertTaxCorporationExclusionInput
	): Promise<TaxCorporationExclusion> {
		const before = await this.ctx.exclusionsService.getExclusion(corporationId)
		const after = await this.ctx.exclusionsService.upsertExclusion(
			actorUserId,
			corporationId,
			input
		)

		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: before ? 'tax.exclusion.updated' : 'tax.exclusion.created',
			before: this.ctx.toAuditPayload(before),
			after: this.ctx.toAuditPayload(after),
		})
		return after
	}

	async deleteCorporationExclusion(actorUserId: string, corporationId: string): Promise<void> {
		const before = await this.ctx.exclusionsService.getExclusion(corporationId)
		await this.ctx.exclusionsService.deleteExclusion(corporationId)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.exclusion.deleted',
			before: this.ctx.toAuditPayload(before),
			after: null,
		})
	}

	async listCorporationExclusions(
		filters?: ListTaxCorporationExclusionsFilters
	): Promise<TaxCorporationExclusion[]> {
		return this.ctx.exclusionsService.listExclusions(filters)
	}

	async listWalletDivisions(corporationId: string): Promise<number[]> {
		try {
			const stub = getStub<EveCorporationData>(this.ctx.env.EVE_CORPORATION_DATA, corporationId)
			return await stub.getWalletDivisions(corporationId)
		} catch (_error) {
			return []
		}
	}

	async listAuditLog(filters?: ListTaxAuditLogFilters): Promise<TaxPagedResult<TaxAuditLogEntry>> {
		return this.ctx.auditService.listAuditLog(filters)
	}

	async createRuleGroup(
		actorUserId: string,
		input: CreateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		await this.ctx.ruleGroupService.ensureDefaultGlobalGroup(actorUserId)
		const created = await this.ctx.ruleGroupService.createRuleGroup(actorUserId, input)
		await this.ctx.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.rule-group.created',
			before: null,
			after: this.ctx.toAuditPayload(created),
		})
		return created
	}

	async updateRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		input: UpdateTaxRuleGroupInput
	): Promise<TaxRuleGroup> {
		const updated = await this.ctx.ruleGroupService.updateRuleGroup(ruleGroupId, input)
		await this.ctx.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.rule-group.updated',
			before: null,
			after: this.ctx.toAuditPayload(updated),
		})
		return updated
	}

	async deleteRuleGroup(actorUserId: string, ruleGroupId: string): Promise<void> {
		await this.ctx.ruleGroupService.deleteRuleGroup(ruleGroupId)
		await this.ctx.auditService.logAction({
			corporationId: undefined,
			actorUserId,
			action: 'tax.rule-group.deleted',
			before: { ruleGroupId },
			after: null,
		})
	}

	async listRuleGroups(filters?: ListTaxRuleGroupsFilters): Promise<TaxRuleGroup[]> {
		await this.ctx.ruleGroupService.ensureDefaultGlobalGroup('system:tax:rule-groups')
		return this.ctx.ruleGroupService.listRuleGroups(filters)
	}

	async attachCorporationToRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<TaxRuleGroupAttachment> {
		const attached = await this.ctx.ruleGroupService.attachCorporation(ruleGroupId, corporationId)
		await this.ctx.touchRuleMembershipMutation(corporationId)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.rule-group.corporation.attached',
			before: null,
			after: this.ctx.toAuditPayload(attached),
		})
		return attached
	}

	async detachCorporationFromRuleGroup(
		actorUserId: string,
		ruleGroupId: string,
		corporationId: string
	): Promise<void> {
		await this.ctx.ruleGroupService.detachCorporation(ruleGroupId, corporationId)
		await this.ctx.touchRuleMembershipMutation(corporationId)
		await this.ctx.auditService.logAction({
			corporationId,
			actorUserId,
			action: 'tax.rule-group.corporation.detached',
			before: { ruleGroupId, corporationId },
			after: null,
		})
	}

	async listRuleGroupAttachments(ruleGroupId: string): Promise<TaxRuleGroupAttachment[]> {
		return this.ctx.ruleGroupService.listRuleGroupAttachments(ruleGroupId)
	}

	async createRuleSet(actorUserId: string, input: CreateTaxRuleSetInput): Promise<TaxRuleSet> {
		const created = await this.ctx.rulesService.createRuleSet(actorUserId, input)
		const affectedCorporationIds = await this.ctx.getCorporationIdsForRuleGroup(created.ruleGroupId)

		await this.ctx.auditService.logAction({
			corporationId: affectedCorporationIds[0] ?? undefined,
			actorUserId,
			action: 'tax.ruleset.created',
			before: null,
			after: {
				id: created.id,
				ruleGroupId: created.ruleGroupId,
				name: created.name,
				priority: created.priority,
				isActive: created.isActive,
				appliesToRefType: created.appliesToRefType,
				taxRateBps: created.taxRateBps,
			},
		})

		return created
	}

	async listRuleSets(filters?: ListTaxRuleSetsFilters): Promise<TaxRuleSet[]> {
		return this.ctx.rulesService.listRuleSets(filters)
	}

	async updateRuleSet(
		actorUserId: string,
		ruleSetId: string,
		input: UpdateTaxRuleSetInput
	): Promise<TaxRuleSet> {
		const updated = await this.ctx.rulesService.updateRuleSet(ruleSetId, input)
		const affectedCorporationIds = await this.ctx.getCorporationIdsForRuleGroup(updated.ruleGroupId)
		await this.ctx.auditService.logAction({
			corporationId: affectedCorporationIds[0] ?? undefined,
			actorUserId,
			action: 'tax.ruleset.updated',
			before: { ruleSetId },
			after: {
				id: updated.id,
				ruleGroupId: updated.ruleGroupId,
				name: updated.name,
				priority: updated.priority,
				isActive: updated.isActive,
			},
		})
		return updated
	}

	async deleteRuleSet(actorUserId: string, ruleSetId: string): Promise<void> {
		const existing = await this.ctx.rulesService.getRuleSetById(ruleSetId)
		if (!existing) {
			throw new Error('Rule set not found')
		}
		const affectedCorporationIds = await this.ctx.getCorporationIdsForRuleGroup(
			existing.ruleGroupId
		)
		await this.ctx.rulesService.deleteRuleSet(ruleSetId)
		await this.ctx.auditService.logAction({
			corporationId: affectedCorporationIds[0] ?? undefined,
			actorUserId,
			action: 'tax.ruleset.deleted',
			before: {
				id: existing.id,
				ruleGroupId: existing.ruleGroupId,
				name: existing.name,
			},
			after: null,
		})
	}
}
