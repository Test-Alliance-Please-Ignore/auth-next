import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'

import {
	taxAssessmentLines,
	taxAssessments,
	taxCorporationExclusions,
	taxDiscrepancies,
	taxLedgerEntries,
	taxMemberContributionFinalizedRollups,
	taxMemberContributionProjectionRollups,
	taxMemberSummaryVersions,
	taxPeriods,
	taxRuleGroupAttachments,
	taxRuleSets,
} from '../db/schema'

import type {
	ListTaxAssessmentLinesFilters,
	ListTaxAssessmentsFilters,
	ListTaxDiscrepanciesFilters,
	RunTaxAssessmentForPeriodInput,
	RunTaxAssessmentForPeriodResult,
	TaxAssessment,
	TaxAssessmentLine,
	TaxAssessmentScope,
	TaxAssessmentStatus,
	TaxDiscrepancy,
	TaxDivisionAssessmentSummary,
	TaxPeriod,
	TaxPeriodStatus,
	TaxRefTypeAssessmentSummary,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { CorporationTaxDb } from '../db'

type RuleCondition = {
	appliesToRefType: string | null
	partyType: string | null
}

type CompiledRule = {
	ruleSetId: string
	label: string
	taxRateBps: number
	condition: RuleCondition
}

type MutableSummary = {
	taxableIncomeCenti: bigint
	nonTaxableIncomeCenti: bigint
	taxDueCenti: bigint
	taxPaidCenti: bigint
}

type PendingAssessmentLine = Omit<typeof taxAssessmentLines.$inferInsert, 'assessmentId'>

type ScopedAssessmentComputation = {
	assessmentScope: 'corporation' | 'division' | 'character'
	scopeId: string
	totals: MutableSummary
	inGameTaxRateBps: number | null
	portalTaxRateBps: number
	lines: PendingAssessmentLine[]
}

type AssessmentWriteDb = Pick<CorporationTaxDb, 'insert' | 'update' | 'delete' | 'query'>

export class TaxAssessmentService {
	private readonly TAX_DELTA_DISCREPANCY_THRESHOLD_BPS = 500

	constructor(
		private db: CorporationTaxDb,
		private eveCorporationDataNamespace: DurableObjectNamespace
	) {}

	async listAssessments(filters?: ListTaxAssessmentsFilters): Promise<TaxAssessment[]> {
		const conditions = []

		if (filters?.corporationId) {
			conditions.push(eq(taxAssessments.corporationId, filters.corporationId))
		}
		if (filters?.status) {
			conditions.push(eq(taxAssessments.status, filters.status))
		}
		if (filters?.assessmentScope) {
			conditions.push(eq(taxAssessments.assessmentScope, filters.assessmentScope))
		}
		if (filters?.withBillOnly) {
			conditions.push(isNotNull(taxAssessments.billId))
		}
		if (filters?.periodStart) {
			conditions.push(gte(taxAssessments.taxPeriodStart, filters.periodStart))
		}
		if (filters?.periodEnd) {
			conditions.push(lte(taxAssessments.taxPeriodEnd, filters.periodEnd))
		}

		const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200)
		const offset = Math.max(filters?.offset ?? 0, 0)

		const rows = await this.db.query.taxAssessments.findMany({
			where: conditions.length ? and(...conditions) : undefined,
			orderBy: [desc(taxAssessments.taxPeriodEnd), desc(taxAssessments.createdAt)],
			limit,
			offset,
		})

		return rows.map((row) => this.toAssessment(row))
	}

	async getAssessmentById(assessmentId: string): Promise<TaxAssessment | null> {
		const row = await this.db.query.taxAssessments.findFirst({
			where: eq(taxAssessments.id, assessmentId),
		})
		return row ? this.toAssessment(row) : null
	}

	async runAssessmentForPeriod(
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		if (input.periodStart >= input.periodEnd) {
			throw new Error('periodStart must be before periodEnd')
		}

		const exclusion = await this.db.query.taxCorporationExclusions.findFirst({
			where: eq(taxCorporationExclusions.corporationId, input.corporationId),
			columns: { corporationId: true },
		})
		const isExcluded = Boolean(exclusion)

		// Static override: assessments are currently corporation-wallet only.
		// Re-enable character wallet contribution by restoring input-driven source selection.
		const assessmentSourceTypes = [
			'corporation_wallet_journal',
			'corporation_wallet_transaction',
		] as const

		const ledgerWhere = and(
			eq(taxLedgerEntries.corporationId, input.corporationId),
			inArray(taxLedgerEntries.sourceType, assessmentSourceTypes),
			gte(taxLedgerEntries.entryDate, input.periodStart),
			lte(taxLedgerEntries.entryDate, input.periodEnd)
		)

		const attachedRuleGroups = await this.db.query.taxRuleGroupAttachments.findMany({
			where: eq(taxRuleGroupAttachments.corporationId, input.corporationId),
			columns: {
				ruleGroupId: true,
			},
			limit: 500,
		})
		const attachedRuleGroupIds = attachedRuleGroups.map((row) => row.ruleGroupId)
		const activeRuleSets =
			attachedRuleGroupIds.length === 0
				? []
				: await this.db.query.taxRuleSets.findMany({
						where: and(
							inArray(taxRuleSets.ruleGroupId, attachedRuleGroupIds),
							eq(taxRuleSets.isActive, true),
							lte(taxRuleSets.effectiveFrom, input.periodEnd),
							or(isNull(taxRuleSets.effectiveTo), gte(taxRuleSets.effectiveTo, input.periodStart))
						),
						orderBy: [desc(taxRuleSets.priority), desc(taxRuleSets.createdAt)],
					})

		const compiledRules = activeRuleSets.map((ruleSet) => ({
			ruleSetId: ruleSet.id,
			label: ruleSet.label,
			taxRateBps: ruleSet.taxRateBps,
			condition: {
				appliesToRefType: ruleSet.appliesToRefType,
				partyType: ruleSet.partyType,
			},
		}))

		const memberIdSet = await this.getCorporationMemberIdSet(input.corporationId)
		const unattributedKey = '__unattributed__'
		const memberRollupMap = new Map<
			string,
			{
				rollupDate: Date
				characterId: string
				refType: string
				contributionIncomeCenti: bigint
				taxableContributionIncomeCenti: bigint
				sourceRowCount: number
				lastLedgerEntryDate: Date | null
			}
		>()

		const corporationTotals: MutableSummary = {
			taxableIncomeCenti: 0n,
			nonTaxableIncomeCenti: 0n,
			taxDueCenti: 0n,
			taxPaidCenti: 0n,
		}
		const corporationLines: PendingAssessmentLine[] = []
		const divisionAssessments = new Map<string, ScopedAssessmentComputation>()
		const characterAssessments = new Map<string, ScopedAssessmentComputation>()
		const divisionSummaries = new Map<string, MutableSummary & { division: number | null }>()
		const refTypeSummaries = new Map<string, MutableSummary & { refType: string }>()

		const ledgerPageSize = 5_000
		let ledgerOffset = 0
		for (;;) {
			const ledgerRows = await this.db.query.taxLedgerEntries.findMany({
				where: ledgerWhere,
				orderBy: [desc(taxLedgerEntries.entryDate), desc(taxLedgerEntries.id)],
				limit: ledgerPageSize,
				offset: ledgerOffset,
			})
			if (ledgerRows.length === 0) {
				break
			}
			for (const row of ledgerRows) {
				const amountCenti = this.parseDecimalToCenti(row.amount)
				const amountForTaxCenti = amountCenti > 0n ? amountCenti : 0n
				if (amountForTaxCenti === 0n) {
					continue
				}

				const resolved = this.resolveRuleForEntry({
					entry: row,
					amountCenti: amountForTaxCenti,
					compiledRules,
				})
				const lineValue: PendingAssessmentLine = {
					ledgerEntryId: row.id,
					appliedRuleSetId: resolved.appliedRuleSetId,
					taxRateBps: resolved.taxRateBps,
					taxableAmount: this.formatCenti(resolved.taxableAmountCenti),
					taxAmount: this.formatCenti(resolved.taxAmountCenti),
					classification: resolved.classification,
				}
				const paidAmountCenti = this.extractTaxPaidFromPayload(row.rawPayload)

				corporationTotals.taxableIncomeCenti += resolved.taxableAmountCenti
				corporationTotals.nonTaxableIncomeCenti += amountForTaxCenti - resolved.taxableAmountCenti
				corporationTotals.taxDueCenti += resolved.taxAmountCenti
				corporationTotals.taxPaidCenti += paidAmountCenti
				corporationLines.push(lineValue)

				const divisionKey = row.division === null ? 'null' : `${row.division}`
				const divisionSummary = divisionSummaries.get(divisionKey) ?? {
					division: row.division,
					taxableIncomeCenti: 0n,
					nonTaxableIncomeCenti: 0n,
					taxDueCenti: 0n,
					taxPaidCenti: 0n,
				}
				divisionSummary.taxableIncomeCenti += resolved.taxableAmountCenti
				divisionSummary.nonTaxableIncomeCenti += amountForTaxCenti - resolved.taxableAmountCenti
				divisionSummary.taxDueCenti += resolved.taxAmountCenti
				divisionSummary.taxPaidCenti += paidAmountCenti
				divisionSummaries.set(divisionKey, divisionSummary)

				const refTypeKey = row.refType
				const refTypeSummary = refTypeSummaries.get(refTypeKey) ?? {
					refType: row.refType,
					taxableIncomeCenti: 0n,
					nonTaxableIncomeCenti: 0n,
					taxDueCenti: 0n,
					taxPaidCenti: 0n,
				}
				refTypeSummary.taxableIncomeCenti += resolved.taxableAmountCenti
				refTypeSummary.nonTaxableIncomeCenti += amountForTaxCenti - resolved.taxableAmountCenti
				refTypeSummary.taxDueCenti += resolved.taxAmountCenti
				refTypeSummary.taxPaidCenti += paidAmountCenti
				refTypeSummaries.set(refTypeKey, refTypeSummary)

				if (
					row.sourceType === 'corporation_wallet_journal' ||
					row.sourceType === 'corporation_wallet_transaction'
				) {
					const memberCandidateIds = [row.firstPartyId, row.secondPartyId].filter(
						(value): value is string => Boolean(value)
					)
					const attributedCharacterId =
						memberCandidateIds.find((characterId) => memberIdSet.has(characterId)) ??
						unattributedKey
					const rollupDate = this.toUtcDay(row.entryDate)
					const rollupKey = [
						rollupDate.toISOString().slice(0, 10),
						attributedCharacterId,
						row.refType,
					].join(':')
					const current = memberRollupMap.get(rollupKey) ?? {
						rollupDate,
						characterId: attributedCharacterId,
						refType: row.refType,
						contributionIncomeCenti: 0n,
						taxableContributionIncomeCenti: 0n,
						sourceRowCount: 0,
						lastLedgerEntryDate: null,
					}
					current.contributionIncomeCenti += amountForTaxCenti
					current.taxableContributionIncomeCenti += resolved.taxableAmountCenti
					current.sourceRowCount += 1
					current.lastLedgerEntryDate =
						!current.lastLedgerEntryDate || row.entryDate > current.lastLedgerEntryDate
							? row.entryDate
							: current.lastLedgerEntryDate
					memberRollupMap.set(rollupKey, current)
				}

				if (row.division !== null) {
					const scoped = divisionAssessments.get(divisionKey) ?? {
						assessmentScope: 'division',
						scopeId: divisionKey,
						totals: {
							taxableIncomeCenti: 0n,
							nonTaxableIncomeCenti: 0n,
							taxDueCenti: 0n,
							taxPaidCenti: 0n,
						},
						inGameTaxRateBps: null,
						portalTaxRateBps: 0,
						lines: [],
					}
					scoped.totals.taxableIncomeCenti += resolved.taxableAmountCenti
					scoped.totals.nonTaxableIncomeCenti += amountForTaxCenti - resolved.taxableAmountCenti
					scoped.totals.taxDueCenti += resolved.taxAmountCenti
					scoped.totals.taxPaidCenti += paidAmountCenti
					scoped.lines.push(lineValue)
					divisionAssessments.set(divisionKey, scoped)
				}

				const characterId = this.extractCharacterId(row)
				if (characterId) {
					const scoped = characterAssessments.get(characterId) ?? {
						assessmentScope: 'character',
						scopeId: characterId,
						totals: {
							taxableIncomeCenti: 0n,
							nonTaxableIncomeCenti: 0n,
							taxDueCenti: 0n,
							taxPaidCenti: 0n,
						},
						inGameTaxRateBps: null,
						portalTaxRateBps: 0,
						lines: [],
					}
					scoped.totals.taxableIncomeCenti += resolved.taxableAmountCenti
					scoped.totals.nonTaxableIncomeCenti += amountForTaxCenti - resolved.taxableAmountCenti
					scoped.totals.taxDueCenti += resolved.taxAmountCenti
					scoped.totals.taxPaidCenti += paidAmountCenti
					scoped.lines.push(lineValue)
					characterAssessments.set(characterId, scoped)
				}
			}
			if (ledgerRows.length < ledgerPageSize) {
				break
			}
			ledgerOffset += ledgerRows.length
		}

		const inGameTaxRateBps = await this.getInGameTaxRateBps(input.corporationId)
		const portalTaxRateBps = 0
		const taxDeltaCenti = corporationTotals.taxDueCenti - corporationTotals.taxPaidCenti
		const taxDeltaThresholdBps = this.TAX_DELTA_DISCREPANCY_THRESHOLD_BPS

		const discrepancyValues: Array<Omit<typeof taxDiscrepancies.$inferInsert, 'assessmentId'>> = []

		const taxDeltaAbsoluteCenti = taxDeltaCenti < 0n ? -taxDeltaCenti : taxDeltaCenti
		let taxDeltaDiscrepancyBps: number | null = null
		if (corporationTotals.taxDueCenti > 0n) {
			taxDeltaDiscrepancyBps = Number(
				(taxDeltaAbsoluteCenti * 10_000n) / corporationTotals.taxDueCenti
			)
		} else if (taxDeltaAbsoluteCenti > 0n) {
			taxDeltaDiscrepancyBps = 10_000
		}
		if (taxDeltaDiscrepancyBps !== null && taxDeltaDiscrepancyBps > taxDeltaThresholdBps) {
			discrepancyValues.push({
				corporationId: input.corporationId,
				discrepancyType: 'tax_delta_threshold_exceeded',
				severity: 'warning',
				details: {
					taxDue: this.formatCenti(corporationTotals.taxDueCenti),
					taxPaid: this.formatCenti(corporationTotals.taxPaidCenti),
					taxDelta: this.formatCenti(taxDeltaCenti),
					discrepancyBps: taxDeltaDiscrepancyBps,
					thresholdBps: taxDeltaThresholdBps,
				},
			})
		}

		const divisionSummaryOutput = Array.from(divisionSummaries.values())
			.sort((a, b) => (a.division ?? -1) - (b.division ?? -1))
			.map((item) => this.toDivisionSummary(item, !isExcluded))
		const refTypeSummaryOutput = Array.from(refTypeSummaries.values())
			.sort((a, b) => a.refType.localeCompare(b.refType))
			.map((item) => this.toRefTypeSummary(item, !isExcluded))
		const scopeComputations: ScopedAssessmentComputation[] = [
			{
				assessmentScope: 'corporation',
				scopeId: input.corporationId,
				totals: corporationTotals,
				inGameTaxRateBps,
				portalTaxRateBps,
				lines: corporationLines,
			},
			...Array.from(divisionAssessments.values()).sort(
				(a, b) => Number(a.scopeId) - Number(b.scopeId)
			),
			...Array.from(characterAssessments.values()).sort((a, b) =>
				a.scopeId.localeCompare(b.scopeId)
			),
		]

		const result = await this.withAssessmentWriteClient(async (tx) => {
			const now = new Date()

			const [period] = await tx
				.insert(taxPeriods)
				.values({
					corporationId: input.corporationId,
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					status: 'assessed',
					closedAt: now,
				})
				.onConflictDoUpdate({
					target: [taxPeriods.corporationId, taxPeriods.periodStart, taxPeriods.periodEnd],
					set: {
						status: 'assessed',
						closedAt: now,
						updatedAt: now,
					},
				})
				.returning()
			if (!period) {
				throw new Error('Failed to upsert tax period')
			}

			const existingAssessments = await tx.query.taxAssessments.findMany({
				where: and(
					eq(taxAssessments.corporationId, input.corporationId),
					eq(taxAssessments.taxPeriodStart, input.periodStart),
					eq(taxAssessments.taxPeriodEnd, input.periodEnd),
					inArray(taxAssessments.assessmentScope, ['corporation', 'division', 'character'])
				),
			})
			const existingByScopeKey = new Map(
				existingAssessments.map((assessment) => [
					`${assessment.assessmentScope}:${assessment.scopeId}`,
					assessment,
				])
			)
			const targetScopeKeys = new Set(
				scopeComputations.map((scope) => `${scope.assessmentScope}:${scope.scopeId}`)
			)
			const staleAssessmentIds = existingAssessments
				.filter(
					(assessment) =>
						!targetScopeKeys.has(`${assessment.assessmentScope}:${assessment.scopeId}`)
				)
				.map((assessment) => assessment.id)

			if (staleAssessmentIds.length > 0) {
				await tx
					.delete(taxDiscrepancies)
					.where(inArray(taxDiscrepancies.assessmentId, staleAssessmentIds))
				await tx
					.delete(taxAssessmentLines)
					.where(inArray(taxAssessmentLines.assessmentId, staleAssessmentIds))
				await tx.delete(taxAssessments).where(inArray(taxAssessments.id, staleAssessmentIds))
			}

			const persistedByScopeKey = new Map<string, typeof taxAssessments.$inferSelect>()
			for (const scope of scopeComputations) {
				const scopeKey = `${scope.assessmentScope}:${scope.scopeId}`
				const scopeTaxDeltaCenti = scope.totals.taxDueCenti - scope.totals.taxPaidCenti
				const scopeStatus = this.resolveAssessmentStatus(!isExcluded, scopeTaxDeltaCenti)
				const existing = existingByScopeKey.get(scopeKey)

				if (existing) {
					const [updated] = await tx
						.update(taxAssessments)
						.set({
							taxableIncome: this.formatCenti(scope.totals.taxableIncomeCenti),
							nonTaxableIncome: this.formatCenti(scope.totals.nonTaxableIncomeCenti),
							taxDue: this.formatCenti(scope.totals.taxDueCenti),
							taxPaid: this.formatCenti(scope.totals.taxPaidCenti),
							taxDelta: this.formatCenti(scopeTaxDeltaCenti),
							status: scopeStatus,
							inGameTaxRateBps: scope.inGameTaxRateBps,
							portalTaxRateBps: scope.portalTaxRateBps,
							updatedAt: now,
						})
						.where(eq(taxAssessments.id, existing.id))
						.returning()

					if (!updated) {
						throw new Error(`Failed to update ${scope.assessmentScope} assessment`)
					}
					persistedByScopeKey.set(scopeKey, updated)
					continue
				}

				const [createdAssessment] = await tx
					.insert(taxAssessments)
					.values({
						corporationId: input.corporationId,
						taxPeriodStart: input.periodStart,
						taxPeriodEnd: input.periodEnd,
						assessmentScope: scope.assessmentScope,
						scopeId: scope.scopeId,
						taxableIncome: this.formatCenti(scope.totals.taxableIncomeCenti),
						nonTaxableIncome: this.formatCenti(scope.totals.nonTaxableIncomeCenti),
						taxDue: this.formatCenti(scope.totals.taxDueCenti),
						taxPaid: this.formatCenti(scope.totals.taxPaidCenti),
						taxDelta: this.formatCenti(scopeTaxDeltaCenti),
						status: scopeStatus,
						inGameTaxRateBps: scope.inGameTaxRateBps,
						portalTaxRateBps: scope.portalTaxRateBps,
					})
					.returning()

				if (!createdAssessment) {
					throw new Error(`Failed to create ${scope.assessmentScope} assessment`)
				}
				persistedByScopeKey.set(scopeKey, createdAssessment)
			}

			const assessmentIds = Array.from(persistedByScopeKey.values()).map(
				(assessment) => assessment.id
			)
			if (assessmentIds.length > 0) {
				await tx
					.delete(taxAssessmentLines)
					.where(inArray(taxAssessmentLines.assessmentId, assessmentIds))
				await tx
					.delete(taxDiscrepancies)
					.where(inArray(taxDiscrepancies.assessmentId, assessmentIds))
			}

			const scopedLineValues: Array<typeof taxAssessmentLines.$inferInsert> = []
			for (const scope of scopeComputations) {
				if (scope.lines.length === 0) {
					continue
				}
				const persisted = persistedByScopeKey.get(`${scope.assessmentScope}:${scope.scopeId}`)
				if (!persisted) {
					throw new Error(`Missing persisted ${scope.assessmentScope} assessment`)
				}
				for (const line of scope.lines) {
					scopedLineValues.push({
						assessmentId: persisted.id,
						ledgerEntryId: line.ledgerEntryId,
						appliedRuleSetId: line.appliedRuleSetId,
						taxRateBps: line.taxRateBps,
						taxableAmount: line.taxableAmount,
						taxAmount: line.taxAmount,
						classification: line.classification,
					})
				}
			}

			if (scopedLineValues.length > 0) {
				await tx.insert(taxAssessmentLines).values(scopedLineValues)
			}

			if (discrepancyValues.length > 0) {
				const corporationAssessment = persistedByScopeKey.get(`corporation:${input.corporationId}`)
				if (!corporationAssessment) {
					throw new Error('Missing persisted corporation assessment')
				}
				await tx.insert(taxDiscrepancies).values(
					discrepancyValues.map((item) => ({
						...item,
						assessmentId: corporationAssessment.id,
					}))
				)
			}

			const corporationAssessment = persistedByScopeKey.get(`corporation:${input.corporationId}`)
			if (!corporationAssessment) {
				throw new Error('Failed to persist corporation assessment')
			}

			if (this.supportsMemberSummaryProjectionInfra()) {
				const nowMonthStart = this.startOfUtcMonth(now)
				const isClosedPeriod = input.periodEnd < nowMonthStart
				const memberRollupValues = Array.from(memberRollupMap.values()).map((item) => ({
					corporationId: input.corporationId,
					periodStart: input.periodStart,
					periodEnd: input.periodEnd,
					rollupDate: item.rollupDate,
					characterId: item.characterId,
					refType: item.refType,
					contributionIncome: this.formatCenti(item.contributionIncomeCenti),
					taxableContributionIncome: this.formatCenti(item.taxableContributionIncomeCenti),
					assessmentCount: 1,
					sourceRowCount: item.sourceRowCount,
					lastAssessmentAt: input.periodEnd,
					lastLedgerEntryDate: item.lastLedgerEntryDate,
					updatedAt: now,
				}))

				if (isClosedPeriod) {
					await tx
						.delete(taxMemberContributionProjectionRollups)
						.where(
							and(
								eq(taxMemberContributionProjectionRollups.corporationId, input.corporationId),
								eq(taxMemberContributionProjectionRollups.periodStart, input.periodStart),
								eq(taxMemberContributionProjectionRollups.periodEnd, input.periodEnd)
							)
						)
					await this.upsertAndReconcileFinalizedRollups(
						tx,
						input.corporationId,
						input.periodStart,
						input.periodEnd,
						memberRollupValues.map((row) => ({
							...row,
							finalizedAssessmentId: corporationAssessment.id,
						}))
					)
				} else {
					await this.upsertAndReconcileProjectionRollups(
						tx,
						input.corporationId,
						input.periodStart,
						input.periodEnd,
						memberRollupValues
					)
				}
			}

			return {
				assessment: this.toAssessment(corporationAssessment),
				period: this.toPeriod(period),
				lineCount: corporationLines.length,
				discrepancyCount: discrepancyValues.length,
				divisionSummaries: divisionSummaryOutput,
				refTypeSummaries: refTypeSummaryOutput,
			}
		})

		if (this.supportsMemberSummaryProjectionInfra()) {
			const nowMonthStart = this.startOfUtcMonth(new Date())
			const isClosedPeriod = input.periodEnd < nowMonthStart
			await this.bumpMemberSummaryVersion(
				input.corporationId,
				new Date(),
				isClosedPeriod ? 'finalized' : 'projection'
			)
		}

		return result
	}

	async rebuildFinalizedRollupsForPeriod(
		input: RunTaxAssessmentForPeriodInput
	): Promise<RunTaxAssessmentForPeriodResult> {
		const nowMonthStart = this.startOfUtcMonth(new Date())
		if (input.periodEnd >= nowMonthStart) {
			throw new Error('Finalized rollup rebuild requires a closed period')
		}

		return this.runAssessmentForPeriod({
			...input,
			// Static override: finalized rebuilds are corporation-wallet only for now.
			includeCharacterWallets: false,
		})
	}

	private async bumpMemberSummaryVersion(
		corporationId: string,
		now: Date,
		target: 'projection' | 'finalized'
	): Promise<void> {
		await this.db
			.insert(taxMemberSummaryVersions)
			.values({
				corporationId,
				projectionVersion: target === 'projection' ? 1 : 0,
				finalizedVersion: target === 'finalized' ? 1 : 0,
				projectionUpdatedAt: target === 'projection' ? now : null,
				finalizedUpdatedAt: target === 'finalized' ? now : null,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: taxMemberSummaryVersions.corporationId,
				set: {
					projectionVersion:
						target === 'projection'
							? sql`${taxMemberSummaryVersions.projectionVersion} + 1`
							: taxMemberSummaryVersions.projectionVersion,
					finalizedVersion:
						target === 'finalized'
							? sql`${taxMemberSummaryVersions.finalizedVersion} + 1`
							: taxMemberSummaryVersions.finalizedVersion,
					projectionUpdatedAt:
						target === 'projection' ? now : taxMemberSummaryVersions.projectionUpdatedAt,
					finalizedUpdatedAt:
						target === 'finalized' ? now : taxMemberSummaryVersions.finalizedUpdatedAt,
					updatedAt: now,
				},
			})
	}

	private async getCorporationMemberIdSet(corporationId: string): Promise<Set<string>> {
		try {
			const stub = getStub<EveCorporationData>(this.eveCorporationDataNamespace, corporationId)
			const members = await stub.getMembers(corporationId)
			return new Set(members.map((member) => member.characterId))
		} catch (_error) {
			return new Set<string>()
		}
	}

	private toUtcDay(date: Date): Date {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
	}

	private startOfUtcMonth(date: Date): Date {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
	}

	private supportsMemberSummaryProjectionInfra(): boolean {
		return Boolean(
			this.db.query &&
				(this.db.query as Record<string, unknown>).taxMemberSummaryVersions &&
				(this.db.query as Record<string, unknown>).taxMemberContributionProjectionRollups &&
				(this.db.query as Record<string, unknown>).taxMemberContributionFinalizedRollups &&
				typeof this.db.insert === 'function'
		)
	}

	private toMemberRollupKey(input: {
		rollupDate: Date
		characterId: string
		refType: string
	}): string {
		return `${input.rollupDate.toISOString().slice(0, 10)}:${input.characterId}:${input.refType}`
	}

	private async upsertAndReconcileProjectionRollups(
		tx: AssessmentWriteDb,
		corporationId: string,
		periodStart: Date,
		periodEnd: Date,
		values: Array<typeof taxMemberContributionProjectionRollups.$inferInsert>
	): Promise<void> {
		// Clean up stale open-period windows created with a mismatched periodStart (e.g. older
		// mid-month rule-mutation runs) so the open period is represented by a single window.
		await tx
			.delete(taxMemberContributionProjectionRollups)
			.where(
				and(
					eq(taxMemberContributionProjectionRollups.corporationId, corporationId),
					eq(taxMemberContributionProjectionRollups.periodEnd, periodEnd),
					ne(taxMemberContributionProjectionRollups.periodStart, periodStart)
				)
			)

		if (values.length > 0) {
			await tx
				.insert(taxMemberContributionProjectionRollups)
				.values(values)
				.onConflictDoUpdate({
					target: [
						taxMemberContributionProjectionRollups.corporationId,
						taxMemberContributionProjectionRollups.periodStart,
						taxMemberContributionProjectionRollups.periodEnd,
						taxMemberContributionProjectionRollups.rollupDate,
						taxMemberContributionProjectionRollups.characterId,
						taxMemberContributionProjectionRollups.refType,
					],
					set: {
						contributionIncome: sql`excluded.contribution_income`,
						taxableContributionIncome: sql`excluded.taxable_contribution_income`,
						assessmentCount: sql`excluded.assessment_count`,
						sourceRowCount: sql`excluded.source_row_count`,
						lastAssessmentAt: sql`excluded.last_assessment_at`,
						lastLedgerEntryDate: sql`excluded.last_ledger_entry_date`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		const existingRows = await tx.query.taxMemberContributionProjectionRollups.findMany({
			where: and(
				eq(taxMemberContributionProjectionRollups.corporationId, corporationId),
				eq(taxMemberContributionProjectionRollups.periodStart, periodStart),
				eq(taxMemberContributionProjectionRollups.periodEnd, periodEnd)
			),
			columns: {
				id: true,
				rollupDate: true,
				characterId: true,
				refType: true,
			},
		})
		const desiredKeys = new Set(
			values.map((row) =>
				this.toMemberRollupKey({
					rollupDate: row.rollupDate,
					characterId: row.characterId,
					refType: row.refType,
				})
			)
		)
		const staleIds = existingRows
			.filter(
				(row: { id: string; rollupDate: Date; characterId: string; refType: string }) =>
					!desiredKeys.has(
						this.toMemberRollupKey({
							rollupDate: row.rollupDate,
							characterId: row.characterId,
							refType: row.refType,
						})
					)
			)
			.map((row: { id: string }) => row.id)
		if (staleIds.length > 0) {
			await tx
				.delete(taxMemberContributionProjectionRollups)
				.where(inArray(taxMemberContributionProjectionRollups.id, staleIds))
		}
	}

	private async upsertAndReconcileFinalizedRollups(
		tx: AssessmentWriteDb,
		corporationId: string,
		periodStart: Date,
		periodEnd: Date,
		values: Array<typeof taxMemberContributionFinalizedRollups.$inferInsert>
	): Promise<void> {
		if (values.length > 0) {
			await tx
				.insert(taxMemberContributionFinalizedRollups)
				.values(values)
				.onConflictDoUpdate({
					target: [
						taxMemberContributionFinalizedRollups.corporationId,
						taxMemberContributionFinalizedRollups.periodStart,
						taxMemberContributionFinalizedRollups.periodEnd,
						taxMemberContributionFinalizedRollups.rollupDate,
						taxMemberContributionFinalizedRollups.characterId,
						taxMemberContributionFinalizedRollups.refType,
					],
					set: {
						contributionIncome: sql`excluded.contribution_income`,
						taxableContributionIncome: sql`excluded.taxable_contribution_income`,
						assessmentCount: sql`excluded.assessment_count`,
						sourceRowCount: sql`excluded.source_row_count`,
						finalizedAssessmentId: sql`excluded.finalized_assessment_id`,
						lastAssessmentAt: sql`excluded.last_assessment_at`,
						lastLedgerEntryDate: sql`excluded.last_ledger_entry_date`,
						updatedAt: sql`excluded.updated_at`,
					},
				})
		}

		const existingRows = await tx.query.taxMemberContributionFinalizedRollups.findMany({
			where: and(
				eq(taxMemberContributionFinalizedRollups.corporationId, corporationId),
				eq(taxMemberContributionFinalizedRollups.periodStart, periodStart),
				eq(taxMemberContributionFinalizedRollups.periodEnd, periodEnd)
			),
			columns: {
				id: true,
				rollupDate: true,
				characterId: true,
				refType: true,
			},
		})
		const desiredKeys = new Set(
			values.map((row) =>
				this.toMemberRollupKey({
					rollupDate: row.rollupDate,
					characterId: row.characterId,
					refType: row.refType,
				})
			)
		)
		const staleIds = existingRows
			.filter(
				(row: { id: string; rollupDate: Date; characterId: string; refType: string }) =>
					!desiredKeys.has(
						this.toMemberRollupKey({
							rollupDate: row.rollupDate,
							characterId: row.characterId,
							refType: row.refType,
						})
					)
			)
			.map((row: { id: string }) => row.id)
		if (staleIds.length > 0) {
			await tx
				.delete(taxMemberContributionFinalizedRollups)
				.where(inArray(taxMemberContributionFinalizedRollups.id, staleIds))
		}
	}

	private async withAssessmentWriteClient<T>(
		callback: (tx: AssessmentWriteDb) => Promise<T>
	): Promise<T> {
		const candidate = this.db as CorporationTaxDb & {
			transaction?: (cb: (tx: AssessmentWriteDb) => Promise<T>) => Promise<T>
		}
		if (
			typeof candidate.insert === 'function' &&
			typeof candidate.update === 'function' &&
			typeof candidate.delete === 'function' &&
			typeof candidate.query === 'object'
		) {
			return callback(candidate)
		}
		if (typeof candidate.transaction === 'function') {
			return candidate.transaction(async (tx) => callback(tx))
		}
		throw new Error('Assessment write client is not available')
	}

	async listAssessmentLines(filters: ListTaxAssessmentLinesFilters): Promise<TaxAssessmentLine[]> {
		const assessment = await this.db.query.taxAssessments.findFirst({
			where: and(
				eq(taxAssessments.id, filters.assessmentId),
				eq(taxAssessments.corporationId, filters.corporationId)
			),
			columns: {
				id: true,
			},
		})
		if (!assessment) {
			return []
		}

		const limit = Math.min(Math.max(filters.limit ?? 250, 1), 2000)
		const offset = Math.max(filters.offset ?? 0, 0)

		const rows = await this.db.query.taxAssessmentLines.findMany({
			where: eq(taxAssessmentLines.assessmentId, filters.assessmentId),
			orderBy: [desc(taxAssessmentLines.createdAt)],
			limit,
			offset,
		})

		return rows.map((row) => ({
			id: row.id,
			assessmentId: row.assessmentId,
			ledgerEntryId: row.ledgerEntryId,
			appliedRuleSetId: row.appliedRuleSetId,
			taxRateBps: row.taxRateBps,
			taxableAmount: row.taxableAmount,
			taxAmount: row.taxAmount,
			classification: row.classification,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}))
	}

	async listDiscrepancies(filters: ListTaxDiscrepanciesFilters): Promise<TaxDiscrepancy[]> {
		const conditions = [eq(taxDiscrepancies.corporationId, filters.corporationId)]
		if (filters.assessmentId) {
			conditions.push(eq(taxDiscrepancies.assessmentId, filters.assessmentId))
		}
		if (filters.onlyOpen) {
			conditions.push(isNull(taxDiscrepancies.resolvedAt))
		}

		const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000)
		const offset = Math.max(filters.offset ?? 0, 0)
		const rows = await this.db.query.taxDiscrepancies.findMany({
			where: and(...conditions),
			orderBy: [desc(taxDiscrepancies.createdAt)],
			limit,
			offset,
		})

		return rows.map((row) => ({
			id: row.id,
			corporationId: row.corporationId,
			assessmentId: row.assessmentId,
			discrepancyType: row.discrepancyType,
			severity: row.severity,
			details: row.details,
			resolvedAt: row.resolvedAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}))
	}

	private resolveRuleForEntry(input: {
		entry: typeof taxLedgerEntries.$inferSelect
		amountCenti: bigint
		compiledRules: CompiledRule[]
	}): {
		appliedRuleSetId: string | null
		taxRateBps: number
		taxableAmountCenti: bigint
		taxAmountCenti: bigint
		classification: string
	} {
		for (const rule of input.compiledRules) {
			const matches = this.ruleMatches(rule.condition, input.entry, input.amountCenti)
			if (!matches) {
				continue
			}

			if (rule.taxRateBps === 0) {
				return {
					appliedRuleSetId: rule.ruleSetId,
					taxRateBps: 0,
					taxableAmountCenti: 0n,
					taxAmountCenti: 0n,
					classification: `rule_exempt:${rule.label}`,
				}
			}

			const taxAmountCenti = (input.amountCenti * BigInt(rule.taxRateBps)) / 10_000n
			return {
				appliedRuleSetId: rule.ruleSetId,
				taxRateBps: rule.taxRateBps,
				taxableAmountCenti: input.amountCenti,
				taxAmountCenti,
				classification: `rule_taxable:${rule.label}`,
			}
		}

		return {
			appliedRuleSetId: null,
			taxRateBps: 0,
			taxableAmountCenti: 0n,
			taxAmountCenti: 0n,
			classification: input.entry.isEss ? 'no_matching_rule_ess' : 'no_matching_rule',
		}
	}

	private ruleMatches(
		condition: CompiledRule['condition'],
		entry: typeof taxLedgerEntries.$inferSelect,
		amountCenti: bigint
	): boolean {
		if (condition.appliesToRefType && condition.appliesToRefType !== entry.refType) {
			return false
		}
		if (condition.partyType === 'first_party' && !entry.firstPartyId) {
			return false
		}
		if (condition.partyType === 'second_party' && !entry.secondPartyId) {
			return false
		}
		return true
	}

	private async getInGameTaxRateBps(corporationId: string): Promise<number | null> {
		try {
			const stub = getStub<EveCorporationData>(this.eveCorporationDataNamespace, corporationId)
			const metadata = await stub.getCorporationTaxMetadata(corporationId)
			return metadata?.inGameTaxRateBps ?? null
		} catch (_error) {
			return null
		}
	}

	private resolveAssessmentStatus(isIncluded: boolean, taxDeltaCenti: bigint): TaxAssessmentStatus {
		if (!isIncluded) {
			return 'excluded'
		}
		if (taxDeltaCenti > 0n) {
			return 'underpaid'
		}
		if (taxDeltaCenti < 0n) {
			return 'overpaid'
		}
		return 'paid'
	}

	private extractTaxPaidFromPayload(payload: Record<string, unknown> | null): bigint {
		if (!payload || typeof payload !== 'object') {
			return 0n
		}
		const value = payload.tax
		if (typeof value === 'string') {
			return this.parseDecimalToCenti(value)
		}
		if (typeof value === 'number' && Number.isFinite(value)) {
			return this.parseDecimalToCenti(value.toString())
		}
		return 0n
	}

	private extractCharacterId(row: typeof taxLedgerEntries.$inferSelect): string | null {
		if (
			row.sourceType === 'character_wallet_journal' ||
			row.sourceType === 'character_wallet_transaction'
		) {
			return row.sourceSecondaryId ?? null
		}
		return null
	}

	private parseDecimalToCenti(value: string): bigint {
		const trimmed = value.trim()
		if (!trimmed) {
			return 0n
		}
		const negative = trimmed.startsWith('-')
		const normalized = negative ? trimmed.slice(1) : trimmed
		const [wholePartRaw, fractionalRaw = ''] = normalized.split('.')
		const wholePart = wholePartRaw.replace(/[^0-9]/g, '')
		const fractional = fractionalRaw
			.replace(/[^0-9]/g, '')
			.padEnd(2, '0')
			.slice(0, 2)
		const whole = wholePart ? BigInt(wholePart) : 0n
		const fraction = fractional ? BigInt(fractional) : 0n
		const centi = whole * 100n + fraction
		return negative ? -centi : centi
	}

	private formatCenti(value: bigint): string {
		const negative = value < 0n
		const absolute = negative ? -value : value
		const whole = absolute / 100n
		const fraction = absolute % 100n
		const prefix = negative ? '-' : ''
		if (fraction === 0n) {
			return `${prefix}${whole.toString()}`
		}
		return `${prefix}${whole.toString()}.${fraction.toString().padStart(2, '0')}`
	}

	private toAssessment(row: typeof taxAssessments.$inferSelect): TaxAssessment {
		return {
			id: row.id,
			corporationId: row.corporationId,
			taxPeriodStart: row.taxPeriodStart,
			taxPeriodEnd: row.taxPeriodEnd,
			assessmentScope: row.assessmentScope as TaxAssessmentScope,
			scopeId: row.scopeId,
			taxableIncome: row.taxableIncome,
			nonTaxableIncome: row.nonTaxableIncome,
			taxDue: row.taxDue,
			taxPaid: row.taxPaid,
			taxDelta: row.taxDelta,
			status: row.status as TaxAssessmentStatus,
			inGameTaxRateBps: row.inGameTaxRateBps,
			portalTaxRateBps: row.portalTaxRateBps,
			billId: row.billId,
			billStatus: row.billStatus,
			billStatusLastSyncedAt: row.billStatusLastSyncedAt,
			approvedBy: row.approvedBy,
			approvedAt: row.approvedAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private toPeriod(row: typeof taxPeriods.$inferSelect): TaxPeriod {
		return {
			id: row.id,
			corporationId: row.corporationId,
			periodStart: row.periodStart,
			periodEnd: row.periodEnd,
			status: row.status as TaxPeriodStatus,
			closedAt: row.closedAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		}
	}

	private toDivisionSummary(
		item: MutableSummary & { division: number | null },
		included: boolean
	): TaxDivisionAssessmentSummary {
		const taxDeltaCenti = item.taxDueCenti - item.taxPaidCenti
		return {
			division: item.division,
			taxableIncome: this.formatCenti(item.taxableIncomeCenti),
			nonTaxableIncome: this.formatCenti(item.nonTaxableIncomeCenti),
			taxDue: this.formatCenti(item.taxDueCenti),
			taxPaid: this.formatCenti(item.taxPaidCenti),
			taxDelta: this.formatCenti(taxDeltaCenti),
			status: this.resolveAssessmentStatus(included, taxDeltaCenti),
		}
	}

	private toRefTypeSummary(
		item: MutableSummary & { refType: string },
		included: boolean
	): TaxRefTypeAssessmentSummary {
		const taxDeltaCenti = item.taxDueCenti - item.taxPaidCenti
		return {
			refType: item.refType,
			taxableIncome: this.formatCenti(item.taxableIncomeCenti),
			nonTaxableIncome: this.formatCenti(item.nonTaxableIncomeCenti),
			taxDue: this.formatCenti(item.taxDueCenti),
			taxPaid: this.formatCenti(item.taxPaidCenti),
			taxDelta: this.formatCenti(taxDeltaCenti),
			status: this.resolveAssessmentStatus(included, taxDeltaCenti),
		}
	}
}
