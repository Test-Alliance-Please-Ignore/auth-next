import { filterTaxIncomeRefTypes, TAX_INCOME_REF_TYPES } from '@repo/corporation-tax'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, sql } from '@repo/db-utils'
import { getStub } from '@repo/do-utils'
import { logger } from '@repo/hono-helpers'

import {
	managedCorporations,
	taxAssessmentLines,
	taxAssessments,
	taxCorporationExclusions,
	taxDiscrepancies,
	taxLedgerEntries,
	taxMemberContributionFinalizedRollups,
	taxMemberContributionProjectionRollups,
	taxMemberSummaryVersions,
	taxRuleGroupAttachments,
	taxRuleSets,
} from '../db/schema'
import {
	formatCenti as formatMoneyCenti,
	parseDecimalToCenti as parseMoneyToCenti,
} from './tax-money'
import {
	billStatusSortComparators,
	missingEsiSortComparators,
	resolveDiscrepancyOrderBy,
	resolveEssOrderBy,
	resolveTotalTaxesOrderBy,
} from './tax-report-ordering'
import { toSortDirection } from './tax-report-sorting'

import type {
	ListTaxDiscrepancyReportFilters,
	ListTaxMissingEsiKeyReportFilters,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMissingEsiKeyRow,
	TaxPagedResult,
	TaxRollupReportFilters,
	TaxSummaryReport,
	TaxTopIncomeSourceMonthlyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
} from '@repo/corporation-tax'
import type { EveCorporationData } from '@repo/eve-corporation-data'
import type { CorporationTaxDb } from '../db'

const UNATTRIBUTED_CHARACTER_ID = '__unattributed__'

export class TaxReportService {
	private readonly MEMBER_SUMMARY_CACHE_TTL_MS = 30 * 60 * 1000
	private readonly MEMBER_SUMMARY_CACHE_MAX_ENTRIES = 500
	private memberSummaryCacheHits = 0
	private memberSummaryCacheMisses = 0
	private memberSummaryCacheDeltaChecks = 0
	private readonly memberSummaryCache = new Map<
		string,
		{
			rows: TaxMemberSummary[]
			cachedAtMs: number
			expiresAtMs: number
			projectionVersion: number
			finalizedVersion: number
		}
	>()

	constructor(
		private db: CorporationTaxDb,
		private eveCorporationDataNamespace: DurableObjectNamespace
	) {}

	async getSummaryReport(filters: TaxRollupReportFilters = {}): Promise<TaxSummaryReport> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		const [knownCorporationIds, exclusions] = filters.corporationId
			? await Promise.all([
					this.listKnownCorporationIds(filters.corporationId),
					this.listExclusions(filters.corporationId),
				])
			: [corporationIds, []]

		if (corporationIds.length === 0) {
			return {
				corporationId: filters.corporationId ?? null,
				fromDate: filters.fromDate ?? null,
				toDate: filters.toDate ?? null,
				assessmentCount: 0,
				discrepancyOpenCount: 0,
				includedCorporationCount: Math.max(knownCorporationIds.length - exclusions.length, 0),
				excludedCorporationCount: exclusions.length,
				billedAssessmentCount: 0,
				taxableIncome: '0.00',
				taxDue: '0.00',
				taxPaid: '0.00',
				taxDelta: '0.00',
				essIncome: '0.00',
				essTransferCount: 0,
			}
		}

		const assessmentWhere = this.buildAssessmentWhere(filters, corporationIds, 'corporation')
		const discrepancyWhere = this.buildDiscrepancyWhere(
			{
				corporationId: filters.corporationId,
				onlyOpen: true,
			},
			corporationIds
		)
		const essWhere = this.buildEssLedgerWhere(filters, corporationIds)
		const paidPerAssessmentExpr = sql`COALESCE((
			SELECT SUM(CAST(bp.amount AS numeric))
			FROM bill_payments bp
			WHERE bp.bill_id = ${taxAssessments.billId}
		), 0)`

		const [assessmentTotals, openDiscrepanciesResult, essTotals] = await Promise.all([
			this.db
				.select({
					assessmentCount: sql<number>`COUNT(*)`,
					billedAssessmentCount: sql<number>`SUM(CASE WHEN ${taxAssessments.billId} IS NOT NULL THEN 1 ELSE 0 END)`,
					taxableIncome: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxableIncome} AS numeric)), 0)::text`,
					taxDue: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0)::text`,
					taxPaid: sql<string>`COALESCE(SUM(${paidPerAssessmentExpr}), 0)::text`,
					taxDelta: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric) - ${paidPerAssessmentExpr}), 0)::text`,
				})
				.from(taxAssessments)
				.where(assessmentWhere),
			this.db
				.select({
					count: sql<number>`COUNT(*)`,
				})
				.from(taxDiscrepancies)
				.where(discrepancyWhere),
			this.db
				.select({
					essTransferCount: sql<number>`COUNT(*)`,
					essIncome: sql<string>`COALESCE(SUM(CASE WHEN CAST(${taxLedgerEntries.amount} AS numeric) > 0 THEN CAST(${taxLedgerEntries.amount} AS numeric) ELSE 0 END), 0)::text`,
				})
				.from(taxLedgerEntries)
				.where(essWhere),
		])
		const assessmentAggregate = assessmentTotals[0]
		const openDiscrepanciesCount = this.toInteger(openDiscrepanciesResult[0]?.count ?? 0)
		const essAggregate = essTotals[0]

		return {
			corporationId: filters.corporationId ?? null,
			fromDate: filters.fromDate ?? null,
			toDate: filters.toDate ?? null,
			assessmentCount: this.toInteger(assessmentAggregate?.assessmentCount ?? 0),
			discrepancyOpenCount: openDiscrepanciesCount,
			includedCorporationCount: Math.max(knownCorporationIds.length - exclusions.length, 0),
			excludedCorporationCount: exclusions.length,
			billedAssessmentCount: this.toInteger(assessmentAggregate?.billedAssessmentCount ?? 0),
			taxableIncome: this.formatCenti(
				this.parseDecimalToCenti(assessmentAggregate?.taxableIncome ?? '0')
			),
			taxDue: this.formatCenti(this.parseDecimalToCenti(assessmentAggregate?.taxDue ?? '0')),
			taxPaid: this.formatCenti(this.parseDecimalToCenti(assessmentAggregate?.taxPaid ?? '0')),
			taxDelta: this.formatCenti(this.parseDecimalToCenti(assessmentAggregate?.taxDelta ?? '0')),
			essIncome: this.formatCenti(this.parseDecimalToCenti(essAggregate?.essIncome ?? '0')),
			essTransferCount: this.toInteger(essAggregate?.essTransferCount ?? 0),
		}
	}

	async getTotalTaxesByCorporationReport(
		filters: TaxRollupReportFilters = {}
	): Promise<TaxPagedResult<TaxTotalTaxesByCorporationRow>> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'taxDue'
		const sortDirection = toSortDirection(filters.sortDirection, 'desc')
		const where = this.buildAssessmentWhere(filters, corporationIds, 'corporation')
		const taxableItemCountExpr = sql<number>`COALESCE(SUM((SELECT COUNT(*) FROM tax_assessment_lines tal WHERE tal.assessment_id = ${taxAssessments.id})), 0)`
		const assessmentCountExpr = sql<number>`COUNT(*)`
		const billedAssessmentCountExpr = sql<number>`SUM(CASE WHEN ${taxAssessments.billId} IS NOT NULL THEN 1 ELSE 0 END)`
		const underpaidCountExpr = sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'underpaid' THEN 1 ELSE 0 END)`
		const paidCountExpr = sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'paid' THEN 1 ELSE 0 END)`
		const overpaidCountExpr = sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'overpaid' THEN 1 ELSE 0 END)`
		const draftCountExpr = sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'draft' THEN 1 ELSE 0 END)`
		const excludedCountExpr = sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'excluded' THEN 1 ELSE 0 END)`
		const taxableIncomeExpr = sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxableIncome} AS numeric)), 0)::text`
		const taxDueExpr = sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0)::text`
		const paidPerAssessmentExpr = sql`COALESCE((
			SELECT SUM(CAST(bp.amount AS numeric))
			FROM bill_payments bp
			WHERE bp.bill_id = ${taxAssessments.billId}
		), 0)`
		const taxPaidExpr = sql<string>`COALESCE(SUM(${paidPerAssessmentExpr}), 0)::text`
		const taxDeltaExpr = sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric) - ${paidPerAssessmentExpr}), 0)::text`
		const lastAssessmentAtExpr = sql<Date | null>`MAX(${taxAssessments.taxPeriodEnd})`
		const orderBy = resolveTotalTaxesOrderBy(sortBy, sortDirection)

		const [rows, totalRowsResult] = await Promise.all([
			this.db
				.select({
					corporationId: taxAssessments.corporationId,
					taxableItemCount: taxableItemCountExpr,
					assessmentCount: assessmentCountExpr,
					billedAssessmentCount: billedAssessmentCountExpr,
					underpaidCount: underpaidCountExpr,
					paidCount: paidCountExpr,
					overpaidCount: overpaidCountExpr,
					draftCount: draftCountExpr,
					excludedCount: excludedCountExpr,
					taxableIncome: taxableIncomeExpr,
					taxDue: taxDueExpr,
					taxPaid: taxPaidExpr,
					taxDelta: taxDeltaExpr,
					lastAssessmentAt: lastAssessmentAtExpr,
				})
				.from(taxAssessments)
				.where(where)
				.groupBy(taxAssessments.corporationId)
				.orderBy(...orderBy)
				.limit(limit)
				.offset(offset),
			this.db
				.select({
					count: sql<number>`COUNT(DISTINCT ${taxAssessments.corporationId})`,
				})
				.from(taxAssessments)
				.where(where),
		])

		const mappedRows = rows.map((row) => ({
			corporationId: row.corporationId,
			taxableItemCount: this.toInteger(row.taxableItemCount),
			assessmentCount: this.toInteger(row.assessmentCount),
			billedAssessmentCount: this.toInteger(row.billedAssessmentCount),
			underpaidCount: this.toInteger(row.underpaidCount),
			paidCount: this.toInteger(row.paidCount),
			overpaidCount: this.toInteger(row.overpaidCount),
			draftCount: this.toInteger(row.draftCount),
			excludedCount: this.toInteger(row.excludedCount),
			taxableIncome: this.formatCenti(this.parseDecimalToCenti(row.taxableIncome)),
			taxDue: this.formatCenti(this.parseDecimalToCenti(row.taxDue)),
			taxPaid: this.formatCenti(this.parseDecimalToCenti(row.taxPaid)),
			taxDelta: this.formatCenti(this.parseDecimalToCenti(row.taxDelta)),
			taxDueCenti: this.parseDecimalToCenti(row.taxDue).toString(),
			taxPaidCenti: this.parseDecimalToCenti(row.taxPaid).toString(),
			taxDeltaCenti: this.parseDecimalToCenti(row.taxDelta).toString(),
			lastAssessmentAt: row.lastAssessmentAt ? new Date(row.lastAssessmentAt) : null,
		}))
		return {
			rows: mappedRows,
			totalRows: this.toInteger(totalRowsResult[0]?.count ?? 0),
		}
	}

	async getTopIncomeSourcesReport(
		filters: TaxRollupReportFilters = {}
	): Promise<TaxTopIncomeSourceRow[]> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 20, 1), 200)
		const where = and(
			this.buildLedgerWhere(filters, corporationIds),
			sql`CAST(${taxLedgerEntries.amount} AS numeric) > 0`
		)
		const rows = await this.db
			.select({
				refType: taxLedgerEntries.refType,
				entryCount: sql<number>`COUNT(*)`,
				essEntryCount: sql<number>`SUM(CASE WHEN ${taxLedgerEntries.refType} = 'ess_escrow_transfer' THEN 1 ELSE 0 END)`,
				totalIncome: sql<string>`COALESCE(SUM(CAST(${taxLedgerEntries.amount} AS numeric)), 0)::text`,
			})
			.from(taxLedgerEntries)
			.where(where)
			.groupBy(taxLedgerEntries.refType)
			.orderBy(
				sql`COALESCE(SUM(CAST(${taxLedgerEntries.amount} AS numeric)), 0) DESC`,
				asc(taxLedgerEntries.refType)
			)
			.limit(limit)
			.offset(offset)
		return rows.map((row) => ({
			refType: row.refType,
			entryCount: this.toInteger(row.entryCount),
			essEntryCount: this.toInteger(row.essEntryCount),
			totalIncome: this.formatCenti(this.parseDecimalToCenti(row.totalIncome)),
		}))
	}

	async getTopIncomeSourcesMonthlyReport(
		filters: TaxRollupReportFilters = {}
	): Promise<TaxTopIncomeSourceMonthlyRow[]> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const monthStartExpr = sql<Date>`date_trunc('month', ${taxLedgerEntries.entryDate})`
		const where = and(
			this.buildLedgerWhere(filters, corporationIds),
			sql`CAST(${taxLedgerEntries.amount} AS numeric) > 0`
		)
		const rows = await this.db
			.select({
				monthStart: monthStartExpr,
				refType: taxLedgerEntries.refType,
				entryCount: sql<number>`COUNT(*)`,
				essEntryCount: sql<number>`SUM(CASE WHEN ${taxLedgerEntries.refType} = 'ess_escrow_transfer' THEN 1 ELSE 0 END)`,
				totalIncome: sql<string>`COALESCE(SUM(CAST(${taxLedgerEntries.amount} AS numeric)), 0)::text`,
			})
			.from(taxLedgerEntries)
			.where(where)
			.groupBy(monthStartExpr, taxLedgerEntries.refType)
			.orderBy(
				sql`date_trunc('month', ${taxLedgerEntries.entryDate}) ASC`,
				sql`COALESCE(SUM(CAST(${taxLedgerEntries.amount} AS numeric)), 0) DESC`,
				asc(taxLedgerEntries.refType)
			)
		return rows.map((row) => ({
			monthStart: new Date(row.monthStart),
			refType: row.refType,
			entryCount: this.toInteger(row.entryCount),
			essEntryCount: this.toInteger(row.essEntryCount),
			totalIncome: this.formatCenti(this.parseDecimalToCenti(row.totalIncome)),
		}))
	}

	async getEssPayoutReport(
		filters: TaxRollupReportFilters = {}
	): Promise<TaxPagedResult<TaxEssPayoutRow>> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'entryDate'
		const sortDirection = toSortDirection(filters.sortDirection, 'desc')
		const where = this.buildEssLedgerWhere(filters, corporationIds)
		const orderBy = resolveEssOrderBy(sortBy, sortDirection)
		const [rows, totalRowsResult] = await Promise.all([
			this.db.query.taxLedgerEntries.findMany({
				where,
				orderBy,
				limit,
				offset,
			}),
			this.db
				.select({
					count: sql<number>`COUNT(*)`,
				})
				.from(taxLedgerEntries)
				.where(where),
		])
		const totalRows = this.toInteger(totalRowsResult[0]?.count ?? 0)

		const pagedRows = rows.map((row) => ({
			id: row.id,
			corporationId: row.corporationId,
			entryDate: row.entryDate,
			division: row.division,
			amount: row.amount,
			sourceType: row.sourceType,
			sourcePrimaryId: row.sourcePrimaryId,
			firstPartyId: row.firstPartyId,
			secondPartyId: row.secondPartyId,
		}))
		return {
			rows: pagedRows,
			totalRows,
		}
	}

	async getComplianceOverTimeReport(
		filters: TaxRollupReportFilters = {}
	): Promise<TaxCompliancePoint[]> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 180, 1), 3650)
		const rollupDateExpr = sql<Date>`date_trunc('day', ${taxAssessments.taxPeriodEnd})`
		const paidPerAssessmentExpr = sql`COALESCE((
			SELECT SUM(CAST(bp.amount AS numeric))
			FROM bill_payments bp
			WHERE bp.bill_id = ${taxAssessments.billId}
		), 0)`
		const rows = await this.db
			.select({
				rollupDate: rollupDateExpr,
				entryCount: sql<number>`COUNT(*)`,
				taxDue: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0)::text`,
				taxPaid: sql<string>`COALESCE(SUM(${paidPerAssessmentExpr}), 0)::text`,
			})
			.from(taxAssessments)
			.where(this.buildAssessmentWhere(filters, corporationIds, 'corporation'))
			.groupBy(rollupDateExpr)
			.orderBy(sql`date_trunc('day', ${taxAssessments.taxPeriodEnd}) ASC`)
			.limit(limit)
			.offset(offset)
		return rows.map((row) => {
			const taxDueCenti = this.parseDecimalToCenti(row.taxDue)
			const taxPaidCenti = this.parseDecimalToCenti(row.taxPaid)
			const taxDeltaCenti = taxDueCenti - taxPaidCenti
			return {
				rollupDate: new Date(row.rollupDate),
				taxDue: this.formatCenti(taxDueCenti),
				taxPaid: this.formatCenti(taxPaidCenti),
				taxDelta: this.formatCenti(taxDeltaCenti),
				entryCount: this.toInteger(row.entryCount),
			}
		})
	}

	async getTaxDiscrepancyReport(
		filters: ListTaxDiscrepancyReportFilters = {}
	): Promise<TaxPagedResult<TaxDiscrepancy>> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'createdAt'
		const sortDirection = toSortDirection(filters.sortDirection, 'desc')
		const orderBy = resolveDiscrepancyOrderBy(sortBy, sortDirection)

		const where = this.buildDiscrepancyWhere(filters, corporationIds)
		const [rows, totalRowsResult] = await Promise.all([
			this.db.query.taxDiscrepancies.findMany({
				where,
				orderBy,
				limit,
				offset,
			}),
			this.db
				.select({
					count: sql<number>`COUNT(*)`,
				})
				.from(taxDiscrepancies)
				.where(where),
		])

		const totalRows = this.toInteger(totalRowsResult[0]?.count ?? 0)
		return {
			rows: rows.map((row) => ({
				id: row.id,
				corporationId: row.corporationId,
				assessmentId: row.assessmentId,
				discrepancyType: row.discrepancyType,
				severity: row.severity,
				details: row.details,
				resolvedAt: row.resolvedAt,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
			})),
			totalRows,
		}
	}

	async getMissingEsiKeysReport(
		filters: ListTaxMissingEsiKeyReportFilters = {}
	): Promise<TaxPagedResult<TaxMissingEsiKeyRow>> {
		const corporationIds = await this.listKnownCorporationIds()

		const missingRows: TaxMissingEsiKeyRow[] = []
		for (const corporationId of corporationIds) {
			const status = await this.getCorporationEsiAuthStatus(corporationId)
			const hasMissingCoverage =
				!status ||
				!status.isConfigured ||
				!status.hasRequiredScopes ||
				!status.hasCorporationWalletScope ||
				status.directorCount < 1 ||
				status.healthyDirectorCount < 1

			if (!hasMissingCoverage) {
				continue
			}

			missingRows.push({
				corporationId,
				isConfigured: status?.isConfigured ?? false,
				hasRequiredScopes: status?.hasRequiredScopes ?? false,
				hasCorporationWalletScope: status?.hasCorporationWalletScope ?? false,
				missingRequiredScopes: status?.missingRequiredScopes ?? [],
				directorCount: status?.directorCount ?? 0,
				healthyDirectorCount: status?.healthyDirectorCount ?? 0,
				lastVerified: status?.lastVerified ?? null,
			})
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'lastVerified'
		const sortDirection = toSortDirection(filters.sortDirection, 'desc')
		const comparator =
			missingEsiSortComparators[sortBy as keyof typeof missingEsiSortComparators] ??
			missingEsiSortComparators.lastVerified
		const sortedRows = missingRows
			.sort((a, b) => comparator(a, b, sortDirection))
			.slice(offset, offset + limit)
		return {
			rows: sortedRows,
			totalRows: missingRows.length,
		}
	}

	async getBillStatusReport(
		filters: TaxRollupReportFilters = {}
	): Promise<TaxPagedResult<TaxBillStatusReportRow>> {
		const corporationIds = await this.resolveReportCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}
		const paidPerAssessmentExpr = sql`COALESCE((
			SELECT SUM(CAST(bp.amount AS numeric))
			FROM bill_payments bp
			WHERE bp.bill_id = ${taxAssessments.billId}
		), 0)`

		const rows = await this.db
			.select({
				assessmentId: taxAssessments.id,
				corporationId: taxAssessments.corporationId,
				taxPeriodStart: taxAssessments.taxPeriodStart,
				taxPeriodEnd: taxAssessments.taxPeriodEnd,
				billId: taxAssessments.billId,
				billStatus: sql<string>`COALESCE(${taxAssessments.billStatus}, 'draft')`,
				issueDate: sql<Date | null>`(
					SELECT MIN(bse.created_at)
					FROM bill_status_events bse
					WHERE bse.bill_id = ${taxAssessments.billId}
						AND bse.event_type = 'issued'
				)`,
				dueDate: sql<Date | null>`(
					SELECT b.due_date
					FROM bills b
					WHERE b.id = ${taxAssessments.billId}
				)`,
				taxDue: taxAssessments.taxDue,
				taxPaid: sql<string>`${paidPerAssessmentExpr}::text`,
				taxDelta: sql<string>`(CAST(${taxAssessments.taxDue} AS numeric) - ${paidPerAssessmentExpr})::text`,
			})
			.from(taxAssessments)
			.where(
				and(
					this.buildAssessmentWhere(filters, corporationIds, 'corporation'),
					isNotNull(taxAssessments.billId)
				)
			)

		const grouped = rows.map((row) => ({
			assessmentId: row.assessmentId,
			corporationId: row.corporationId,
			taxPeriodStart: new Date(row.taxPeriodStart),
			taxPeriodEnd: new Date(row.taxPeriodEnd),
			billId: row.billId,
			billStatus: row.billStatus as TaxBillStatusReportRow['billStatus'],
			issueDate: this.toDateOrNull(row.issueDate),
			dueDate: this.toDateOrNull(row.dueDate),
			taxDue: this.formatCenti(this.parseDecimalToCenti(row.taxDue)),
			taxPaid: this.formatCenti(this.parseDecimalToCenti(row.taxPaid)),
			taxDelta: this.formatCenti(this.parseDecimalToCenti(row.taxDelta)),
			taxDueCenti: this.parseDecimalToCenti(row.taxDue).toString(),
			taxPaidCenti: this.parseDecimalToCenti(row.taxPaid).toString(),
			taxDeltaCenti: this.parseDecimalToCenti(row.taxDelta).toString(),
			sortDueCenti: this.parseDecimalToCenti(row.taxDue),
			sortPaidCenti: this.parseDecimalToCenti(row.taxPaid),
			sortDeltaCenti: this.parseDecimalToCenti(row.taxDelta),
			sortIssueDate: this.toDateOrNull(row.issueDate),
			sortDueDate: this.toDateOrNull(row.dueDate),
		}))

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'dueDate'
		const sortDirection = toSortDirection(filters.sortDirection, 'asc')
		const comparator =
			billStatusSortComparators[sortBy as keyof typeof billStatusSortComparators] ??
			billStatusSortComparators.dueDate
		const pagedRows = grouped
			.sort((a, b) => comparator(a, b, sortDirection))
			.slice(offset, offset + limit)
			.map(
				({
					sortDueCenti: _sortDueCenti,
					sortPaidCenti: _sortPaidCenti,
					sortDeltaCenti: _sortDeltaCenti,
					sortIssueDate: _sortIssueDate,
					sortDueDate: _sortDueDate,
					...row
				}) => row
			)
		return {
			rows: pagedRows,
			totalRows: grouped.length,
		}
	}

	async getMemberSummaryReport(
		filters: TaxMemberSummaryReportFilters
	): Promise<TaxPagedResult<TaxMemberSummary>> {
		const rollupReadSupported = this.supportsMemberSummaryRollupRead()
		const requestedCharacterIds = Array.from(
			new Set<string>((filters.characterIds ?? []).map((value) => value.trim()).filter(Boolean))
		)
		// Privileged corporation-wide rollup reads are already scoped by corporation_id.
		// Only resolve the DO-backed active-member roster when an individual scope is
		// requested or when the legacy non-rollup path still needs it.
		const memberCharacterIds =
			rollupReadSupported && requestedCharacterIds.length === 0
				? []
				: await this.getCorporationMemberIds(filters.corporationId)
		const memberIdSet = new Set(memberCharacterIds)
		const scopedRequestedCharacterIds =
			requestedCharacterIds.length > 0
				? requestedCharacterIds.filter((characterId) => memberIdSet.has(characterId))
				: []
		const includeUnattributedRow = true
		const refTypes = filterTaxIncomeRefTypes(filters.refTypes)

		if (rollupReadSupported) {
			if (requestedCharacterIds.length > 0 && scopedRequestedCharacterIds.length === 0) {
				return { rows: [], totalRows: 0 }
			}

			return this.getMemberSummaryFromRollupsSql({
				corporationId: filters.corporationId,
				characterIds: requestedCharacterIds.length > 0 ? scopedRequestedCharacterIds : undefined,
				includeUnattributedRow,
				refTypes,
				fromDate: filters.fromDate,
				toDate: filters.toDate,
				topRefTypesLimit: filters.topRefTypesLimit,
				limit: filters.limit,
				offset: filters.offset,
				sortBy: filters.sortBy,
				sortDirection: filters.sortDirection,
			})
		}

		const cacheKey = this.toMemberSummaryCacheKey(filters)
		const nowMs = Date.now()
		const versions = await this.getMemberSummaryVersions(filters.corporationId)
		const cached = this.memberSummaryCache.get(cacheKey)
		if (cached) {
			const sameVersions =
				cached.projectionVersion === versions.projectionVersion &&
				cached.finalizedVersion === versions.finalizedVersion
			if (sameVersions) {
				this.memberSummaryCacheHits += 1
				if (cached.expiresAtMs <= nowMs) {
					// Sliding expiration when upstream versions did not change.
					this.setMemberSummaryCache(cacheKey, {
						...cached,
						expiresAtMs: nowMs + this.MEMBER_SUMMARY_CACHE_TTL_MS,
					})
				}
				return this.toPagedMemberSummaryResult(
					this.filterMemberSummaryRowsForRequest(cached.rows, scopedRequestedCharacterIds),
					filters
				)
			}
			this.memberSummaryCacheDeltaChecks += 1
			const hasRollupUpdates = await this.hasMemberSummaryRollupUpdatesSince(
				filters,
				cached.cachedAtMs
			)
			if (!hasRollupUpdates) {
				// Versions changed but not for this filtered window; keep cached result and update version stamps.
				this.memberSummaryCacheHits += 1
				this.setMemberSummaryCache(cacheKey, {
					...cached,
					cachedAtMs: nowMs,
					expiresAtMs: nowMs + this.MEMBER_SUMMARY_CACHE_TTL_MS,
					projectionVersion: versions.projectionVersion,
					finalizedVersion: versions.finalizedVersion,
				})
				return this.toPagedMemberSummaryResult(
					this.filterMemberSummaryRowsForRequest(cached.rows, scopedRequestedCharacterIds),
					filters
				)
			}
		}
		this.memberSummaryCacheMisses += 1

		const corporationIds = await this.listKnownCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		if (requestedCharacterIds.length > 0 && scopedRequestedCharacterIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const scopedCharacterIds = memberCharacterIds
		const topRefTypesLimit =
			filters.topRefTypesLimit !== undefined ? Math.max(filters.topRefTypesLimit, 1) : null
		const scopedCharacterIdSet = new Set(scopedCharacterIds)

		if (this.supportsMemberSummaryRollupRead()) {
			const rollupRows = await this.getMemberSummaryFromRollups({
				corporationId: filters.corporationId,
				fromDate: filters.fromDate,
				toDate: filters.toDate,
				scopedCharacterIds,
				scopedCharacterIdSet,
				includeUnattributedRow,
				topRefTypesLimit,
				refTypes,
			})
			if (rollupRows.length > 0) {
				this.setMemberSummaryCache(cacheKey, {
					rows: rollupRows,
					cachedAtMs: nowMs,
					expiresAtMs: nowMs + this.MEMBER_SUMMARY_CACHE_TTL_MS,
					projectionVersion: versions.projectionVersion,
					finalizedVersion: versions.finalizedVersion,
				})
				return this.toPagedMemberSummaryResult(
					this.filterMemberSummaryRowsForRequest(rollupRows, scopedRequestedCharacterIds),
					filters
				)
			}
		}

		const corporationAssessmentConditions = [
			eq(taxAssessments.corporationId, filters.corporationId),
			eq(taxAssessments.assessmentScope, 'corporation'),
		]
		if (filters.fromDate) {
			corporationAssessmentConditions.push(gte(taxAssessments.taxPeriodStart, filters.fromDate))
		}
		if (filters.toDate) {
			corporationAssessmentConditions.push(lte(taxAssessments.taxPeriodEnd, filters.toDate))
		}

		const assessmentWhere = and(...corporationAssessmentConditions)
		const corporationAssessments: Array<typeof taxAssessments.$inferSelect> = []
		const assessmentPageSize = 5_000
		let assessmentOffset = 0
		for (;;) {
			const chunk = await this.db.query.taxAssessments.findMany({
				where: assessmentWhere,
				orderBy: [desc(taxAssessments.taxPeriodEnd), desc(taxAssessments.createdAt)],
				limit: assessmentPageSize,
				offset: assessmentOffset,
			})
			if (chunk.length === 0) {
				break
			}
			corporationAssessments.push(...chunk)
			if (chunk.length < assessmentPageSize) {
				break
			}
			assessmentOffset += chunk.length
		}
		const corporationAssessmentById = new Map(
			corporationAssessments.map((assessment) => [assessment.id, assessment])
		)
		const corporationAssessmentIds = corporationAssessments.map((row) => row.id)
		if (corporationAssessmentIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const corporationLineRows: Array<typeof taxAssessmentLines.$inferSelect> = []
		const assessmentIdBatchSize = 1_000
		const assessmentLinePageSize = 5_000
		for (let start = 0; start < corporationAssessmentIds.length; start += assessmentIdBatchSize) {
			const idBatch = corporationAssessmentIds.slice(start, start + assessmentIdBatchSize)
			let lineOffset = 0
			for (;;) {
				const chunk = await this.db.query.taxAssessmentLines.findMany({
					where: inArray(taxAssessmentLines.assessmentId, idBatch),
					limit: assessmentLinePageSize,
					offset: lineOffset,
				})
				if (chunk.length === 0) {
					break
				}
				corporationLineRows.push(...chunk)
				if (chunk.length < assessmentLinePageSize) {
					break
				}
				lineOffset += chunk.length
			}
		}
		if (corporationLineRows.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const ledgerEntryIds = Array.from(new Set(corporationLineRows.map((row) => row.ledgerEntryId)))
		if (ledgerEntryIds.length === 0) {
			return { rows: [], totalRows: 0 }
		}

		const ledgerRows: Array<typeof taxLedgerEntries.$inferSelect> = []
		const ledgerIdBatchSize = 1_000
		for (let start = 0; start < ledgerEntryIds.length; start += ledgerIdBatchSize) {
			const idBatch = ledgerEntryIds.slice(start, start + ledgerIdBatchSize)
			const chunk = await this.db.query.taxLedgerEntries.findMany({
				where: inArray(taxLedgerEntries.id, idBatch),
			})
			ledgerRows.push(...chunk)
		}

		const ledgerById = new Map(ledgerRows.map((row) => [row.id, row]))
		const grouped = new Map<
			string,
			{
				assessmentIds: Set<string>
				contributionIncomeCenti: bigint
				taxableContributionIncomeCenti: bigint
				lastAssessmentAt: Date | null
				topRefTypeTotals: Map<
					string,
					{
						lineCount: number
						contributionAmountCenti: bigint
						taxableAmountCenti: bigint
						taxAmountCenti: bigint
					}
				>
			}
		>()

		const attributedCharacterIds = new Set<string>()
		const unattributedKey = '__unattributed__'

		const getSummary = (characterId: string) => {
			const existing = grouped.get(characterId)
			if (existing) {
				return existing
			}
			const created = {
				assessmentIds: new Set<string>(),
				contributionIncomeCenti: 0n,
				taxableContributionIncomeCenti: 0n,
				lastAssessmentAt: null,
				topRefTypeTotals: new Map<
					string,
					{
						lineCount: number
						contributionAmountCenti: bigint
						taxableAmountCenti: bigint
						taxAmountCenti: bigint
					}
				>(),
			}
			grouped.set(characterId, created)
			return created
		}

		for (const line of corporationLineRows) {
			const ledgerRow = ledgerById.get(line.ledgerEntryId)
			if (!ledgerRow) {
				continue
			}
			if (
				ledgerRow.sourceType !== 'corporation_wallet_journal' &&
				ledgerRow.sourceType !== 'corporation_wallet_transaction'
			) {
				continue
			}

			const assessment = corporationAssessmentById.get(line.assessmentId)
			if (!assessment) {
				continue
			}

			const memberCandidateIds = [ledgerRow.firstPartyId, ledgerRow.secondPartyId].filter(
				(value): value is string => Boolean(value)
			)
			const attributedCharacterId =
				memberCandidateIds.find((characterId) => memberIdSet.has(characterId)) ?? null

			const amountCenti = this.parseDecimalToCenti(ledgerRow.amount)
			if (amountCenti <= 0n) {
				continue
			}

			const taxAmountCenti = this.parseDecimalToCenti(line.taxAmount)

			let groupKey: string | null = attributedCharacterId
			if (!groupKey && includeUnattributedRow) {
				groupKey = unattributedKey
			}
			if (!groupKey) {
				continue
			}
			if (
				groupKey !== unattributedKey &&
				scopedCharacterIdSet.size > 0 &&
				!scopedCharacterIdSet.has(groupKey)
			) {
				continue
			}

			if (groupKey !== unattributedKey) {
				attributedCharacterIds.add(groupKey)
			}

			const summary = getSummary(groupKey)
			summary.assessmentIds.add(line.assessmentId)
			summary.contributionIncomeCenti += amountCenti
			summary.taxableContributionIncomeCenti += taxAmountCenti
			summary.lastAssessmentAt =
				!summary.lastAssessmentAt || assessment.taxPeriodEnd > summary.lastAssessmentAt
					? assessment.taxPeriodEnd
					: summary.lastAssessmentAt

			const refType = ledgerRow.refType || 'unknown'
			const topTotals = summary.topRefTypeTotals.get(refType) ?? {
				lineCount: 0,
				contributionAmountCenti: 0n,
				taxableAmountCenti: 0n,
				taxAmountCenti: 0n,
			}
			topTotals.lineCount += 1
			topTotals.contributionAmountCenti += amountCenti
			topTotals.taxableAmountCenti += taxAmountCenti
			topTotals.taxAmountCenti += taxAmountCenti
			summary.topRefTypeTotals.set(refType, topTotals)
		}

		const characterIdsToReturn =
			requestedCharacterIds.length > 0
				? scopedCharacterIds
				: Array.from(attributedCharacterIds).sort((a, b) => a.localeCompare(b))

		const rows = characterIdsToReturn
			.map((characterId): TaxMemberSummary | null => {
				const summary = grouped.get(characterId)
				if (!summary) {
					return null
				}
				const sortedTopRefTypes = Array.from(summary.topRefTypeTotals.entries()).sort((a, b) => {
					if (a[1].contributionAmountCenti === b[1].contributionAmountCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].contributionAmountCenti > b[1].contributionAmountCenti ? -1 : 1
				})
				const topRefTypes = (
					topRefTypesLimit ? sortedTopRefTypes.slice(0, topRefTypesLimit) : sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
					contributionAmount: this.formatCenti(totals.contributionAmountCenti),
					taxableAmount: this.formatCenti(totals.taxableAmountCenti),
					taxAmount: this.formatCenti(totals.taxAmountCenti),
				}))

				return {
					corporationId: filters.corporationId,
					characterId,
					fromDate: filters.fromDate ?? null,
					toDate: filters.toDate ?? null,
					assessmentCount: summary.assessmentIds.size,
					contributionIncome: this.formatCenti(summary.contributionIncomeCenti),
					taxableContributionIncome: this.formatCenti(summary.taxableContributionIncomeCenti),
					lastAssessmentAt: summary.lastAssessmentAt,
					topRefTypes,
				}
			})
			.filter((row): row is NonNullable<typeof row> => row !== null)

		if (includeUnattributedRow) {
			const unattributed = grouped.get(unattributedKey)
			if (unattributed) {
				const sortedTopRefTypes = Array.from(unattributed.topRefTypeTotals.entries()).sort(
					(a, b) => {
						if (a[1].contributionAmountCenti === b[1].contributionAmountCenti) {
							return a[0].localeCompare(b[0])
						}
						return a[1].contributionAmountCenti > b[1].contributionAmountCenti ? -1 : 1
					}
				)
				const topRefTypes = (
					topRefTypesLimit ? sortedTopRefTypes.slice(0, topRefTypesLimit) : sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
					contributionAmount: this.formatCenti(totals.contributionAmountCenti),
					taxableAmount: this.formatCenti(totals.taxableAmountCenti),
					taxAmount: this.formatCenti(totals.taxAmountCenti),
				}))

				rows.unshift({
					corporationId: filters.corporationId,
					characterId: unattributedKey,
					fromDate: filters.fromDate ?? null,
					toDate: filters.toDate ?? null,
					assessmentCount: unattributed.assessmentIds.size,
					contributionIncome: this.formatCenti(unattributed.contributionIncomeCenti),
					taxableContributionIncome: this.formatCenti(unattributed.taxableContributionIncomeCenti),
					lastAssessmentAt: unattributed.lastAssessmentAt,
					topRefTypes,
				})
			}
		}

		this.setMemberSummaryCache(cacheKey, {
			rows,
			cachedAtMs: nowMs,
			expiresAtMs: nowMs + this.MEMBER_SUMMARY_CACHE_TTL_MS,
			projectionVersion: versions.projectionVersion,
			finalizedVersion: versions.finalizedVersion,
		})

		return this.toPagedMemberSummaryResult(
			this.filterMemberSummaryRowsForRequest(rows, scopedRequestedCharacterIds),
			filters
		)
	}

	async getTaxableIncomeRefTypes(corporationId: string): Promise<string[]> {
		const attachments = await this.db
			.select({ ruleGroupId: taxRuleGroupAttachments.ruleGroupId })
			.from(taxRuleGroupAttachments)
			.where(eq(taxRuleGroupAttachments.corporationId, corporationId))

		const ruleGroupIds = attachments.map((row) => row.ruleGroupId)
		if (ruleGroupIds.length === 0) {
			return []
		}

		const rules = await this.db.query.taxRuleSets.findMany({
			where: and(inArray(taxRuleSets.ruleGroupId, ruleGroupIds), eq(taxRuleSets.isActive, true)),
			orderBy: [desc(taxRuleSets.priority), desc(taxRuleSets.createdAt)],
		})

		return TAX_INCOME_REF_TYPES.filter((refType) => {
			const effectiveRule = rules.find(
				(rule) => rule.appliesToRefType === null || rule.appliesToRefType === refType
			)
			return (effectiveRule?.taxRateBps ?? 0) > 0
		})
	}

	private async hasMemberSummaryRollupUpdatesSince(
		filters: TaxMemberSummaryReportFilters,
		cachedAtMs: number
	): Promise<boolean> {
		if (!this.supportsMemberSummaryRollupRead()) {
			return true
		}
		const since = new Date(cachedAtMs)
		const fromDay = filters.fromDate ? this.toUtcDay(filters.fromDate) : undefined
		const toDay = filters.toDate ? this.toUtcDay(filters.toDate) : undefined
		const currentMonthStart = this.startOfUtcMonth(new Date())
		const finalizedConditions = [
			eq(taxMemberContributionFinalizedRollups.corporationId, filters.corporationId),
			lt(taxMemberContributionFinalizedRollups.periodEnd, currentMonthStart),
		]
		const projectionConditions = [
			eq(taxMemberContributionProjectionRollups.corporationId, filters.corporationId),
			gte(taxMemberContributionProjectionRollups.periodEnd, currentMonthStart),
		]
		finalizedConditions.push(gte(taxMemberContributionFinalizedRollups.updatedAt, since))
		projectionConditions.push(gte(taxMemberContributionProjectionRollups.updatedAt, since))
		if (fromDay) {
			finalizedConditions.push(gte(taxMemberContributionFinalizedRollups.rollupDate, fromDay))
			projectionConditions.push(gte(taxMemberContributionProjectionRollups.rollupDate, fromDay))
		}
		if (toDay) {
			finalizedConditions.push(lte(taxMemberContributionFinalizedRollups.rollupDate, toDay))
			projectionConditions.push(lte(taxMemberContributionProjectionRollups.rollupDate, toDay))
		}
		const [finalizedUpdate, projectionUpdate] = await Promise.all([
			this.db.query.taxMemberContributionFinalizedRollups.findFirst({
				where: and(...finalizedConditions),
				columns: { id: true },
			}),
			this.db.query.taxMemberContributionProjectionRollups.findFirst({
				where: and(...projectionConditions),
				columns: { id: true },
			}),
		])
		return Boolean(finalizedUpdate || projectionUpdate)
	}

	private async getMemberSummaryFromRollupsSql(input: {
		corporationId: string
		characterIds?: string[]
		includeUnattributedRow: boolean
		refTypes?: string[]
		fromDate?: Date
		toDate?: Date
		topRefTypesLimit?: number
		limit?: number
		offset?: number
		sortBy?: TaxMemberSummaryReportFilters['sortBy']
		sortDirection?: TaxMemberSummaryReportFilters['sortDirection']
	}): Promise<TaxPagedResult<TaxMemberSummary>> {
		const fromDay = input.fromDate ? this.toUtcDay(input.fromDate) : undefined
		const toDay = input.toDate ? this.toUtcDay(input.toDate) : undefined
		const buildRollupWhere = (alias: string) => {
			const refTypeFilter = input.refTypes?.length
				? sql`AND ${sql.raw(alias)}.ref_type IN (${sql.join(
						input.refTypes.map((refType) => sql`${refType}`),
						sql`, `
					)})`
				: sql``
			const characterFilter = input.characterIds?.length
				? sql`AND (
					${sql.raw(alias)}.character_id IN (${sql.join(
						input.characterIds.map((characterId) => sql`${characterId}`),
						sql`, `
					)})
					${input.includeUnattributedRow ? sql`OR ${sql.raw(alias)}.character_id = ${UNATTRIBUTED_CHARACTER_ID}` : sql``}
				)`
				: sql``
			return sql`
				${sql.raw(alias)}.corporation_id = ${input.corporationId}
				${fromDay ? sql`AND ${sql.raw(alias)}.rollup_date >= ${fromDay}` : sql``}
				${toDay ? sql`AND ${sql.raw(alias)}.rollup_date <= ${toDay}` : sql``}
				${characterFilter}
				${refTypeFilter}
			`
		}
		const finalizedWhere = buildRollupWhere('finalized')
		const projectionWhere = sql`
			${buildRollupWhere('projection')}
			AND NOT EXISTS (
				SELECT 1
				FROM ${taxMemberContributionFinalizedRollups} AS finalized_match
				WHERE finalized_match.corporation_id = projection.corporation_id
					AND finalized_match.period_start = projection.period_start
					AND finalized_match.period_end = projection.period_end
					AND finalized_match.rollup_date = projection.rollup_date
					AND finalized_match.character_id = projection.character_id
					AND finalized_match.ref_type = projection.ref_type
			)
		`
		const rollupCte = sql`
			WITH rollup_rows AS (
				SELECT
					finalized.character_id,
					finalized.ref_type,
					finalized.contribution_income,
					finalized.taxable_contribution_income,
					finalized.assessment_count,
					finalized.source_row_count,
					finalized.last_assessment_at
				FROM ${taxMemberContributionFinalizedRollups} AS finalized
				WHERE ${finalizedWhere}
				UNION ALL
				SELECT
					projection.character_id,
					projection.ref_type,
					projection.contribution_income,
					projection.taxable_contribution_income,
					projection.assessment_count,
					projection.source_row_count,
					projection.last_assessment_at
				FROM ${taxMemberContributionProjectionRollups} AS projection
				WHERE ${projectionWhere}
			), character_totals AS (
				SELECT
					character_id,
					SUM(contribution_income::numeric) AS contribution_income,
					SUM(taxable_contribution_income::numeric) AS taxable_contribution_income,
					MAX(assessment_count)::int AS assessment_count,
					MAX(last_assessment_at) AS last_assessment_at
				FROM rollup_rows
				GROUP BY character_id
			)
		`
		const sourceRollupCte = sql`
			WITH rollup_rows AS (
				SELECT
					finalized.character_id,
					finalized.ref_type,
					finalized.contribution_income,
					finalized.taxable_contribution_income,
					finalized.source_row_count
				FROM ${taxMemberContributionFinalizedRollups} AS finalized
				WHERE ${finalizedWhere}
				UNION ALL
				SELECT
					projection.character_id,
					projection.ref_type,
					projection.contribution_income,
					projection.taxable_contribution_income,
					projection.source_row_count
				FROM ${taxMemberContributionProjectionRollups} AS projection
				WHERE ${projectionWhere}
			)
		`
		const sortColumn = (() => {
			switch (input.sortBy) {
				case 'characterId':
					return 'character_id'
				case 'taxableContributionIncome':
					return 'taxable_contribution_income'
				case 'assessmentCount':
					return 'assessment_count'
				case 'lastAssessmentAt':
					return 'last_assessment_at'
				case 'contributionIncome':
				default:
					return 'contribution_income'
			}
		})()
		const sortDirection = input.sortDirection === 'asc' ? 'ASC' : 'DESC'
		const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
		const offset = Math.max(input.offset ?? 0, 0)

		const pageResult = await this.db.execute(sql`
			${rollupCte}
			SELECT
				character_id,
				contribution_income,
				taxable_contribution_income,
				assessment_count,
				last_assessment_at,
				COUNT(*) OVER()::int AS total_rows
			FROM character_totals
			ORDER BY ${sql.raw(sortColumn)} ${sql.raw(sortDirection)}, character_id ASC
			LIMIT ${limit}
			OFFSET ${offset}
		`)
		const pageRows = pageResult.rows as Array<Record<string, unknown>>
		let totalRows = Number(pageRows[0]?.total_rows ?? 0)
		if (pageRows.length === 0 && offset > 0) {
			const countResult = await this.db.execute(sql`
				${rollupCte}
				SELECT COUNT(*)::int AS total_rows
				FROM character_totals
			`)
			totalRows = Number((countResult.rows as Array<Record<string, unknown>>)[0]?.total_rows ?? 0)
		}
		const pageCharacterIds = pageRows.map((row) => String(row.character_id))
		const topRefTypeTotals = new Map<
			string,
			Array<{
				refType: string
				lineCount: number
				contributionAmount: string
				taxableAmount: string
			}>
		>()

		if (pageCharacterIds.length > 0) {
			const sourceResult = await this.db.execute(sql`
				${sourceRollupCte}
				SELECT
					character_id,
					ref_type,
					SUM(contribution_income::numeric) AS contribution_income,
					SUM(taxable_contribution_income::numeric) AS taxable_contribution_income,
					SUM(source_row_count)::int AS line_count
				FROM rollup_rows
				WHERE character_id IN (${sql.join(
					pageCharacterIds.map((characterId) => sql`${characterId}`),
					sql`, `
				)})
				GROUP BY character_id, ref_type
				ORDER BY character_id ASC, SUM(contribution_income::numeric) DESC, ref_type ASC
			`)
			for (const row of sourceResult.rows as Array<Record<string, unknown>>) {
				const characterId = String(row.character_id)
				const sourceRows = topRefTypeTotals.get(characterId) ?? []
				if (input.topRefTypesLimit === undefined || sourceRows.length < input.topRefTypesLimit) {
					sourceRows.push({
						refType: String(row.ref_type),
						lineCount: Number(row.line_count ?? 0),
						contributionAmount: String(row.contribution_income ?? '0'),
						taxableAmount: String(row.taxable_contribution_income ?? '0'),
					})
				}
				topRefTypeTotals.set(characterId, sourceRows)
			}
		}

		return {
			rows: pageRows.map((row) => {
				const characterId = String(row.character_id)
				const topRefTypes = topRefTypeTotals.get(characterId) ?? []
				return {
					corporationId: input.corporationId,
					characterId,
					fromDate: input.fromDate ?? null,
					toDate: input.toDate ?? null,
					assessmentCount: Number(row.assessment_count ?? 0),
					contributionIncome: String(row.contribution_income ?? '0'),
					taxableContributionIncome: String(row.taxable_contribution_income ?? '0'),
					lastAssessmentAt: row.last_assessment_at
						? new Date(String(row.last_assessment_at))
						: null,
					topRefTypes: topRefTypes.map((source) => ({
						...source,
						taxAmount: source.taxableAmount,
					})),
				}
			}),
			totalRows,
		}
	}

	private async getMemberSummaryFromRollups(input: {
		corporationId: string
		fromDate?: Date
		toDate?: Date
		scopedCharacterIds: string[]
		scopedCharacterIdSet: Set<string>
		includeUnattributedRow: boolean
		topRefTypesLimit: number | null
		refTypes?: string[]
	}): Promise<TaxMemberSummary[]> {
		const fromDay = input.fromDate ? this.toUtcDay(input.fromDate) : undefined
		const toDay = input.toDate ? this.toUtcDay(input.toDate) : undefined
		const currentMonthStart = this.startOfUtcMonth(new Date())
		const finalizedConditions = [
			eq(taxMemberContributionFinalizedRollups.corporationId, input.corporationId),
			lt(taxMemberContributionFinalizedRollups.periodEnd, currentMonthStart),
		]
		const projectionConditions = [
			eq(taxMemberContributionProjectionRollups.corporationId, input.corporationId),
			gte(taxMemberContributionProjectionRollups.periodEnd, currentMonthStart),
		]
		if (fromDay) {
			finalizedConditions.push(gte(taxMemberContributionFinalizedRollups.rollupDate, fromDay))
			projectionConditions.push(gte(taxMemberContributionProjectionRollups.rollupDate, fromDay))
		}
		if (toDay) {
			finalizedConditions.push(lte(taxMemberContributionFinalizedRollups.rollupDate, toDay))
			projectionConditions.push(lte(taxMemberContributionProjectionRollups.rollupDate, toDay))
		}
		if (input.refTypes && input.refTypes.length > 0) {
			finalizedConditions.push(
				inArray(taxMemberContributionFinalizedRollups.refType, input.refTypes)
			)
			projectionConditions.push(
				inArray(taxMemberContributionProjectionRollups.refType, input.refTypes)
			)
		}

		const [fetchedFinalizedRows, fetchedProjectionRows] = await Promise.all([
			this.fetchAllFinalizedRollupRows(and(...finalizedConditions)),
			this.fetchAllProjectionRollupRows(and(...projectionConditions)),
		])
		const finalizedRows = fetchedFinalizedRows.filter((row) => row.periodEnd < currentMonthStart)
		const projectionRows = fetchedProjectionRows.filter((row) => row.periodEnd >= currentMonthStart)
		if (finalizedRows.length === 0 && projectionRows.length === 0) {
			return []
		}

		const rolled = new Map<
			string,
			{
				characterId: string
				refType: string
				contributionIncomeCenti: bigint
				taxableContributionIncomeCenti: bigint
				assessmentCount: number
				lineCount: number
				lastAssessmentAt: Date | null
			}
		>()
		const putRow = (row: {
			rollupDate: Date
			characterId: string
			refType: string
			contributionIncome: string
			taxableContributionIncome: string
			assessmentCount: number
			sourceRowCount: number
			lastAssessmentAt: Date | null
		}) => {
			if (
				row.characterId !== '__unattributed__' &&
				input.scopedCharacterIdSet.size > 0 &&
				!input.scopedCharacterIdSet.has(row.characterId)
			) {
				return
			}
			if (row.characterId === '__unattributed__' && !input.includeUnattributedRow) {
				return
			}
			const key = `${row.characterId}:${row.refType}`
			const current = rolled.get(key) ?? {
				characterId: row.characterId,
				refType: row.refType,
				contributionIncomeCenti: 0n,
				taxableContributionIncomeCenti: 0n,
				assessmentCount: 0,
				lineCount: 0,
				lastAssessmentAt: null,
			}
			current.contributionIncomeCenti += this.parseDecimalToCenti(row.contributionIncome)
			current.taxableContributionIncomeCenti += this.parseDecimalToCenti(
				row.taxableContributionIncome
			)
			current.assessmentCount = Math.max(current.assessmentCount, row.assessmentCount)
			current.lineCount += row.sourceRowCount
			current.lastAssessmentAt =
				!current.lastAssessmentAt ||
				(row.lastAssessmentAt && row.lastAssessmentAt > current.lastAssessmentAt)
					? row.lastAssessmentAt
					: current.lastAssessmentAt
			rolled.set(key, current)
		}

		for (const row of projectionRows) {
			putRow(row)
		}
		for (const row of finalizedRows) {
			putRow(row)
		}

		const byCharacter = new Map<
			string,
			{
				assessmentCount: number
				contributionIncomeCenti: bigint
				taxableContributionIncomeCenti: bigint
				lastAssessmentAt: Date | null
				byRefType: Map<
					string,
					{
						lineCount: number
						contributionIncomeCenti: bigint
						taxableContributionIncomeCenti: bigint
					}
				>
			}
		>()
		for (const row of rolled.values()) {
			const current = byCharacter.get(row.characterId) ?? {
				assessmentCount: 0,
				contributionIncomeCenti: 0n,
				taxableContributionIncomeCenti: 0n,
				lastAssessmentAt: null,
				byRefType: new Map<
					string,
					{
						lineCount: number
						contributionIncomeCenti: bigint
						taxableContributionIncomeCenti: bigint
					}
				>(),
			}
			current.assessmentCount = Math.max(current.assessmentCount, row.assessmentCount)
			current.contributionIncomeCenti += row.contributionIncomeCenti
			current.taxableContributionIncomeCenti += row.taxableContributionIncomeCenti
			current.lastAssessmentAt =
				!current.lastAssessmentAt ||
				(row.lastAssessmentAt && row.lastAssessmentAt > current.lastAssessmentAt)
					? row.lastAssessmentAt
					: current.lastAssessmentAt
			const ref = current.byRefType.get(row.refType) ?? {
				lineCount: 0,
				contributionIncomeCenti: 0n,
				taxableContributionIncomeCenti: 0n,
			}
			ref.lineCount += row.lineCount
			ref.contributionIncomeCenti += row.contributionIncomeCenti
			ref.taxableContributionIncomeCenti += row.taxableContributionIncomeCenti
			current.byRefType.set(row.refType, ref)
			byCharacter.set(row.characterId, current)
		}

		const characterIdsToReturn =
			input.scopedCharacterIds.length > 0
				? input.scopedCharacterIds
				: Array.from(byCharacter.keys())
						.filter((characterId) => characterId !== '__unattributed__')
						.sort((a, b) => a.localeCompare(b))

		const rows = characterIdsToReturn
			.map((characterId): TaxMemberSummary | null => {
				const summary = byCharacter.get(characterId)
				if (!summary) {
					return null
				}
				const sortedTopRefTypes = Array.from(summary.byRefType.entries()).sort((a, b) => {
					if (a[1].contributionIncomeCenti === b[1].contributionIncomeCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].contributionIncomeCenti > b[1].contributionIncomeCenti ? -1 : 1
				})
				const topRefTypes = (
					input.topRefTypesLimit
						? sortedTopRefTypes.slice(0, input.topRefTypesLimit)
						: sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
					contributionAmount: this.formatCenti(totals.contributionIncomeCenti),
					taxableAmount: this.formatCenti(totals.taxableContributionIncomeCenti),
					taxAmount: this.formatCenti(totals.taxableContributionIncomeCenti),
				}))
				return {
					corporationId: input.corporationId,
					characterId,
					fromDate: input.fromDate ?? null,
					toDate: input.toDate ?? null,
					assessmentCount: summary.assessmentCount,
					contributionIncome: this.formatCenti(summary.contributionIncomeCenti),
					taxableContributionIncome: this.formatCenti(summary.taxableContributionIncomeCenti),
					lastAssessmentAt: summary.lastAssessmentAt,
					topRefTypes,
				}
			})
			.filter((row): row is NonNullable<typeof row> => row !== null)

		if (input.includeUnattributedRow) {
			const unattributed = byCharacter.get('__unattributed__')
			if (unattributed) {
				const sortedTopRefTypes = Array.from(unattributed.byRefType.entries()).sort((a, b) => {
					if (a[1].contributionIncomeCenti === b[1].contributionIncomeCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].contributionIncomeCenti > b[1].contributionIncomeCenti ? -1 : 1
				})
				const topRefTypes = (
					input.topRefTypesLimit
						? sortedTopRefTypes.slice(0, input.topRefTypesLimit)
						: sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
					contributionAmount: this.formatCenti(totals.contributionIncomeCenti),
					taxableAmount: this.formatCenti(totals.taxableContributionIncomeCenti),
					taxAmount: this.formatCenti(totals.taxableContributionIncomeCenti),
				}))
				rows.unshift({
					corporationId: input.corporationId,
					characterId: '__unattributed__',
					fromDate: input.fromDate ?? null,
					toDate: input.toDate ?? null,
					assessmentCount: unattributed.assessmentCount,
					contributionIncome: this.formatCenti(unattributed.contributionIncomeCenti),
					taxableContributionIncome: this.formatCenti(unattributed.taxableContributionIncomeCenti),
					lastAssessmentAt: unattributed.lastAssessmentAt,
					topRefTypes,
				})
			}
		}

		return rows
	}

	private toUtcDay(date: Date): Date {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
	}

	private startOfUtcMonth(date: Date): Date {
		return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
	}

	private toMemberSummaryCacheKey(filters: TaxMemberSummaryReportFilters): string {
		return [
			filters.corporationId,
			filters.fromDate?.toISOString() ?? '',
			filters.toDate?.toISOString() ?? '',
			filters.topRefTypesLimit ?? '',
			filterTaxIncomeRefTypes(filters.refTypes)?.join(',') ?? '',
		].join('|')
	}

	private filterMemberSummaryRowsForRequest(
		rows: TaxMemberSummary[],
		requestedCharacterIds: string[]
	): TaxMemberSummary[] {
		if (requestedCharacterIds.length === 0) {
			return rows
		}
		const requestedSet = new Set(requestedCharacterIds)
		return rows.filter((row) => requestedSet.has(row.characterId))
	}

	private toPagedMemberSummaryResult(
		rows: TaxMemberSummary[],
		filters: TaxMemberSummaryReportFilters
	): TaxPagedResult<TaxMemberSummary> {
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const offset = Math.max(filters.offset ?? 0, 0)
		const sortBy = filters.sortBy ?? 'contributionIncome'
		const sortDirection = toSortDirection(filters.sortDirection, 'desc')
		const sorted = [...rows].sort((left, right) =>
			this.compareMemberSummaryRows(left, right, sortBy, sortDirection)
		)
		return {
			rows: sorted.slice(offset, offset + limit),
			totalRows: sorted.length,
		}
	}

	private compareMemberSummaryRows(
		left: TaxMemberSummary,
		right: TaxMemberSummary,
		sortBy: NonNullable<TaxMemberSummaryReportFilters['sortBy']>,
		sortDirection: 'asc' | 'desc'
	): number {
		const direction = sortDirection === 'asc' ? 1 : -1
		switch (sortBy) {
			case 'characterId': {
				return left.characterId.localeCompare(right.characterId) * direction
			}
			case 'assessmentCount': {
				if (left.assessmentCount !== right.assessmentCount) {
					return (left.assessmentCount - right.assessmentCount) * direction
				}
				return left.characterId.localeCompare(right.characterId) * direction
			}
			case 'lastAssessmentAt': {
				const leftTime = left.lastAssessmentAt ? left.lastAssessmentAt.getTime() : 0
				const rightTime = right.lastAssessmentAt ? right.lastAssessmentAt.getTime() : 0
				if (leftTime !== rightTime) {
					return (leftTime - rightTime) * direction
				}
				return left.characterId.localeCompare(right.characterId) * direction
			}
			case 'taxableContributionIncome': {
				const leftValue = this.parseDecimalToCenti(left.taxableContributionIncome)
				const rightValue = this.parseDecimalToCenti(right.taxableContributionIncome)
				if (leftValue !== rightValue) {
					return leftValue > rightValue ? direction : -direction
				}
				return left.characterId.localeCompare(right.characterId) * direction
			}
			case 'contributionIncome':
			default: {
				const leftValue = this.parseDecimalToCenti(left.contributionIncome)
				const rightValue = this.parseDecimalToCenti(right.contributionIncome)
				if (leftValue !== rightValue) {
					return leftValue > rightValue ? direction : -direction
				}
				return left.characterId.localeCompare(right.characterId) * direction
			}
		}
	}

	private async getMemberSummaryVersions(corporationId: string): Promise<{
		projectionVersion: number
		finalizedVersion: number
	}> {
		if (!this.supportsMemberSummaryVersioning()) {
			return {
				projectionVersion: 0,
				finalizedVersion: 0,
			}
		}
		const row = await this.db.query.taxMemberSummaryVersions.findFirst({
			where: eq(taxMemberSummaryVersions.corporationId, corporationId),
		})
		return {
			projectionVersion: row?.projectionVersion ?? 0,
			finalizedVersion: row?.finalizedVersion ?? 0,
		}
	}

	private supportsMemberSummaryVersioning(): boolean {
		return Boolean(
			this.db.query && (this.db.query as Record<string, unknown>).taxMemberSummaryVersions
		)
	}

	private supportsMemberSummaryRollupRead(): boolean {
		return Boolean(
			this.db.query &&
				(this.db.query as Record<string, unknown>).taxMemberContributionFinalizedRollups &&
				(this.db.query as Record<string, unknown>).taxMemberContributionProjectionRollups
		)
	}

	private async fetchAllProjectionRollupRows(
		where: ReturnType<typeof and>
	): Promise<Array<typeof taxMemberContributionProjectionRollups.$inferSelect>> {
		return this.fetchAllRowsByOffset((offset, limit) =>
			this.db.query.taxMemberContributionProjectionRollups.findMany({
				where,
				orderBy: [
					asc(taxMemberContributionProjectionRollups.rollupDate),
					asc(taxMemberContributionProjectionRollups.characterId),
					asc(taxMemberContributionProjectionRollups.refType),
					asc(taxMemberContributionProjectionRollups.periodStart),
					asc(taxMemberContributionProjectionRollups.periodEnd),
				],
				limit,
				offset,
			})
		)
	}

	private async fetchAllFinalizedRollupRows(
		where: ReturnType<typeof and>
	): Promise<Array<typeof taxMemberContributionFinalizedRollups.$inferSelect>> {
		return this.fetchAllRowsByOffset((offset, limit) =>
			this.db.query.taxMemberContributionFinalizedRollups.findMany({
				where,
				orderBy: [
					asc(taxMemberContributionFinalizedRollups.rollupDate),
					asc(taxMemberContributionFinalizedRollups.characterId),
					asc(taxMemberContributionFinalizedRollups.refType),
					asc(taxMemberContributionFinalizedRollups.periodStart),
					asc(taxMemberContributionFinalizedRollups.periodEnd),
				],
				limit,
				offset,
			})
		)
	}

	private async fetchAllRowsByOffset<Row>(
		fetchPage: (offset: number, limit: number) => Promise<Row[]>,
		pageSize = 10_000
	): Promise<Row[]> {
		const allRows: Row[] = []
		let offset = 0

		for (;;) {
			const rows = await fetchPage(offset, pageSize)
			if (rows.length === 0) {
				break
			}
			allRows.push(...rows)
			if (rows.length < pageSize) {
				break
			}
			offset += rows.length
		}

		return allRows
	}

	private setMemberSummaryCache(
		cacheKey: string,
		entry: {
			rows: TaxMemberSummary[]
			cachedAtMs: number
			expiresAtMs: number
			projectionVersion: number
			finalizedVersion: number
		}
	): void {
		if (this.memberSummaryCache.size >= this.MEMBER_SUMMARY_CACHE_MAX_ENTRIES) {
			const oldestKey = this.memberSummaryCache.keys().next().value
			if (oldestKey && oldestKey !== cacheKey) {
				this.memberSummaryCache.delete(oldestKey)
			}
		}
		this.memberSummaryCache.set(cacheKey, entry)
		const totalCacheOps =
			this.memberSummaryCacheHits +
			this.memberSummaryCacheMisses +
			this.memberSummaryCacheDeltaChecks
		if (totalCacheOps > 0 && totalCacheOps % 200 === 0) {
			logger.info('[TaxReportService] Member summary cache stats', {
				cacheEntries: this.memberSummaryCache.size,
				cacheHits: this.memberSummaryCacheHits,
				cacheMisses: this.memberSummaryCacheMisses,
				deltaChecks: this.memberSummaryCacheDeltaChecks,
			})
		}
	}

	private buildAssessmentWhere(
		filters: TaxRollupReportFilters,
		corporationIds: string[],
		assessmentScope?: 'corporation' | 'division' | 'character'
	) {
		const conditions = [inArray(taxAssessments.corporationId, corporationIds)]
		if (assessmentScope) {
			conditions.push(eq(taxAssessments.assessmentScope, assessmentScope))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxAssessments.taxPeriodStart, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxAssessments.taxPeriodEnd, filters.toDate))
		}
		return and(...conditions)
	}

	private buildLedgerWhere(filters: TaxRollupReportFilters, corporationIds: string[]) {
		return this.buildLedgerWhereInternal(filters, corporationIds, { essOnly: false })
	}

	private buildEssLedgerWhere(filters: TaxRollupReportFilters, corporationIds: string[]) {
		return this.buildLedgerWhereInternal(filters, corporationIds, { essOnly: true })
	}

	private buildLedgerWhereInternal(
		filters: TaxRollupReportFilters,
		corporationIds: string[],
		options: { essOnly: boolean }
	) {
		const conditions = [inArray(taxLedgerEntries.corporationId, corporationIds)]
		if (options.essOnly) {
			conditions.push(eq(taxLedgerEntries.refType, 'ess_escrow_transfer'))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxLedgerEntries.entryDate, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxLedgerEntries.entryDate, filters.toDate))
		}
		return and(...conditions)
	}

	private buildDiscrepancyWhere(
		filters: { corporationId?: string; fromDate?: Date; toDate?: Date; onlyOpen?: boolean },
		corporationIds: string[]
	) {
		const conditions = [inArray(taxDiscrepancies.corporationId, corporationIds)]
		if (filters.fromDate) {
			conditions.push(gte(taxDiscrepancies.createdAt, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxDiscrepancies.createdAt, filters.toDate))
		}
		if (filters.onlyOpen) {
			conditions.push(isNull(taxDiscrepancies.resolvedAt))
		}
		return and(...conditions)
	}

	private toDateOrNull(value: Date | string | null | undefined): Date | null {
		if (!value) {
			return null
		}
		if (value instanceof Date) {
			return Number.isNaN(value.getTime()) ? null : value
		}
		const parsed = new Date(value)
		return Number.isNaN(parsed.getTime()) ? null : parsed
	}

	private toInteger(value: number | string | bigint | null | undefined): number {
		if (value === null || value === undefined) {
			return 0
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value : 0
		}
		if (typeof value === 'bigint') {
			return Number(value)
		}
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : 0
	}

	private async resolveReportCorporationIds(corporationId?: string): Promise<string[]> {
		if (corporationId) {
			return [corporationId]
		}
		return this.listDataBackedCorporationIds()
	}

	private async listDataBackedCorporationIds(): Promise<string[]> {
		const [assessmentRows, ledgerRows, discrepancyRows] = await Promise.all([
			this.db
				.select({
					corporationId: taxAssessments.corporationId,
				})
				.from(taxAssessments)
				.groupBy(taxAssessments.corporationId),
			this.db
				.select({
					corporationId: taxLedgerEntries.corporationId,
				})
				.from(taxLedgerEntries)
				.groupBy(taxLedgerEntries.corporationId),
			this.db
				.select({
					corporationId: taxDiscrepancies.corporationId,
				})
				.from(taxDiscrepancies)
				.groupBy(taxDiscrepancies.corporationId),
		])

		return Array.from(
			new Set([
				...assessmentRows.map((row) => row.corporationId),
				...ledgerRows.map((row) => row.corporationId),
				...discrepancyRows.map((row) => row.corporationId),
			])
		).sort((a, b) => a.localeCompare(b))
	}

	private async listKnownCorporationIds(corporationId?: string): Promise<string[]> {
		if (corporationId) {
			return [corporationId]
		}

		const rows = await this.db
			.select({
				corporationId: managedCorporations.corporationId,
			})
			.from(managedCorporations)
			.where(eq(managedCorporations.isActive, true))
			.groupBy(managedCorporations.corporationId)
		return rows.map((row) => row.corporationId)
	}

	private async listExclusions(corporationId?: string) {
		const [explicitRows, attachedRuleRows, knownCorporationIds] = await Promise.all([
			this.db.query.taxCorporationExclusions.findMany({
				where: corporationId
					? eq(taxCorporationExclusions.corporationId, corporationId)
					: undefined,
			}),
			this.db
				.select({
					corporationId: taxRuleGroupAttachments.corporationId,
				})
				.from(taxRuleGroupAttachments)
				.where(corporationId ? eq(taxRuleGroupAttachments.corporationId, corporationId) : undefined)
				.groupBy(taxRuleGroupAttachments.corporationId),
			this.listKnownCorporationIds(corporationId),
		])

		const byCorporationId = new Map(explicitRows.map((row) => [row.corporationId, row]))
		const attachedSet = new Set(attachedRuleRows.map((row) => row.corporationId))
		for (const corpId of knownCorporationIds) {
			if (!attachedSet.has(corpId) && !byCorporationId.has(corpId)) {
				byCorporationId.set(corpId, {
					corporationId: corpId,
					reason: 'no_attached_rule_groups',
					createdBy: 'system:rule-attachment-scope',
					updatedBy: 'system:rule-attachment-scope',
					createdAt: new Date(0),
					updatedAt: new Date(0),
				})
			}
		}

		return Array.from(byCorporationId.values())
	}

	private async getCorporationEsiAuthStatus(corporationId: string) {
		try {
			const stub = getStub<EveCorporationData>(this.eveCorporationDataNamespace, corporationId)
			const status = await stub.getCorporationAuthStatus(corporationId)
			return {
				isConfigured: status.isConfigured,
				isVerified: status.isVerified,
				lastVerified: status.lastVerified,
				directorCount: status.directorCount,
				healthyDirectorCount: status.healthyDirectorCount,
				requiredScopes: status.requiredScopes,
				missingRequiredScopes: status.missingRequiredScopes,
				hasRequiredScopes: status.hasRequiredScopes,
				hasCorporationWalletScope: status.hasCorporationWalletScope,
				hasCharacterWalletScope: status.hasCharacterWalletScope,
				hasCorporationMembershipScope: status.hasCorporationMembershipScope,
				grantedScopeCount: status.grantedScopeCount,
			}
		} catch {
			return null
		}
	}

	private async getCorporationMemberIds(corporationId: string): Promise<string[]> {
		try {
			const stub = getStub<EveCorporationData>(this.eveCorporationDataNamespace, corporationId)
			const members = await stub.getMembers(corporationId)
			return members.map((member) => member.characterId)
		} catch {
			return []
		}
	}

	private parseDecimalToCenti(value: string | number | bigint | null | undefined): bigint {
		return parseMoneyToCenti(value)
	}

	private formatCenti(value: bigint): string {
		return formatMoneyCenti(value, { fixedScale: true })
	}
}
