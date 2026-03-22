import { asc, desc, sql } from '@repo/db-utils'

import { taxAssessments, taxDiscrepancies, taxLedgerEntries } from '../db/schema'
import {
	compareBigInts,
	compareDatesNullable,
	compareNumbers,
	compareStrings,
} from './tax-report-sorting'

import type { TaxBillStatusReportRow, TaxMissingEsiKeyRow } from '@repo/corporation-tax'
import type { SortDirection } from './tax-report-sorting'

export type BillStatusSortableRow = TaxBillStatusReportRow & {
	sortDueCenti: bigint
	sortPaidCenti: bigint
	sortDeltaCenti: bigint
	sortIssueDate: Date | null
	sortDueDate: Date | null
}

export function resolveTotalTaxesOrderBy(sortBy: string, sortDirection: SortDirection) {
	const direction = sortDirection === 'asc' ? asc : desc
	const builders = {
		corporationId: () => [direction(taxAssessments.corporationId)],
		assessmentCount: () => [
			sortDirection === 'asc' ? sql`COUNT(*) ASC` : sql`COUNT(*) DESC`,
			direction(taxAssessments.corporationId),
		],
		taxPaid: () => [
			sortDirection === 'asc'
				? sql`COALESCE(SUM(CAST(${taxAssessments.taxPaid} AS numeric)), 0) ASC`
				: sql`COALESCE(SUM(CAST(${taxAssessments.taxPaid} AS numeric)), 0) DESC`,
			direction(taxAssessments.corporationId),
		],
		taxDelta: () => [
			sortDirection === 'asc'
				? sql`COALESCE(SUM(CAST(${taxAssessments.taxDelta} AS numeric)), 0) ASC`
				: sql`COALESCE(SUM(CAST(${taxAssessments.taxDelta} AS numeric)), 0) DESC`,
			direction(taxAssessments.corporationId),
		],
		lastAssessmentAt: () => [
			sortDirection === 'asc'
				? sql`MAX(${taxAssessments.taxPeriodEnd}) ASC`
				: sql`MAX(${taxAssessments.taxPeriodEnd}) DESC`,
			direction(taxAssessments.corporationId),
		],
		taxDue: () => [
			sortDirection === 'asc'
				? sql`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0) ASC`
				: sql`COALESCE(SUM(CAST(${taxAssessments.taxDue} AS numeric)), 0) DESC`,
			direction(taxAssessments.corporationId),
		],
	} as const

	const build = builders[sortBy as keyof typeof builders] ?? builders.taxDue
	return build()
}

export function resolveEssOrderBy(sortBy: string, sortDirection: SortDirection) {
	const direction = sortDirection === 'asc' ? asc : desc
	const builders = {
		amount: () => [
			sortDirection === 'asc'
				? sql`CAST(${taxLedgerEntries.amount} AS numeric) ASC`
				: sql`CAST(${taxLedgerEntries.amount} AS numeric) DESC`,
			direction(taxLedgerEntries.entryDate),
		],
		corporationId: () => [
			direction(taxLedgerEntries.corporationId),
			direction(taxLedgerEntries.entryDate),
		],
		division: () => [direction(taxLedgerEntries.division), direction(taxLedgerEntries.entryDate)],
		essBankType: () => [
			direction(taxLedgerEntries.essBankType),
			direction(taxLedgerEntries.entryDate),
		],
		entryDate: () => [direction(taxLedgerEntries.entryDate)],
	} as const

	const build = builders[sortBy as keyof typeof builders] ?? builders.entryDate
	return build()
}

export function resolveDiscrepancyOrderBy(sortBy: string, sortDirection: SortDirection) {
	const direction = sortDirection === 'asc' ? asc : desc
	const builders = {
		corporationId: () => [
			direction(taxDiscrepancies.corporationId),
			direction(taxDiscrepancies.createdAt),
		],
		severity: () => [direction(taxDiscrepancies.severity), direction(taxDiscrepancies.createdAt)],
		discrepancyType: () => [
			direction(taxDiscrepancies.discrepancyType),
			direction(taxDiscrepancies.createdAt),
		],
		createdAt: () => [direction(taxDiscrepancies.createdAt)],
	} as const

	const build = builders[sortBy as keyof typeof builders] ?? builders.createdAt
	return build()
}

export const missingEsiSortComparators = {
	corporationId: (a: TaxMissingEsiKeyRow, b: TaxMissingEsiKeyRow, direction: SortDirection) =>
		compareStrings(a.corporationId, b.corporationId, direction),
	directorCount: (a: TaxMissingEsiKeyRow, b: TaxMissingEsiKeyRow, direction: SortDirection) =>
		compareNumbers(a.directorCount, b.directorCount, direction),
	healthyDirectorCount: (
		a: TaxMissingEsiKeyRow,
		b: TaxMissingEsiKeyRow,
		direction: SortDirection
	) => compareNumbers(a.healthyDirectorCount, b.healthyDirectorCount, direction),
	lastVerified: (a: TaxMissingEsiKeyRow, b: TaxMissingEsiKeyRow, direction: SortDirection) =>
		compareDatesNullable(a.lastVerified, b.lastVerified, direction),
} as const

export const billStatusSortComparators = {
	corporationId: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareStrings(a.corporationId, b.corporationId, direction),
	billStatus: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareStrings(a.billStatus, b.billStatus, direction),
	issueDate: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareDatesNullable(a.sortIssueDate, b.sortIssueDate, direction),
	dueDate: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareDatesNullable(a.sortDueDate, b.sortDueDate, direction),
	assessmentCount: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareNumbers(a.assessmentCount, b.assessmentCount, direction),
	taxPaid: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareBigInts(a.sortPaidCenti, b.sortPaidCenti, direction),
	taxDelta: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareBigInts(a.sortDeltaCenti, b.sortDeltaCenti, direction),
	taxDue: (a: BillStatusSortableRow, b: BillStatusSortableRow, direction: SortDirection) =>
		compareBigInts(a.sortDueCenti, b.sortDueCenti, direction),
} as const
