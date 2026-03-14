import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from '@repo/db-utils'

import {
	taxAssessmentLines,
	taxAssessments,
	taxCorporationSettings,
	taxDailyRollups,
	taxDiscrepancies,
	taxLedgerEntries,
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
		const corporationIds = await this.resolveIncludedCorporationIds(filters.corporationId)
		if (corporationIds.length === 0) {
			return []
		}

		const characterIds = Array.from(
			new Set((filters.characterIds ?? []).map((value) => value.trim()).filter(Boolean))
		)
		if (characterIds.length === 0) {
			return []
		}

		const assessmentConditions = [
			eq(taxAssessments.corporationId, filters.corporationId),
			eq(taxAssessments.assessmentScope, 'character'),
			inArray(taxAssessments.scopeId, characterIds),
		]
		if (filters.fromDate) {
			assessmentConditions.push(gte(taxAssessments.taxPeriodStart, filters.fromDate))
		}
		if (filters.toDate) {
			assessmentConditions.push(lte(taxAssessments.taxPeriodEnd, filters.toDate))
		}

		const assessments = await this.db.query.taxAssessments.findMany({
			where: and(...assessmentConditions),
			orderBy: [desc(taxAssessments.taxPeriodEnd), desc(taxAssessments.createdAt)],
			limit: 20_000,
		})

		const grouped = new Map<
			string,
			{
				assessmentCount: number
				taxableIncomeCenti: bigint
				nonTaxableIncomeCenti: bigint
				taxDueCenti: bigint
				taxPaidCenti: bigint
				taxDeltaCenti: bigint
				lastAssessmentAt: Date | null
				assessmentIds: string[]
			}
		>()
		const assessmentCharacterMap = new Map<string, string>()

		for (const characterId of characterIds) {
			grouped.set(characterId, {
				assessmentCount: 0,
				taxableIncomeCenti: 0n,
				nonTaxableIncomeCenti: 0n,
				taxDueCenti: 0n,
				taxPaidCenti: 0n,
				taxDeltaCenti: 0n,
				lastAssessmentAt: null,
				assessmentIds: [],
			})
		}

		for (const row of assessments) {
			const current = grouped.get(row.scopeId)
			if (!current) {
				continue
			}

			current.assessmentCount += 1
			current.taxableIncomeCenti += this.parseDecimalToCenti(row.taxableIncome)
			current.nonTaxableIncomeCenti += this.parseDecimalToCenti(row.nonTaxableIncome)
			current.taxDueCenti += this.parseDecimalToCenti(row.taxDue)
			current.taxPaidCenti += this.parseDecimalToCenti(row.taxPaid)
			current.taxDeltaCenti += this.parseDecimalToCenti(row.taxDelta)
			current.lastAssessmentAt =
				!current.lastAssessmentAt || row.taxPeriodEnd > current.lastAssessmentAt
					? row.taxPeriodEnd
					: current.lastAssessmentAt
			current.assessmentIds.push(row.id)
			assessmentCharacterMap.set(row.id, row.scopeId)
		}

		const allAssessmentIds = assessments.map((row) => row.id)
		const lineRows =
			allAssessmentIds.length > 0
				? await this.db.query.taxAssessmentLines.findMany({
						where: inArray(taxAssessmentLines.assessmentId, allAssessmentIds),
						limit: 50_000,
					})
				: []
		const ledgerEntryIds = Array.from(new Set(lineRows.map((row) => row.ledgerEntryId)))
		const ledgerRows =
			ledgerEntryIds.length > 0
				? await this.db.query.taxLedgerEntries.findMany({
						where: inArray(taxLedgerEntries.id, ledgerEntryIds),
						limit: 50_000,
					})
				: []

		const ledgerRefTypeById = new Map(ledgerRows.map((row) => [row.id, row.refType]))
		const topRefTypesLimit = Math.min(Math.max(filters.topRefTypesLimit ?? 5, 1), 20)
		const refTypeTotalsByCharacter = new Map<
			string,
			Map<string, { lineCount: number; taxableAmountCenti: bigint; taxAmountCenti: bigint }>
		>()

		for (const line of lineRows) {
			const characterId = assessmentCharacterMap.get(line.assessmentId)
			if (!characterId) {
				continue
			}
			const refType = ledgerRefTypeById.get(line.ledgerEntryId) ?? 'unknown'
			const byRefType = refTypeTotalsByCharacter.get(characterId) ?? new Map()
			const totals = byRefType.get(refType) ?? {
				lineCount: 0,
				taxableAmountCenti: 0n,
				taxAmountCenti: 0n,
			}
			totals.lineCount += 1
			totals.taxableAmountCenti += this.parseDecimalToCenti(line.taxableAmount)
			totals.taxAmountCenti += this.parseDecimalToCenti(line.taxAmount)
			byRefType.set(refType, totals)
			refTypeTotalsByCharacter.set(characterId, byRefType)
		}

		return characterIds.map((characterId) => {
			const summary = grouped.get(characterId)!
			const topRefTypes = Array.from(refTypeTotalsByCharacter.get(characterId)?.entries() ?? [])
				.sort((a, b) => {
					if (a[1].taxableAmountCenti === b[1].taxableAmountCenti) {
						return a[0].localeCompare(b[0])
					}
					return a[1].taxableAmountCenti > b[1].taxableAmountCenti ? -1 : 1
				})
				.slice(0, topRefTypesLimit)
				.map(([refType, totals]) => ({
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
				assessmentCount: summary.assessmentCount,
				taxableIncome: this.formatCenti(summary.taxableIncomeCenti),
				nonTaxableIncome: this.formatCenti(summary.nonTaxableIncomeCenti),
				taxDue: this.formatCenti(summary.taxDueCenti),
				taxPaid: this.formatCenti(summary.taxPaidCenti),
				taxDelta: this.formatCenti(summary.taxDeltaCenti),
				complianceStatus: this.toMemberComplianceStatus(
					summary.taxDeltaCenti,
					summary.assessmentCount
				),
				lastAssessmentAt: summary.lastAssessmentAt,
				topRefTypes,
			}
		})
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

	private toMemberComplianceStatus(
		taxDeltaCenti: bigint,
		assessmentCount: number
	): TaxMemberSummary['complianceStatus'] {
		if (assessmentCount === 0) {
			return 'no_data'
		}
		if (taxDeltaCenti > 0n) {
			return 'underpaid'
		}
		if (taxDeltaCenti < 0n) {
			return 'overpaid'
		}
		return 'paid'
	}
}
