import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from '@repo/db-utils'
import { logger } from '@repo/hono-helpers'

import {
	taxAssessmentLines,
	taxAssessments,
	taxCorporationSettings,
	taxDailyRollups,
	taxDiscrepancies,
	taxLedgerEntries,
	taxMemberContributionFinalizedRollups,
	taxMemberContributionProjectionRollups,
	taxMemberSummaryVersions,
} from '../db/schema'

import type {
	ListTaxDiscrepancyReportFilters,
	ListTaxExcludedCorporationsReportFilters,
	ListTaxMissingEsiKeyReportFilters,
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExcludedCorporationRow,
	TaxMemberSummary,
	TaxMemberSummaryReportFilters,
	TaxMissingEsiKeyRow,
	TaxReportWindowFilters,
	TaxSummaryReport,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
} from '@repo/corporation-tax'
import type { CorporationTaxDb } from '../db'
import type { TaxSettingsService } from './tax-settings.service'

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
		private settingsService: TaxSettingsService
	) {}

	async getSummaryReport(filters: TaxReportWindowFilters = {}): Promise<TaxSummaryReport> {
		const [corporationIds, settingsRows] = await Promise.all([
			this.resolveIncludedCorporationIds(filters.corporationId),
			this.db.query.taxCorporationSettings.findMany({
				where: filters.corporationId
					? eq(taxCorporationSettings.corporationId, filters.corporationId)
					: undefined,
				limit: 10_000,
			}),
		])

		if (corporationIds.length === 0) {
			return {
				corporationId: filters.corporationId ?? null,
				fromDate: filters.fromDate ?? null,
				toDate: filters.toDate ?? null,
				assessmentCount: 0,
				discrepancyOpenCount: 0,
				includedCorporationCount: settingsRows.filter((row) => row.included).length,
				excludedCorporationCount: settingsRows.filter((row) => !row.included).length,
				billedAssessmentCount: 0,
				taxableIncome: '0.00',
				taxDue: '0.00',
				taxPaid: '0.00',
				taxDelta: '0.00',
				essIncome: '0.00',
				essTransferCount: 0,
			}
		}

		const [assessments, openDiscrepancies, essEntries] = await Promise.all([
			this.db.query.taxAssessments.findMany({
				where: this.buildAssessmentWhere(filters, corporationIds, 'corporation'),
				limit: 10_000,
			}),
			this.db.query.taxDiscrepancies.findMany({
				where: this.buildDiscrepancyWhere(
					{
						corporationId: filters.corporationId,
						onlyOpen: true,
					},
					corporationIds
				),
				limit: 10_000,
			}),
			this.db.query.taxLedgerEntries.findMany({
				where: this.buildEssLedgerWhere(filters, corporationIds),
				limit: 10_000,
			}),
		])
		const filteredEssEntries = essEntries.filter((row) =>
			this.matchesAmountThreshold(row.amount, filters.minAmount, filters.maxAmount)
		)

		let taxableIncomeCenti = 0n
		let taxDueCenti = 0n
		let taxPaidCenti = 0n
		let taxDeltaCenti = 0n
		let billedAssessmentCount = 0

		for (const row of assessments) {
			taxableIncomeCenti += this.parseDecimalToCenti(row.taxableIncome)
			taxDueCenti += this.parseDecimalToCenti(row.taxDue)
			taxPaidCenti += this.parseDecimalToCenti(row.taxPaid)
			taxDeltaCenti += this.parseDecimalToCenti(row.taxDelta)
			if (row.billId) {
				billedAssessmentCount += 1
			}
		}

		let essIncomeCenti = 0n
		for (const row of filteredEssEntries) {
			const amountCenti = this.parseDecimalToCenti(row.amount)
			if (amountCenti > 0n) {
				essIncomeCenti += amountCenti
			}
		}

		return {
			corporationId: filters.corporationId ?? null,
			fromDate: filters.fromDate ?? null,
			toDate: filters.toDate ?? null,
			assessmentCount: assessments.length,
			discrepancyOpenCount: openDiscrepancies.length,
			includedCorporationCount: settingsRows.filter((row) => row.included).length,
			excludedCorporationCount: settingsRows.filter((row) => !row.included).length,
			billedAssessmentCount,
			taxableIncome: this.formatCenti(taxableIncomeCenti),
			taxDue: this.formatCenti(taxDueCenti),
			taxPaid: this.formatCenti(taxPaidCenti),
			taxDelta: this.formatCenti(taxDeltaCenti),
			essIncome: this.formatCenti(essIncomeCenti),
			essTransferCount: filteredEssEntries.length,
		}
	}

	async getTotalTaxesByCorporationReport(
		filters: TaxReportWindowFilters = {}
	): Promise<TaxTotalTaxesByCorporationRow[]> {
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const rows = await this.db
			.select({
				corporationId: taxAssessments.corporationId,
				assessmentCount: sql<number>`COUNT(*)`,
				billedAssessmentCount: sql<number>`SUM(CASE WHEN ${taxAssessments.billId} IS NOT NULL THEN 1 ELSE 0 END)`,
				underpaidCount: sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'underpaid' THEN 1 ELSE 0 END)`,
				paidCount: sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'paid' THEN 1 ELSE 0 END)`,
				overpaidCount: sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'overpaid' THEN 1 ELSE 0 END)`,
				draftCount: sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'draft' THEN 1 ELSE 0 END)`,
				excludedCount: sql<number>`SUM(CASE WHEN ${taxAssessments.status} = 'excluded' THEN 1 ELSE 0 END)`,
				taxableIncome: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxableIncome} AS numeric)), 0)::text`,
				taxDue: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0)::text`,
				taxPaid: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxPaid} AS numeric)), 0)::text`,
				taxDelta: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDelta} AS numeric)), 0)::text`,
				lastAssessmentAt: sql<Date | null>`MAX(${taxAssessments.taxPeriodEnd})`,
			})
			.from(taxAssessments)
			.where(this.buildAssessmentWhere(filters, corporationIds, 'corporation'))
			.groupBy(taxAssessments.corporationId)

		const grouped = rows.map((row) => ({
			corporationId: row.corporationId,
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
			lastAssessmentAt: row.lastAssessmentAt ? new Date(row.lastAssessmentAt) : null,
			taxDueCenti: this.parseDecimalToCenti(row.taxDue),
			sortKey: this.parseDecimalToCenti(row.taxDue),
		}))

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'taxDue'
		const sortDirection = this.toSortDirection(filters.sortDirection, 'desc')

		return grouped
			.sort((a, b) => {
				switch (sortBy) {
					case 'corporationId':
						return this.compareStrings(a.corporationId, b.corporationId, sortDirection)
					case 'assessmentCount':
						return this.compareNumbers(a.assessmentCount, b.assessmentCount, sortDirection)
					case 'taxPaid':
						return this.compareBigInts(
							this.parseDecimalToCenti(a.taxPaid),
							this.parseDecimalToCenti(b.taxPaid),
							sortDirection
						)
					case 'taxDelta':
						return this.compareBigInts(
							this.parseDecimalToCenti(a.taxDelta),
							this.parseDecimalToCenti(b.taxDelta),
							sortDirection
						)
					case 'lastAssessmentAt':
						return this.compareDatesNullable(a.lastAssessmentAt, b.lastAssessmentAt, sortDirection)
					case 'taxDue':
					default:
						return this.compareBigInts(a.sortKey, b.sortKey, sortDirection)
				}
			})
			.slice(offset, offset + limit)
			.map(({ taxDueCenti: _taxDueCenti, sortKey: _sortKey, ...row }) => row)
	}

	async getTopIncomeSourcesReport(
		filters: TaxReportWindowFilters = {}
	): Promise<TaxTopIncomeSourceRow[]> {
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const rows = await this.db.query.taxLedgerEntries.findMany({
			where: this.buildLedgerWhere(filters, corporationIds),
			orderBy: [desc(taxLedgerEntries.entryDate)],
			limit: 50_000,
		})

		const grouped = new Map<
			string,
			{ entryCount: number; essEntryCount: number; totalIncomeCenti: bigint }
		>()
		for (const row of rows) {
			if (!this.matchesAmountThreshold(row.amount, filters.minAmount, filters.maxAmount)) {
				continue
			}
			const amountCenti = this.parseDecimalToCenti(row.amount)
			if (amountCenti <= 0n) {
				continue
			}
			const current = grouped.get(row.refType) ?? {
				entryCount: 0,
				essEntryCount: 0,
				totalIncomeCenti: 0n,
			}
			current.entryCount += 1
			current.essEntryCount += row.isEss ? 1 : 0
			current.totalIncomeCenti += amountCenti
			grouped.set(row.refType, current)
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 20, 1), 200)
		return Array.from(grouped.entries())
			.sort((a, b) => {
				if (a[1].totalIncomeCenti === b[1].totalIncomeCenti) {
					return a[0].localeCompare(b[0])
				}
				return a[1].totalIncomeCenti > b[1].totalIncomeCenti ? -1 : 1
			})
			.slice(offset, offset + limit)
			.map(([refType, item]) => ({
				refType,
				entryCount: item.entryCount,
				essEntryCount: item.essEntryCount,
				totalIncome: this.formatCenti(item.totalIncomeCenti),
			}))
	}

	async getEssPayoutReport(filters: TaxReportWindowFilters = {}): Promise<TaxEssPayoutRow[]> {
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const rows = await this.db.query.taxLedgerEntries.findMany({
			where: this.buildEssLedgerWhere(filters, corporationIds),
			orderBy: [desc(taxLedgerEntries.entryDate)],
			limit: 20_000,
		})

		const filteredRows = rows.filter((row) =>
			this.matchesAmountThreshold(row.amount, filters.minAmount, filters.maxAmount)
		)
		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'entryDate'
		const sortDirection = this.toSortDirection(filters.sortDirection, 'desc')

		return filteredRows
			.sort((a, b) => {
				switch (sortBy) {
					case 'amount':
						return this.compareBigInts(
							this.parseDecimalToCenti(a.amount),
							this.parseDecimalToCenti(b.amount),
							sortDirection
						)
					case 'corporationId':
						return this.compareStrings(a.corporationId, b.corporationId, sortDirection)
					case 'division':
						return this.compareNumbersNullable(a.division, b.division, sortDirection)
					case 'essBankType':
						return this.compareStringsNullable(a.essBankType, b.essBankType, sortDirection)
					case 'entryDate':
					default:
						return this.compareDates(a.entryDate, b.entryDate, sortDirection)
				}
			})
			.slice(offset, offset + limit)
			.map((row) => ({
				id: row.id,
				corporationId: row.corporationId,
				entryDate: row.entryDate,
				division: row.division,
				amount: row.amount,
				essBankType: row.essBankType,
				sourceType: row.sourceType,
				sourcePrimaryId: row.sourcePrimaryId,
				firstPartyId: row.firstPartyId,
				secondPartyId: row.secondPartyId,
			}))
	}

	async getComplianceOverTimeReport(
		filters: TaxReportWindowFilters = {}
	): Promise<TaxCompliancePoint[]> {
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const rows = await this.db.query.taxDailyRollups.findMany({
			where: this.buildRollupWhere(filters, corporationIds),
			orderBy: [desc(taxDailyRollups.rollupDate)],
			limit: 20_000,
		})

		const grouped = new Map<
			string,
			{
				rollupDate: Date
				taxDueCenti: bigint
				taxPaidCenti: bigint
				entryCount: number
			}
		>()
		for (const row of rows) {
			const dateKey = row.rollupDate.toISOString().slice(0, 10)
			const current = grouped.get(dateKey) ?? {
				rollupDate: row.rollupDate,
				taxDueCenti: 0n,
				taxPaidCenti: 0n,
				entryCount: 0,
			}
			current.taxDueCenti += this.parseDecimalToCenti(row.taxDue)
			current.taxPaidCenti += this.parseDecimalToCenti(row.taxPaid)
			current.entryCount += row.entryCount
			grouped.set(dateKey, current)
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 180, 1), 3650)
		return Array.from(grouped.values())
			.sort((a, b) => a.rollupDate.getTime() - b.rollupDate.getTime())
			.slice(offset, offset + limit)
			.map((row) => {
				const taxDeltaCenti = row.taxDueCenti - row.taxPaidCenti
				return {
					rollupDate: row.rollupDate,
					taxDue: this.formatCenti(row.taxDueCenti),
					taxPaid: this.formatCenti(row.taxPaidCenti),
					taxDelta: this.formatCenti(taxDeltaCenti),
					entryCount: row.entryCount,
				}
			})
	}

	async getTaxDiscrepancyReport(
		filters: ListTaxDiscrepancyReportFilters = {}
	): Promise<TaxDiscrepancy[]> {
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'createdAt'
		const sortDirection = this.toSortDirection(filters.sortDirection, 'desc')
		const direction = sortDirection === 'asc' ? asc : desc
		const orderBy = (() => {
			switch (sortBy) {
				case 'corporationId':
					return [direction(taxDiscrepancies.corporationId), direction(taxDiscrepancies.createdAt)]
				case 'severity':
					return [direction(taxDiscrepancies.severity), direction(taxDiscrepancies.createdAt)]
				case 'discrepancyType':
					return [
						direction(taxDiscrepancies.discrepancyType),
						direction(taxDiscrepancies.createdAt),
					]
				case 'createdAt':
				default:
					return [direction(taxDiscrepancies.createdAt)]
			}
		})()

		const rows = await this.db.query.taxDiscrepancies.findMany({
			where: this.buildDiscrepancyWhere(filters, corporationIds),
			orderBy,
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

	async getMissingEsiKeysReport(
		filters: ListTaxMissingEsiKeyReportFilters = {}
	): Promise<TaxMissingEsiKeyRow[]> {
		const rows = await this.db.query.taxCorporationSettings.findMany({
			where: filters.includedOnly === true ? eq(taxCorporationSettings.included, true) : undefined,
			orderBy: [desc(taxCorporationSettings.updatedAt)],
			limit: 1_000,
		})

		const missingRows: TaxMissingEsiKeyRow[] = []
		for (const row of rows) {
			const status = await this.settingsService.getCorporationEsiAuthStatus(row.corporationId)
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
				corporationId: row.corporationId,
				included: row.included,
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
		const sortDirection = this.toSortDirection(filters.sortDirection, 'desc')
		return missingRows
			.sort((a, b) => {
				switch (sortBy) {
					case 'corporationId':
						return this.compareStrings(a.corporationId, b.corporationId, sortDirection)
					case 'directorCount':
						return this.compareNumbers(a.directorCount, b.directorCount, sortDirection)
					case 'healthyDirectorCount':
						return this.compareNumbers(
							a.healthyDirectorCount,
							b.healthyDirectorCount,
							sortDirection
						)
					case 'included':
						return this.compareBooleans(a.included, b.included, sortDirection)
					case 'lastVerified':
					default:
						return this.compareDatesNullable(a.lastVerified, b.lastVerified, sortDirection)
				}
			})
			.slice(offset, offset + limit)
	}

	async getExcludedCorporationsReport(
		filters: ListTaxExcludedCorporationsReportFilters = {}
	): Promise<TaxExcludedCorporationRow[]> {
		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		const sortBy = filters.sortBy ?? 'updatedAt'
		const sortDirection = this.toSortDirection(filters.sortDirection, 'desc')
		const direction = sortDirection === 'asc' ? asc : desc
		const orderBy =
			sortBy === 'corporationId'
				? [
						direction(taxCorporationSettings.corporationId),
						direction(taxCorporationSettings.updatedAt),
					]
				: [direction(taxCorporationSettings.updatedAt)]
		const rows = await this.db.query.taxCorporationSettings.findMany({
			where: eq(taxCorporationSettings.included, false),
			orderBy,
			limit,
			offset,
		})
		return rows.map((row) => ({
			corporationId: row.corporationId,
			exclusionReason: row.exclusionReason,
			updatedAt: row.updatedAt,
		}))
	}

	async getBillStatusReport(
		filters: TaxReportWindowFilters = {}
	): Promise<TaxBillStatusReportRow[]> {
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const rows = await this.db
			.select({
				corporationId: taxAssessments.corporationId,
				billStatus: sql<string>`COALESCE(${taxAssessments.billStatus}, 'unbilled')`,
				assessmentCount: sql<number>`COUNT(*)`,
				taxDue: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0)::text`,
				taxPaid: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxPaid} AS numeric)), 0)::text`,
				taxDelta: sql<string>`COALESCE(SUM(CAST(${taxAssessments.taxDelta} AS numeric)), 0)::text`,
			})
			.from(taxAssessments)
			.where(this.buildAssessmentWhere(filters, corporationIds, 'corporation'))
			.groupBy(taxAssessments.corporationId, taxAssessments.billStatus)

		const grouped = rows.map((row) => ({
			corporationId: row.corporationId,
			billStatus: row.billStatus as TaxBillStatusReportRow['billStatus'],
			assessmentCount: this.toInteger(row.assessmentCount),
			taxDue: this.formatCenti(this.parseDecimalToCenti(row.taxDue)),
			taxPaid: this.formatCenti(this.parseDecimalToCenti(row.taxPaid)),
			taxDelta: this.formatCenti(this.parseDecimalToCenti(row.taxDelta)),
			sortDueCenti: this.parseDecimalToCenti(row.taxDue),
		}))

		const offset = Math.max(filters.offset ?? 0, 0)
		const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
		return grouped
			.sort((a, b) => {
				if (a.sortDueCenti === b.sortDueCenti) {
					if (a.corporationId === b.corporationId) {
						return a.billStatus.localeCompare(b.billStatus)
					}
					return a.corporationId.localeCompare(b.corporationId)
				}
				return a.sortDueCenti > b.sortDueCenti ? -1 : 1
			})
			.slice(offset, offset + limit)
			.map(({ sortDueCenti: _sortDueCenti, ...row }) => row)
	}

	async getMemberSummaryReport(
		filters: TaxMemberSummaryReportFilters
	): Promise<TaxMemberSummary[]> {
		const requestedCharacterIds = Array.from(
			new Set((filters.characterIds ?? []).map((value) => value.trim()).filter(Boolean))
		)
		const memberCharacterIds = await this.settingsService.getCorporationMemberIds(
			filters.corporationId
		)
		const memberIdSet = new Set(memberCharacterIds)
		const scopedRequestedCharacterIds =
			requestedCharacterIds.length > 0
				? requestedCharacterIds.filter((characterId) => memberIdSet.has(characterId))
				: []
		const includeUnattributedRow = true

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
				return this.filterMemberSummaryRowsForRequest(cached.rows, scopedRequestedCharacterIds)
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
				return this.filterMemberSummaryRowsForRequest(cached.rows, scopedRequestedCharacterIds)
			}
		}
		this.memberSummaryCacheMisses += 1

		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		if (requestedCharacterIds.length > 0 && scopedRequestedCharacterIds.length === 0) {
			return []
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
			})
			if (rollupRows.length > 0) {
				this.setMemberSummaryCache(cacheKey, {
					rows: rollupRows,
					cachedAtMs: nowMs,
					expiresAtMs: nowMs + this.MEMBER_SUMMARY_CACHE_TTL_MS,
					projectionVersion: versions.projectionVersion,
					finalizedVersion: versions.finalizedVersion,
				})
				return this.filterMemberSummaryRowsForRequest(rollupRows, scopedRequestedCharacterIds)
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

		const corporationAssessments = await this.db.query.taxAssessments.findMany({
			where: and(...corporationAssessmentConditions),
			orderBy: [desc(taxAssessments.taxPeriodEnd), desc(taxAssessments.createdAt)],
			limit: 20_000,
		})
		const corporationAssessmentById = new Map(
			corporationAssessments.map((assessment) => [assessment.id, assessment])
		)
		const corporationAssessmentIds = corporationAssessments.map((row) => row.id)
		if (corporationAssessmentIds.length === 0) {
			return []
		}

		const corporationLineRows = await this.db.query.taxAssessmentLines.findMany({
			where: inArray(taxAssessmentLines.assessmentId, corporationAssessmentIds),
			limit: 100_000,
		})
		if (corporationLineRows.length === 0) {
			return []
		}

		const ledgerEntryIds = Array.from(new Set(corporationLineRows.map((row) => row.ledgerEntryId)))
		if (ledgerEntryIds.length === 0) {
			return []
		}

		const ledgerRows = await this.db.query.taxLedgerEntries.findMany({
			where: inArray(taxLedgerEntries.id, ledgerEntryIds),
			limit: 100_000,
		})

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
					{ lineCount: number; taxableAmountCenti: bigint; taxAmountCenti: bigint }
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
					{ lineCount: number; taxableAmountCenti: bigint; taxAmountCenti: bigint }
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

			const taxableAmountCenti = this.parseDecimalToCenti(line.taxableAmount)
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
			summary.taxableContributionIncomeCenti += taxableAmountCenti
			summary.lastAssessmentAt =
				!summary.lastAssessmentAt || assessment.taxPeriodEnd > summary.lastAssessmentAt
					? assessment.taxPeriodEnd
					: summary.lastAssessmentAt

			const refType = ledgerRow.refType || 'unknown'
			const topTotals = summary.topRefTypeTotals.get(refType) ?? {
				lineCount: 0,
				taxableAmountCenti: 0n,
				taxAmountCenti: 0n,
			}
			topTotals.lineCount += 1
			topTotals.taxableAmountCenti += taxableAmountCenti
			topTotals.taxAmountCenti += taxAmountCenti
			summary.topRefTypeTotals.set(refType, topTotals)
		}

		const characterIdsToReturn =
			requestedCharacterIds.length > 0
				? scopedCharacterIds
				: Array.from(attributedCharacterIds).sort((a, b) => a.localeCompare(b))

		const rows = characterIdsToReturn
			.map((characterId) => {
				const summary = grouped.get(characterId)
				if (!summary) {
					return null
				}
				const sortedTopRefTypes = Array.from(summary.topRefTypeTotals.entries()).sort((a, b) => {
					if (a[1].taxableAmountCenti === b[1].taxableAmountCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].taxableAmountCenti > b[1].taxableAmountCenti ? -1 : 1
				})
				const topRefTypes = (
					topRefTypesLimit ? sortedTopRefTypes.slice(0, topRefTypesLimit) : sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
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
			.filter((row): row is TaxMemberSummary => row !== null)

		if (includeUnattributedRow) {
			const unattributed = grouped.get(unattributedKey)
			if (unattributed) {
				const sortedTopRefTypes = Array.from(unattributed.topRefTypeTotals.entries()).sort(
					(a, b) => {
						if (a[1].taxableAmountCenti === b[1].taxableAmountCenti) {
							return a[0].localeCompare(b[0])
						}
						return a[1].taxableAmountCenti > b[1].taxableAmountCenti ? -1 : 1
					}
				)
				const topRefTypes = (
					topRefTypesLimit ? sortedTopRefTypes.slice(0, topRefTypesLimit) : sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
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

		return this.filterMemberSummaryRowsForRequest(rows, scopedRequestedCharacterIds)
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

	private async getMemberSummaryFromRollups(input: {
		corporationId: string
		fromDate?: Date
		toDate?: Date
		scopedCharacterIds: string[]
		scopedCharacterIdSet: Set<string>
		includeUnattributedRow: boolean
		topRefTypesLimit: number | null
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

		const [fetchedFinalizedRows, fetchedProjectionRows] = await Promise.all([
			this.db.query.taxMemberContributionFinalizedRollups.findMany({
				where: and(...finalizedConditions),
				limit: 200_000,
			}),
			this.db.query.taxMemberContributionProjectionRollups.findMany({
				where: and(...projectionConditions),
				limit: 200_000,
			}),
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
				byRefType: Map<string, { lineCount: number; taxableContributionIncomeCenti: bigint }>
			}
		>()
		for (const row of rolled.values()) {
			const current = byCharacter.get(row.characterId) ?? {
				assessmentCount: 0,
				contributionIncomeCenti: 0n,
				taxableContributionIncomeCenti: 0n,
				lastAssessmentAt: null,
				byRefType: new Map<string, { lineCount: number; taxableContributionIncomeCenti: bigint }>(),
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
				taxableContributionIncomeCenti: 0n,
			}
			ref.lineCount += row.lineCount
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
			.map((characterId) => {
				const summary = byCharacter.get(characterId)
				if (!summary) {
					return null
				}
				const sortedTopRefTypes = Array.from(summary.byRefType.entries()).sort((a, b) => {
					if (a[1].taxableContributionIncomeCenti === b[1].taxableContributionIncomeCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].taxableContributionIncomeCenti > b[1].taxableContributionIncomeCenti ? -1 : 1
				})
				const topRefTypes = (
					input.topRefTypesLimit
						? sortedTopRefTypes.slice(0, input.topRefTypesLimit)
						: sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
					taxableAmount: this.formatCenti(totals.taxableContributionIncomeCenti),
					taxAmount: '0',
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
			.filter((row): row is TaxMemberSummary => row !== null)

		if (input.includeUnattributedRow) {
			const unattributed = byCharacter.get('__unattributed__')
			if (unattributed) {
				const sortedTopRefTypes = Array.from(unattributed.byRefType.entries()).sort((a, b) => {
					if (a[1].taxableContributionIncomeCenti === b[1].taxableContributionIncomeCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].taxableContributionIncomeCenti > b[1].taxableContributionIncomeCenti ? -1 : 1
				})
				const topRefTypes = (
					input.topRefTypesLimit
						? sortedTopRefTypes.slice(0, input.topRefTypesLimit)
						: sortedTopRefTypes
				).map(([refType, totals]) => ({
					refType,
					lineCount: totals.lineCount,
					taxableAmount: this.formatCenti(totals.taxableContributionIncomeCenti),
					taxAmount: '0',
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
		filters: TaxReportWindowFilters,
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

	private buildLedgerWhere(filters: TaxReportWindowFilters, corporationIds: string[]) {
		const conditions = [inArray(taxLedgerEntries.corporationId, corporationIds)]
		if (filters.division !== undefined) {
			conditions.push(eq(taxLedgerEntries.division, filters.division))
		}
		const refTypes = this.toRefTypes(filters)
		if (refTypes && refTypes.length > 0) {
			conditions.push(inArray(taxLedgerEntries.refType, refTypes))
		}
		if (filters.firstPartyId) {
			conditions.push(eq(taxLedgerEntries.firstPartyId, filters.firstPartyId))
		}
		if (filters.secondPartyId) {
			conditions.push(eq(taxLedgerEntries.secondPartyId, filters.secondPartyId))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxLedgerEntries.entryDate, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxLedgerEntries.entryDate, filters.toDate))
		}
		return and(...conditions)
	}

	private buildEssLedgerWhere(filters: TaxReportWindowFilters, corporationIds: string[]) {
		const conditions = [
			eq(taxLedgerEntries.isEss, true),
			inArray(taxLedgerEntries.corporationId, corporationIds),
		]
		if (filters.division !== undefined) {
			conditions.push(eq(taxLedgerEntries.division, filters.division))
		}
		const refTypes = this.toRefTypes(filters)
		if (refTypes && refTypes.length > 0) {
			conditions.push(inArray(taxLedgerEntries.refType, refTypes))
		}
		if (filters.firstPartyId) {
			conditions.push(eq(taxLedgerEntries.firstPartyId, filters.firstPartyId))
		}
		if (filters.secondPartyId) {
			conditions.push(eq(taxLedgerEntries.secondPartyId, filters.secondPartyId))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxLedgerEntries.entryDate, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxLedgerEntries.entryDate, filters.toDate))
		}
		return and(...conditions)
	}

	private buildRollupWhere(filters: TaxReportWindowFilters, corporationIds: string[]) {
		const conditions = [inArray(taxDailyRollups.corporationId, corporationIds)]
		if (filters.division !== undefined) {
			conditions.push(eq(taxDailyRollups.division, filters.division))
		}
		const refTypes = this.toRefTypes(filters)
		if (refTypes && refTypes.length > 0) {
			conditions.push(inArray(taxDailyRollups.refType, refTypes))
		}
		if (filters.fromDate) {
			conditions.push(gte(taxDailyRollups.rollupDate, filters.fromDate))
		}
		if (filters.toDate) {
			conditions.push(lte(taxDailyRollups.rollupDate, filters.toDate))
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

	private toSortDirection(
		input: 'asc' | 'desc' | undefined,
		defaultDirection: 'asc' | 'desc'
	): 'asc' | 'desc' {
		return input === 'asc' || input === 'desc' ? input : defaultDirection
	}

	private compareBigInts(a: bigint, b: bigint, direction: 'asc' | 'desc'): number {
		if (a === b) {
			return 0
		}
		const order = a > b ? 1 : -1
		return direction === 'asc' ? order : -order
	}

	private compareNumbers(a: number, b: number, direction: 'asc' | 'desc'): number {
		if (a === b) {
			return 0
		}
		const order = a > b ? 1 : -1
		return direction === 'asc' ? order : -order
	}

	private compareNumbersNullable(
		a: number | null,
		b: number | null,
		direction: 'asc' | 'desc'
	): number {
		if (a === b) {
			return 0
		}
		if (a === null) {
			return 1
		}
		if (b === null) {
			return -1
		}
		return this.compareNumbers(a, b, direction)
	}

	private compareStrings(a: string, b: string, direction: 'asc' | 'desc'): number {
		const order = a.localeCompare(b)
		return direction === 'asc' ? order : -order
	}

	private compareStringsNullable(
		a: string | null,
		b: string | null,
		direction: 'asc' | 'desc'
	): number {
		if (a === b) {
			return 0
		}
		if (a === null) {
			return 1
		}
		if (b === null) {
			return -1
		}
		return this.compareStrings(a, b, direction)
	}

	private compareBooleans(a: boolean, b: boolean, direction: 'asc' | 'desc'): number {
		return this.compareNumbers(a ? 1 : 0, b ? 1 : 0, direction)
	}

	private compareDates(a: Date, b: Date, direction: 'asc' | 'desc'): number {
		return this.compareNumbers(a.getTime(), b.getTime(), direction)
	}

	private compareDatesNullable(a: Date | null, b: Date | null, direction: 'asc' | 'desc'): number {
		if (a === b) {
			return 0
		}
		if (a === null) {
			return 1
		}
		if (b === null) {
			return -1
		}
		return this.compareDates(a, b, direction)
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

	private toRefTypes(filters: TaxReportWindowFilters): string[] | undefined {
		const values = [...(filters.refTypes ?? []), ...(filters.refType ? [filters.refType] : [])]
			.map((value) => value.trim())
			.filter(Boolean)
		if (values.length === 0) {
			return undefined
		}
		return Array.from(new Set(values))
	}

	private matchesAmountThreshold(amount: string, minAmount?: string, maxAmount?: string): boolean {
		const amountCenti = this.safeParseDecimalToCenti(amount)
		if (amountCenti === null) {
			return true
		}

		const minAmountCenti = minAmount !== undefined ? this.safeParseDecimalToCenti(minAmount) : null
		if (minAmountCenti !== null && amountCenti < minAmountCenti) {
			return false
		}

		const maxAmountCenti = maxAmount !== undefined ? this.safeParseDecimalToCenti(maxAmount) : null
		if (maxAmountCenti !== null && amountCenti > maxAmountCenti) {
			return false
		}

		return true
	}

	private safeParseDecimalToCenti(value: string): bigint | null {
		try {
			return this.parseDecimalToCenti(value)
		} catch (_error) {
			return null
		}
	}

	private async resolveIncludedCorporationIds(corporationId?: string): Promise<string[]> {
		if (corporationId) {
			const settings = await this.db.query.taxCorporationSettings.findFirst({
				where: eq(taxCorporationSettings.corporationId, corporationId),
			})
			return settings?.included ? [corporationId] : []
		}

		const rows = await this.db.query.taxCorporationSettings.findMany({
			where: eq(taxCorporationSettings.included, true),
			limit: 10_000,
		})
		return rows.map((row) => row.corporationId)
	}

	private parseDecimalToCenti(value: string): bigint {
		const trimmed = value.trim()
		if (!trimmed) {
			return 0n
		}
		const sign = trimmed.startsWith('-') ? -1n : 1n
		const unsigned = trimmed.replace(/^[+-]/, '')
		const [wholePartRaw, fractionalPartRaw = ''] = unsigned.split('.')
		const wholePart = wholePartRaw === '' ? '0' : wholePartRaw
		const fractionalNormalized = (fractionalPartRaw + '00').slice(0, 2)
		const whole = BigInt(wholePart)
		const fractional = BigInt(fractionalNormalized)
		return sign * (whole * 100n + fractional)
	}

	private formatCenti(value: bigint): string {
		const sign = value < 0n ? '-' : ''
		const absolute = value < 0n ? -value : value
		const whole = absolute / 100n
		const fractional = absolute % 100n
		return `${sign}${whole.toString()}.${fractional.toString().padStart(2, '0')}`
	}
}
