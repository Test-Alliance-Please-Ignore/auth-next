import { useEffect, useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { TaxReportDataGrid } from '@/components/tax-report-data-grid'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { FilterField } from '@/components/ui/filter-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { SearchSelect } from '@/components/ui/search-select'
import { Section } from '@/components/ui/section'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	useCreateTaxExportSchedule,
	useRequestTaxExport,
	useTaxBillStatusReport,
	useTaxCapabilities,
	useTaxComplianceReport,
	useTaxDiscrepancyReport,
	useTaxEssPayoutReport,
	useTaxExcludedCorporationsReport,
	useTaxExportArtifact,
	useTaxExports,
	useTaxExportSchedules,
	useTaxMissingEsiKeysReport,
	useTaxSummaryReport,
	useTaxTopIncomeSourcesReport,
	useTaxTotalTaxesReport,
	useTaxWalletDivisions,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import {
	formatTaxDivisionLabel,
	formatTaxIskCompact,
	formatTaxIskFull,
	formatTaxNumber,
	formatTaxRefTypeLabel,
	formatTaxReportTypeLabel,
	TAX_REF_TYPE_OPTIONS,
	TaxEntityDisplay,
} from '@/lib/tax-display'

import type { MRT_ColumnDef, MRT_SortingState } from 'mantine-react-table'
import type {
	TaxBillStatusReportRow,
	TaxCompliancePoint,
	TaxDiscrepancy,
	TaxEssPayoutRow,
	TaxExcludedCorporationRow,
	TaxExportFormat,
	TaxExportRecord,
	TaxExportReportType,
	TaxExportSchedule,
	TaxMissingEsiKeyRow,
	TaxTopIncomeSourceRow,
	TaxTotalTaxesByCorporationRow,
} from '@repo/corporation-tax'

const REPORT_PAGE_SIZE = 25
const COMPLIANCE_CHART_WIDTH = 600
const COMPLIANCE_CHART_HEIGHT = 160

type SortDirection = 'asc' | 'desc'
type TaxReportView = TaxExportReportType | 'missing_esi_keys' | 'excluded_corporations'

const reportViewOptions: Array<{
	value: TaxReportView
	label: string
	description: string
	exportable: boolean
	requiresGlobalScope?: boolean
}> = [
	{
		value: 'total_taxes_by_corporation',
		label: 'Total Taxes',
		description: 'Corporation-level due, paid, delta, and compliance counts.',
		exportable: true,
	},
	{
		value: 'top_income_sources',
		label: 'Income Sources',
		description: 'Taxable inflow grouped by ref type, including ESS-tagged entries.',
		exportable: true,
	},
	{
		value: 'ess_payout',
		label: 'ESS',
		description: 'Recent ESS escrow entries with bank type and counterparties.',
		exportable: true,
	},
	{
		value: 'compliance_over_time',
		label: 'Compliance',
		description: 'Trend view of tax due, paid, and delta over time.',
		exportable: true,
	},
	{
		value: 'discrepancies',
		label: 'Discrepancies',
		description: 'Active discrepancy signals for the selected scope.',
		exportable: true,
	},
	{
		value: 'bill_status',
		label: 'Bill Status',
		description: 'Assessment bill status rollups for the selected reporting window.',
		exportable: true,
	},
	{
		value: 'missing_esi_keys',
		label: 'Missing ESI Keys',
		description: 'Corporations with incomplete ESI key or scope coverage.',
		exportable: false,
		requiresGlobalScope: true,
	},
	{
		value: 'excluded_corporations',
		label: 'Excluded Corps',
		description: 'Current exclusion list and rationale.',
		exportable: false,
		requiresGlobalScope: true,
	},
]

const exportFormatOptions: Array<{ value: TaxExportFormat; label: string }> = [
	{ value: 'csv', label: 'CSV' },
	{ value: 'xlsx', label: 'XLSX' },
]

const ALL_DIVISIONS_OPTION = {
	id: '__all_divisions__',
	value: '',
	label: 'All divisions',
} as const

const ALL_INCOME_TYPES_OPTION = {
	id: '__all_income_types__',
	value: '',
	label: 'All income types',
} as const

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()

const scheduleFrequencyOptions: Array<{ value: 'weekly' | 'monthly'; label: string }> = [
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'monthly', label: 'Monthly' },
]

function toStartOfDayIso(dateText: string): string {
	return new Date(`${dateText}T00:00:00.000Z`).toISOString()
}

function toEndOfDayIso(dateText: string): string {
	return new Date(`${dateText}T23:59:59.999Z`).toISOString()
}

function parseAmount(value: string): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function toLinePoints(values: number[], maxValue: number, width: number, height: number): string {
	if (values.length === 0) {
		return ''
	}
	if (values.length === 1) {
		const y = height - (values[0]! / maxValue) * height
		return `0,${Math.max(0, Math.min(height, y))}`
	}

	const step = width / (values.length - 1)
	return values
		.map((value, index) => {
			const ratio = maxValue === 0 ? 0 : value / maxValue
			const y = height - ratio * height
			return `${index * step},${Math.max(0, Math.min(height, y))}`
		})
		.join(' ')
}

function toJsonPreview(value: unknown): string {
	if (value === null || value === undefined) {
		return '-'
	}
	try {
		const raw = JSON.stringify(value)
		return raw.length > 140 ? `${raw.slice(0, 140)}...` : raw
	} catch (_error) {
		return String(value)
	}
}

function downloadBase64File(fileName: string, contentType: string, contentBase64: string): void {
	const binary = atob(contentBase64)
	const bytes = new Uint8Array(binary.length)
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i)
	}
	const blob = new Blob([bytes], { type: contentType })
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement('a')
	anchor.href = url
	anchor.download = fileName
	anchor.click()
	URL.revokeObjectURL(url)
}

function toSorting(sortBy?: string, sortDir?: SortDirection): MRT_SortingState {
	return sortBy ? [{ id: sortBy, desc: sortDir === 'desc' }] : []
}

function applySorting(
	sorting: MRT_SortingState,
	defaultSortBy: string,
	defaultSortDir: SortDirection,
	setSortBy: (value: string) => void,
	setSortDir: (value: SortDirection) => void,
	resetPage?: () => void
) {
	const first = sorting[0]
	if (!first) {
		setSortBy(defaultSortBy)
		setSortDir(defaultSortDir)
		resetPage?.()
		return
	}

	setSortBy(first.id)
	setSortDir(first.desc ? 'desc' : 'asc')
	resetPage?.()
}

function toSearchOptions<TValue extends string>(options: Array<{ value: TValue; label: string }>) {
	return options.map((option) => ({
		id: option.value,
		value: option.value,
		label: option.label,
	}))
}

export default function TaxReportsPage() {
	usePageTitle('Tax Reports')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canViewWithUrn = globalCapabilities?.global.canAudit ?? false
	const canExportWithUrn = globalCapabilities?.global.canAudit ?? false
	const canManageSchedulesWithUrn = globalCapabilities?.global.canAudit ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canViewWithUrn)

	const [selectedReportView, setSelectedReportView] = useState<TaxReportView>(
		'total_taxes_by_corporation'
	)
	const [reportSelectorQuery, setReportSelectorQuery] = useState('Total Taxes')
	const [incomeTypeQuery, setIncomeTypeQuery] = useState('')
	const [exportModalOpen, setExportModalOpen] = useState(false)
	const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
	const [selectedExportFormat, setSelectedExportFormat] = useState<TaxExportFormat>('csv')
	const [selectedScheduleFormat, setSelectedScheduleFormat] = useState<TaxExportFormat>('csv')
	const [scheduleName, setScheduleName] = useState('Weekly Tax Summary')
	const [scheduleFrequency, setScheduleFrequency] = useState<'weekly' | 'monthly'>('weekly')
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [refTypeFilter, setRefTypeFilter] = useState('')
	const [divisionFilter, setDivisionFilter] = useState('')
	const [divisionQuery, setDivisionQuery] = useState('')
	const [firstPartyIdFilter, setFirstPartyIdFilter] = useState('')
	const [secondPartyIdFilter, setSecondPartyIdFilter] = useState('')
	const [minAmountFilter, setMinAmountFilter] = useState('')
	const [totalTaxesPage, setTotalTaxesPage] = useState(0)
	const [totalTaxesSortBy, setTotalTaxesSortBy] = useState('taxDue')
	const [totalTaxesSortDir, setTotalTaxesSortDir] = useState<SortDirection>('desc')
	const [essPage, setEssPage] = useState(0)
	const [essSortBy, setEssSortBy] = useState('entryDate')
	const [essSortDir, setEssSortDir] = useState<SortDirection>('desc')
	const [discrepancyPage, setDiscrepancyPage] = useState(0)
	const [discrepancySortBy, setDiscrepancySortBy] = useState('createdAt')
	const [discrepancySortDir, setDiscrepancySortDir] = useState<SortDirection>('desc')
	const [missingEsiPage, setMissingEsiPage] = useState(0)
	const [missingEsiSortBy, setMissingEsiSortBy] = useState('lastVerified')
	const [missingEsiSortDir, setMissingEsiSortDir] = useState<SortDirection>('desc')
	const [excludedPage, setExcludedPage] = useState(0)
	const [excludedSortBy, setExcludedSortBy] = useState('updatedAt')
	const [excludedSortDir, setExcludedSortDir] = useState<SortDirection>('desc')

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canAuditScoped = scopedCapabilities?.scoped.canAudit ?? false
	const canManageScoped = canAuditScoped
	const canView = canViewWithUrn || canAuditScoped
	const canExport = canExportWithUrn || canAuditScoped
	const canCreateSchedule = canManageSchedulesWithUrn || canManageScoped

	const visibleReportOptions = useMemo(
		() => reportViewOptions.filter((option) => !option.requiresGlobalScope || canViewWithUrn),
		[canViewWithUrn]
	)
	const selectedReportOption =
		visibleReportOptions.find((option) => option.value === selectedReportView) ??
		visibleReportOptions[0]
	const activeReportIsExportable = selectedReportOption?.exportable ?? false
	const activeExportReportType = activeReportIsExportable
		? (selectedReportView as TaxExportReportType)
		: null

	useEffect(() => {
		if (selectedReportOption && selectedReportOption.value !== selectedReportView) {
			setSelectedReportView(selectedReportOption.value)
		}
	}, [selectedReportOption, selectedReportView])

	useEffect(() => {
		setReportSelectorQuery('')
	}, [selectedReportOption?.label])

	useEffect(() => {
		setIncomeTypeQuery('')
	}, [refTypeFilter])

	useEffect(() => {
		if (!effectiveCorporationId) {
			setDivisionFilter('')
			setDivisionQuery('')
		}
	}, [effectiveCorporationId])

	useEffect(() => {
		setDivisionQuery('')
	}, [divisionFilter])

	const { data: walletDivisions = [] } = useTaxWalletDivisions(effectiveCorporationId, canView)

	const divisionOptions = useMemo(
		() => [
			ALL_DIVISIONS_OPTION,
			...walletDivisions.map((division) => ({
				id: String(division),
				value: String(division),
				label: formatTaxDivisionLabel(division),
			})),
		],
		[walletDivisions]
	)

	const incomeTypeOptions = useMemo(
		() => [ALL_INCOME_TYPES_OPTION, ...toSearchOptions(TAX_REF_TYPE_OPTIONS)],
		[]
	)

	useEffect(() => {
		if (!divisionFilter) {
			return
		}
		if (!walletDivisions.includes(Number(divisionFilter))) {
			setDivisionFilter('')
			setDivisionQuery('')
		}
	}, [divisionFilter, walletDivisions])

	const fromDateIso = fromDate ? toStartOfDayIso(fromDate) : undefined
	const toDateIso = toDate ? toEndOfDayIso(toDate) : undefined
	const divisionValue =
		divisionFilter.trim() !== '' && Number.isInteger(Number(divisionFilter))
			? Number(divisionFilter)
			: undefined
	const refTypeValue = refTypeFilter.trim() || undefined
	const firstPartyIdValue = firstPartyIdFilter.trim() || undefined
	const secondPartyIdValue = secondPartyIdFilter.trim() || undefined
	const minAmountValue = minAmountFilter.trim() || undefined

	const reportWindowFilters = useMemo(
		() => ({
			corporationId: effectiveCorporationId,
			fromDate: fromDateIso,
			toDate: toDateIso,
			division: divisionValue,
			refType: refTypeValue,
			firstPartyId: firstPartyIdValue,
			secondPartyId: secondPartyIdValue,
			minAmount: minAmountValue,
		}),
		[
			divisionValue,
			effectiveCorporationId,
			firstPartyIdValue,
			fromDateIso,
			minAmountValue,
			refTypeValue,
			secondPartyIdValue,
			toDateIso,
		]
	)

	useEffect(() => {
		setTotalTaxesPage(0)
		setEssPage(0)
		setDiscrepancyPage(0)
		setMissingEsiPage(0)
		setExcludedPage(0)
	}, [
		divisionValue,
		effectiveCorporationId,
		firstPartyIdValue,
		fromDateIso,
		minAmountValue,
		refTypeValue,
		secondPartyIdValue,
		toDateIso,
	])

	const {
		data: summaryReport,
		isLoading: summaryLoading,
		error: summaryError,
	} = useTaxSummaryReport({
		...reportWindowFilters,
		limit: 1,
		enabled: canView,
	})

	const {
		data: totalTaxesRows = [],
		isLoading: totalTaxesLoading,
		error: totalTaxesError,
	} = useTaxTotalTaxesReport({
		...reportWindowFilters,
		limit: REPORT_PAGE_SIZE,
		offset: totalTaxesPage * REPORT_PAGE_SIZE,
		sortBy: totalTaxesSortBy,
		sortDir: totalTaxesSortDir,
		enabled: canView && selectedReportView === 'total_taxes_by_corporation',
	})

	const {
		data: topIncomeRows = [],
		isLoading: topIncomeLoading,
		error: topIncomeError,
	} = useTaxTopIncomeSourcesReport({
		...reportWindowFilters,
		limit: 100,
		enabled: canView && selectedReportView === 'top_income_sources',
	})

	const {
		data: essRows = [],
		isLoading: essLoading,
		error: essError,
	} = useTaxEssPayoutReport({
		...reportWindowFilters,
		limit: REPORT_PAGE_SIZE,
		offset: essPage * REPORT_PAGE_SIZE,
		sortBy: essSortBy,
		sortDir: essSortDir,
		enabled: canView && selectedReportView === 'ess_payout',
	})

	const {
		data: complianceRows = [],
		isLoading: complianceLoading,
		error: complianceError,
	} = useTaxComplianceReport({
		...reportWindowFilters,
		limit: 90,
		enabled: canView && selectedReportView === 'compliance_over_time',
	})

	const {
		data: discrepancyRows = [],
		isLoading: discrepancyLoading,
		error: discrepancyError,
	} = useTaxDiscrepancyReport({
		corporationId: reportWindowFilters.corporationId,
		fromDate: reportWindowFilters.fromDate,
		toDate: reportWindowFilters.toDate,
		onlyOpen: true,
		limit: REPORT_PAGE_SIZE,
		offset: discrepancyPage * REPORT_PAGE_SIZE,
		sortBy: discrepancySortBy,
		sortDir: discrepancySortDir,
		enabled: canView && selectedReportView === 'discrepancies',
	})

	const {
		data: billStatusRows = [],
		isLoading: billStatusLoading,
		error: billStatusError,
	} = useTaxBillStatusReport({
		...reportWindowFilters,
		limit: 100,
		enabled: canView && selectedReportView === 'bill_status',
	})

	const {
		data: missingEsiRows = [],
		isLoading: missingEsiLoading,
		error: missingEsiError,
	} = useTaxMissingEsiKeysReport({
		includedOnly: false,
		limit: REPORT_PAGE_SIZE,
		offset: missingEsiPage * REPORT_PAGE_SIZE,
		sortBy: missingEsiSortBy,
		sortDir: missingEsiSortDir,
		enabled: canViewWithUrn && selectedReportView === 'missing_esi_keys',
	})

	const {
		data: excludedRows = [],
		isLoading: excludedRowsLoading,
		error: excludedRowsError,
	} = useTaxExcludedCorporationsReport({
		limit: REPORT_PAGE_SIZE,
		offset: excludedPage * REPORT_PAGE_SIZE,
		sortBy: excludedSortBy,
		sortDir: excludedSortDir,
		enabled: canViewWithUrn && selectedReportView === 'excluded_corporations',
	})

	const {
		data: exportsList = [],
		isLoading: exportsLoading,
		error: exportsError,
	} = useTaxExports({
		corporationId: effectiveCorporationId,
		limit: 100,
		enabled: canView,
	})

	const {
		data: schedules = [],
		isLoading: schedulesLoading,
		error: schedulesError,
	} = useTaxExportSchedules({
		corporationId: effectiveCorporationId,
		activeOnly: false,
		limit: 100,
		enabled: canView,
	})

	const requestExportMutation = useRequestTaxExport()
	const createScheduleMutation = useCreateTaxExportSchedule()
	const exportArtifactMutation = useTaxExportArtifact()

	const complianceChartRows = useMemo(() => complianceRows.slice(-30), [complianceRows])
	const complianceDueValues = useMemo(
		() => complianceChartRows.map((row) => parseAmount(row.taxDue)),
		[complianceChartRows]
	)
	const compliancePaidValues = useMemo(
		() => complianceChartRows.map((row) => parseAmount(row.taxPaid)),
		[complianceChartRows]
	)
	const complianceMaxValue = useMemo(
		() => Math.max(1, ...complianceDueValues, ...compliancePaidValues),
		[complianceDueValues, compliancePaidValues]
	)
	const complianceDuePoints = useMemo(
		() =>
			toLinePoints(
				complianceDueValues,
				complianceMaxValue,
				COMPLIANCE_CHART_WIDTH,
				COMPLIANCE_CHART_HEIGHT
			),
		[complianceDueValues, complianceMaxValue]
	)
	const compliancePaidPoints = useMemo(
		() =>
			toLinePoints(
				compliancePaidValues,
				complianceMaxValue,
				COMPLIANCE_CHART_WIDTH,
				COMPLIANCE_CHART_HEIGHT
			),
		[complianceMaxValue, compliancePaidValues]
	)

	const exportFilters = useMemo(() => {
		const filters: Record<string, unknown> = {}
		if (effectiveCorporationId) filters.corporationId = effectiveCorporationId
		if (fromDateIso) filters.fromDate = fromDateIso
		if (toDateIso) filters.toDate = toDateIso
		if (refTypeValue) filters.refType = refTypeValue
		if (divisionValue !== undefined) filters.division = divisionValue
		if (minAmountValue) filters.minAmount = minAmountValue
		if (firstPartyIdValue) filters.firstPartyId = firstPartyIdValue
		if (secondPartyIdValue) filters.secondPartyId = secondPartyIdValue

		switch (activeExportReportType) {
			case 'total_taxes_by_corporation':
				filters.sortBy = totalTaxesSortBy
				filters.sortDirection = totalTaxesSortDir
				break
			case 'ess_payout':
				filters.sortBy = essSortBy
				filters.sortDirection = essSortDir
				break
			case 'discrepancies':
				filters.sortBy = discrepancySortBy
				filters.sortDirection = discrepancySortDir
				break
			default:
				break
		}

		return Object.keys(filters).length > 0 ? filters : null
	}, [
		activeExportReportType,
		divisionValue,
		discrepancySortBy,
		discrepancySortDir,
		effectiveCorporationId,
		essSortBy,
		essSortDir,
		firstPartyIdValue,
		fromDateIso,
		minAmountValue,
		refTypeValue,
		secondPartyIdValue,
		toDateIso,
		totalTaxesSortBy,
		totalTaxesSortDir,
	])

	const exportFilterSummary = useMemo(() => {
		const items: string[] = []
		items.push(
			effectiveCorporationId ? `Corporation ${effectiveCorporationId}` : 'All corporations in scope'
		)
		if (fromDate) items.push(`From ${fromDate}`)
		if (toDate) items.push(`To ${toDate}`)
		if (refTypeValue) items.push(`Income type ${formatTaxRefTypeLabel(refTypeValue)}`)
		if (divisionValue !== undefined) items.push(`Division ${divisionValue}`)
		if (minAmountValue) items.push(`Min amount ${minAmountValue}`)
		if (firstPartyIdValue) items.push(`Sender ${firstPartyIdValue}`)
		if (secondPartyIdValue) items.push(`Recipient ${secondPartyIdValue}`)
		return items
	}, [
		divisionValue,
		effectiveCorporationId,
		firstPartyIdValue,
		fromDate,
		minAmountValue,
		refTypeValue,
		secondPartyIdValue,
		toDate,
	])

	const reportEntityIds = useMemo(() => {
		const ids = new Set<string>()

		for (const row of totalTaxesRows) ids.add(row.corporationId)
		for (const row of essRows) {
			ids.add(row.corporationId)
			if (row.firstPartyId) ids.add(row.firstPartyId)
			if (row.secondPartyId) ids.add(row.secondPartyId)
		}
		for (const row of discrepancyRows) ids.add(row.corporationId)
		for (const row of billStatusRows) ids.add(row.corporationId)
		for (const row of missingEsiRows) ids.add(row.corporationId)
		for (const row of excludedRows) ids.add(row.corporationId)
		for (const row of exportsList) if (row.corporationId) ids.add(row.corporationId)
		for (const row of schedules) if (row.corporationId) ids.add(row.corporationId)

		return [...ids]
	}, [
		billStatusRows,
		discrepancyRows,
		essRows,
		excludedRows,
		exportsList,
		missingEsiRows,
		schedules,
		totalTaxesRows,
	])

	const { data: entityNames = {} } = useEntityNames(reportEntityIds, {
		enabled: canView,
	})

	const totalTaxesColumns = useMemo<MRT_ColumnDef<TaxTotalTaxesByCorporationRow>[]>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'assessmentCount',
				header: 'Assessments',
				enableSorting: true,
				Cell: ({ row }) => formatTaxNumber(row.original.assessmentCount),
			},
			{
				accessorKey: 'underpaidCount',
				header: 'Underpaid',
				Cell: ({ row }) => formatTaxNumber(row.original.underpaidCount),
			},
			{
				accessorKey: 'paidCount',
				header: 'Paid',
				Cell: ({ row }) => formatTaxNumber(row.original.paidCount),
			},
			{
				accessorKey: 'overpaidCount',
				header: 'Overpaid',
				Cell: ({ row }) => formatTaxNumber(row.original.overpaidCount),
			},
			{
				accessorKey: 'taxDue',
				header: 'Tax Due',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			},
			{
				accessorKey: 'taxPaid',
				header: 'Tax Paid',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			},
			{
				accessorKey: 'taxDelta',
				header: 'Delta',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			},
		],
		[entityNames]
	)

	const topIncomeColumns = useMemo<MRT_ColumnDef<TaxTopIncomeSourceRow>[]>(
		() => [
			{
				accessorKey: 'refType',
				header: 'Income Type',
				Cell: ({ row }) => formatTaxRefTypeLabel(row.original.refType),
			},
			{
				accessorKey: 'entryCount',
				header: 'Entries',
				Cell: ({ row }) => formatTaxNumber(row.original.entryCount),
			},
			{
				accessorKey: 'essEntryCount',
				header: 'ESS Entries',
				Cell: ({ row }) => formatTaxNumber(row.original.essEntryCount),
			},
			{
				accessorKey: 'totalIncome',
				header: 'Total Income',
				Cell: ({ row }) => formatTaxIskFull(row.original.totalIncome),
			},
		],
		[]
	)

	const essColumns = useMemo<MRT_ColumnDef<TaxEssPayoutRow>[]>(
		() => [
			{
				accessorKey: 'entryDate',
				header: 'Date',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.entryDate),
			},
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'division',
				header: 'Division',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDivisionLabel(row.original.division),
			},
			{ accessorKey: 'essBankType', header: 'Bank Type', enableSorting: true },
			{
				accessorKey: 'amount',
				header: 'Amount',
				enableSorting: true,
				Cell: ({ row }) => formatTaxIskFull(row.original.amount),
			},
			{
				accessorKey: 'firstPartyId',
				header: 'Sender',
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.firstPartyId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'secondPartyId',
				header: 'Recipient',
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.secondPartyId} entityNames={entityNames} />
				),
			},
		],
		[entityNames]
	)

	const discrepancyColumns = useMemo<MRT_ColumnDef<TaxDiscrepancy>[]>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
				),
			},
			{ accessorKey: 'discrepancyType', header: 'Type', enableSorting: true },
			{ accessorKey: 'severity', header: 'Severity', enableSorting: true },
			{
				accessorKey: 'assessmentId',
				header: 'Assessment',
				Cell: ({ row }) => row.original.assessmentId ?? '-',
			},
			{
				accessorKey: 'createdAt',
				header: 'Created',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.createdAt),
			},
			{
				accessorKey: 'details',
				header: 'Details',
				Cell: ({ row }) => (
					<div className="max-w-[24rem] truncate">{toJsonPreview(row.original.details)}</div>
				),
			},
		],
		[entityNames]
	)

	const billStatusColumns = useMemo<MRT_ColumnDef<TaxBillStatusReportRow>[]>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'billStatus',
				header: 'Bill Status',
				Cell: ({ row }) => (
					<Badge variant={row.original.billStatus === 'overdue' ? 'secondary' : 'outline'}>
						{row.original.billStatus}
					</Badge>
				),
			},
			{
				accessorKey: 'assessmentCount',
				header: 'Assessments',
				Cell: ({ row }) => formatTaxNumber(row.original.assessmentCount),
			},
			{
				accessorKey: 'taxDue',
				header: 'Tax Due',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			},
			{
				accessorKey: 'taxPaid',
				header: 'Tax Paid',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			},
			{
				accessorKey: 'taxDelta',
				header: 'Delta',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			},
		],
		[entityNames]
	)

	const complianceColumns = useMemo<MRT_ColumnDef<TaxCompliancePoint>[]>(
		() => [
			{
				accessorKey: 'rollupDate',
				header: 'Date',
				Cell: ({ row }) => formatTaxDateTime(row.original.rollupDate),
			},
			{
				accessorKey: 'taxDue',
				header: 'Tax Due',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDue),
			},
			{
				accessorKey: 'taxPaid',
				header: 'Tax Paid',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxPaid),
			},
			{
				accessorKey: 'taxDelta',
				header: 'Delta',
				Cell: ({ row }) => formatTaxIskFull(row.original.taxDelta),
			},
			{
				accessorKey: 'entryCount',
				header: 'Entries',
				Cell: ({ row }) => formatTaxNumber(row.original.entryCount),
			},
		],
		[]
	)

	const missingEsiColumns = useMemo<MRT_ColumnDef<TaxMissingEsiKeyRow>[]>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'included',
				header: 'Included',
				enableSorting: true,
				Cell: ({ row }) => (row.original.included ? 'yes' : 'no'),
			},
			{
				accessorKey: 'isConfigured',
				header: 'Configured',
				Cell: ({ row }) => (row.original.isConfigured ? 'yes' : 'no'),
			},
			{
				accessorKey: 'missingRequiredScopes',
				header: 'Required Scopes',
				Cell: ({ row }) =>
					row.original.missingRequiredScopes.length > 0
						? row.original.missingRequiredScopes.join(', ')
						: 'complete',
			},
			{
				accessorKey: 'healthyDirectorCount',
				header: 'Healthy Directors',
				enableSorting: true,
				Cell: ({ row }) =>
					`${formatTaxNumber(row.original.healthyDirectorCount)}/${formatTaxNumber(row.original.directorCount)}`,
			},
			{
				accessorKey: 'lastVerified',
				header: 'Last Verified',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.lastVerified),
			},
		],
		[entityNames]
	)

	const excludedColumns = useMemo<MRT_ColumnDef<TaxExcludedCorporationRow>[]>(
		() => [
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				enableSorting: true,
				Cell: ({ row }) => (
					<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
				),
			},
			{
				accessorKey: 'exclusionReason',
				header: 'Reason',
				Cell: ({ row }) => row.original.exclusionReason ?? '-',
			},
			{
				accessorKey: 'updatedAt',
				header: 'Updated',
				enableSorting: true,
				Cell: ({ row }) => formatTaxDateTime(row.original.updatedAt),
			},
		],
		[entityNames]
	)

	const exportHistoryColumns = useMemo<MRT_ColumnDef<TaxExportRecord>[]>(
		() => [
			{
				accessorKey: 'requestedAt',
				header: 'Requested At',
				Cell: ({ row }) => formatTaxDateTime(row.original.requestedAt),
			},
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				Cell: ({ row }) =>
					row.original.corporationId ? (
						<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
					) : (
						'Global'
					),
			},
			{
				accessorKey: 'reportType',
				header: 'Report',
				Cell: ({ row }) => formatTaxReportTypeLabel(row.original.reportType),
			},
			{
				accessorKey: 'format',
				header: 'Format',
				Cell: ({ row }) => row.original.format.toUpperCase(),
			},
			{
				accessorKey: 'status',
				header: 'Status',
				Cell: ({ row }) => (
					<Badge variant={row.original.status === 'failed' ? 'destructive' : 'outline'}>
						{row.original.status}
					</Badge>
				),
			},
			{
				accessorKey: 'rowCount',
				header: 'Rows',
				Cell: ({ row }) => formatTaxNumber(row.original.rowCount),
			},
			{
				accessorKey: 'completedAt',
				header: 'Completed',
				Cell: ({ row }) => formatTaxDateTime(row.original.completedAt),
			},
			{
				id: 'download',
				header: 'Download',
				enableSorting: false,
				Cell: ({ row }) => (
					<Button
						size="sm"
						variant="outline"
						disabled={row.original.status !== 'completed' || exportArtifactMutation.isPending}
						onClick={() =>
							exportArtifactMutation.mutate(row.original.id, {
								onSuccess: (artifact) => {
									downloadBase64File(
										artifact.fileName,
										artifact.contentType,
										artifact.contentBase64
									)
								},
							})
						}
					>
						{exportArtifactMutation.isPending ? 'Preparing...' : 'Download'}
					</Button>
				),
			},
		],
		[entityNames, exportArtifactMutation]
	)

	const scheduleColumns = useMemo<MRT_ColumnDef<TaxExportSchedule>[]>(
		() => [
			{ accessorKey: 'name', header: 'Name' },
			{
				accessorKey: 'corporationId',
				header: 'Corporation',
				Cell: ({ row }) =>
					row.original.corporationId ? (
						<TaxEntityDisplay entityId={row.original.corporationId} entityNames={entityNames} />
					) : (
						'Global'
					),
			},
			{
				accessorKey: 'reportType',
				header: 'Report',
				Cell: ({ row }) => formatTaxReportTypeLabel(row.original.reportType),
			},
			{
				accessorKey: 'format',
				header: 'Format',
				Cell: ({ row }) => row.original.format.toUpperCase(),
			},
			{ accessorKey: 'frequency', header: 'Frequency' },
			{
				accessorKey: 'isActive',
				header: 'Active',
				Cell: ({ row }) => (
					<Badge variant={row.original.isActive ? 'default' : 'secondary'}>
						{row.original.isActive ? 'active' : 'paused'}
					</Badge>
				),
			},
			{
				accessorKey: 'nextRunAt',
				header: 'Next Run',
				Cell: ({ row }) => formatTaxDateTime(row.original.nextRunAt),
			},
			{
				accessorKey: 'lastRunAt',
				header: 'Last Run',
				Cell: ({ row }) => formatTaxDateTime(row.original.lastRunAt),
			},
		],
		[entityNames]
	)

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container size="wide" className="xl:max-w-[92rem]">
				<Card>
					<CardHeader>
						<CardTitle>Tax Reports</CardTitle>
						<CardDescription>You do not have permission to view tax reports.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	return (
		<Container size="wide" className="xl:max-w-[92rem]">
			<PageHeader
				title="Tax Reports"
				description="Review tax reports through a single active report view, then export or schedule the output."
			/>

			<Section>
				<Card>
					<CardHeader>
						<CardTitle>Report Filters</CardTitle>
						<CardDescription>
							These filters apply to the active report and are persisted into export payloads.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-3 md:grid-cols-4">
						<FilterField label="Date range">
							<DateRangeInput
								value={{ fromDate, toDate }}
								onChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
									setFromDate(nextFromDate)
									setToDate(nextToDate)
								}}
								placeholder="Date range"
							/>
						</FilterField>
						<FilterField label="Corporation">
							<TaxCorporationScopeSelector
								corporations={accessibleCorporations}
								effectiveCorporationId={effectiveCorporationId}
								selectedCorporationId={selectedCorporationId}
								canSelectAll={canViewWithUrn}
								onSelect={setSelectedCorporationId}
								showLabel={false}
								className="sm:max-w-none"
							/>
						</FilterField>
						<FilterField label="Income type">
							<SearchSelect
								value={incomeTypeQuery}
								onValueChange={setIncomeTypeQuery}
								options={incomeTypeOptions}
								onSelect={(option) => {
									setIncomeTypeQuery('')
									setRefTypeFilter(option.value)
								}}
								filterMode="local"
								mode="dropdown"
								minQueryLength={0}
								listMaxHeight={420}
								placeholder={
									refTypeFilter ? formatTaxRefTypeLabel(refTypeFilter) : 'All income types'
								}
								emptyText="No income types match"
							/>
						</FilterField>
						<FilterField label="Division">
							<SearchSelect
								value={divisionQuery}
								onValueChange={setDivisionQuery}
								options={divisionOptions}
								onSelect={(option) => {
									setDivisionFilter(option.value)
									setDivisionQuery('')
								}}
								filterMode="local"
								mode="dropdown"
								minQueryLength={0}
								disabled={!effectiveCorporationId}
								placeholder={
									divisionFilter ? formatTaxDivisionLabel(divisionFilter) : 'All divisions'
								}
								emptyText="No wallet divisions found"
							/>
						</FilterField>
						<FilterField label="Sender">
							<Input
								value={firstPartyIdFilter}
								onChange={(event) => setFirstPartyIdFilter(event.target.value)}
								placeholder="Sender"
							/>
						</FilterField>
						<FilterField label="Recipient">
							<Input
								value={secondPartyIdFilter}
								onChange={(event) => setSecondPartyIdFilter(event.target.value)}
								placeholder="Recipient"
							/>
						</FilterField>
						<FilterField label="Min amount">
							<Input
								value={minAmountFilter}
								onChange={(event) => setMinAmountFilter(event.target.value)}
								placeholder="Min amount"
							/>
						</FilterField>
					</CardContent>
				</Card>

				<div className="space-y-4">
					<div className="space-y-1">
						<h2 className="text-lg font-semibold tracking-tight">Summary</h2>
						<p className="text-sm text-muted-foreground">Reflects the current filter state.</p>
					</div>
					<div className="grid gap-4 md:grid-cols-4">
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Tax Due</CardTitle>
							</CardHeader>
							<CardContent className="text-xl font-semibold">
								{formatTaxIskCompact(summaryReport?.taxDue ?? '0')}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Tax Paid</CardTitle>
							</CardHeader>
							<CardContent className="text-xl font-semibold">
								{formatTaxIskCompact(summaryReport?.taxPaid ?? '0')}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Tax Delta</CardTitle>
							</CardHeader>
							<CardContent className="text-xl font-semibold">
								{formatTaxIskCompact(summaryReport?.taxDelta ?? '0')}
							</CardContent>
						</Card>
						<Card>
							<CardHeader className="pb-2">
								<CardTitle className="text-sm">Assessments</CardTitle>
							</CardHeader>
							<CardContent className="text-xl font-semibold">
								{(summaryReport?.assessmentCount ?? 0).toLocaleString('en-US')}
							</CardContent>
						</Card>
					</div>
					{summaryLoading ? (
						<div className="text-sm text-muted-foreground">Loading summary...</div>
					) : summaryError ? (
						<div className="text-sm text-destructive">
							{summaryError instanceof Error ? summaryError.message : 'Failed to load summary'}
						</div>
					) : !summaryReport ? (
						<div className="text-sm text-muted-foreground">
							No summary data is available for the current scope and date range.
						</div>
					) : null}
				</div>

				<Card>
					<CardHeader>
						<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
							<div>
								<CardTitle>Report</CardTitle>
								<CardDescription className="mt-1">
									{selectedReportOption?.description}
								</CardDescription>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									onClick={() => setExportModalOpen(true)}
									disabled={!canExport || !activeReportIsExportable}
								>
									Export
								</Button>
								<Button
									variant="outline"
									onClick={() => setScheduleModalOpen(true)}
									disabled={!canCreateSchedule || !activeReportIsExportable}
								>
									Schedule
								</Button>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="md:hidden">
							<SearchSelect
								value={reportSelectorQuery}
								onValueChange={setReportSelectorQuery}
								options={toSearchOptions(
									visibleReportOptions.map((option) => ({
										value: option.value,
										label: option.label,
									}))
								)}
								onSelect={(option) => {
									setReportSelectorQuery('')
									setSelectedReportView(option.id as TaxReportView)
								}}
								filterMode="local"
								mode="dropdown"
								minQueryLength={0}
								placeholder="Choose report"
								emptyText="No reports match"
							/>
						</div>

						<div className="hidden md:block overflow-x-auto">
							<Tabs
								value={selectedReportView}
								onValueChange={(value) => setSelectedReportView(value as TaxReportView)}
							>
								<TabsList>
									{visibleReportOptions.map((option) => (
										<TabsTrigger key={option.value} value={option.value}>
											{option.label}
										</TabsTrigger>
									))}
								</TabsList>
							</Tabs>
						</div>

						{selectedReportView === 'total_taxes_by_corporation' ? (
							<TaxReportDataGrid
								columns={totalTaxesColumns}
								rows={totalTaxesRows}
								loading={totalTaxesLoading}
								error={totalTaxesError}
								emptyMessage="No totals found."
								sorting={toSorting(totalTaxesSortBy, totalTaxesSortDir)}
								onSortingChange={(sorting) =>
									applySorting(
										sorting,
										'taxDue',
										'desc',
										setTotalTaxesSortBy,
										setTotalTaxesSortDir,
										() => setTotalTaxesPage(0)
									)
								}
								page={totalTaxesPage}
								onPreviousPage={() => setTotalTaxesPage((page) => Math.max(page - 1, 0))}
								onNextPage={() => setTotalTaxesPage((page) => page + 1)}
								hasNextPage={totalTaxesRows.length >= REPORT_PAGE_SIZE}
							/>
						) : null}

						{selectedReportView === 'top_income_sources' ? (
							<TaxReportDataGrid
								columns={topIncomeColumns}
								rows={topIncomeRows}
								loading={topIncomeLoading}
								error={topIncomeError}
								emptyMessage="No income sources found."
							/>
						) : null}

						{selectedReportView === 'ess_payout' ? (
							<TaxReportDataGrid
								columns={essColumns}
								rows={essRows}
								loading={essLoading}
								error={essError}
								emptyMessage="No ESS rows found."
								sorting={toSorting(essSortBy, essSortDir)}
								onSortingChange={(sorting) =>
									applySorting(sorting, 'entryDate', 'desc', setEssSortBy, setEssSortDir, () =>
										setEssPage(0)
									)
								}
								page={essPage}
								onPreviousPage={() => setEssPage((page) => Math.max(page - 1, 0))}
								onNextPage={() => setEssPage((page) => page + 1)}
								hasNextPage={essRows.length >= REPORT_PAGE_SIZE}
							/>
						) : null}

						{selectedReportView === 'discrepancies' ? (
							<TaxReportDataGrid
								columns={discrepancyColumns}
								rows={discrepancyRows}
								loading={discrepancyLoading}
								error={discrepancyError}
								emptyMessage="No open discrepancies found."
								sorting={toSorting(discrepancySortBy, discrepancySortDir)}
								onSortingChange={(sorting) =>
									applySorting(
										sorting,
										'createdAt',
										'desc',
										setDiscrepancySortBy,
										setDiscrepancySortDir,
										() => setDiscrepancyPage(0)
									)
								}
								page={discrepancyPage}
								onPreviousPage={() => setDiscrepancyPage((page) => Math.max(page - 1, 0))}
								onNextPage={() => setDiscrepancyPage((page) => page + 1)}
								hasNextPage={discrepancyRows.length >= REPORT_PAGE_SIZE}
							/>
						) : null}

						{selectedReportView === 'bill_status' ? (
							<TaxReportDataGrid
								columns={billStatusColumns}
								rows={billStatusRows}
								loading={billStatusLoading}
								error={billStatusError}
								emptyMessage="No bill status rows found."
							/>
						) : null}

						{selectedReportView === 'compliance_over_time' ? (
							<div className="space-y-4">
								{complianceLoading ? (
									<div className="py-8 text-sm text-muted-foreground">
										Loading compliance trend...
									</div>
								) : complianceError ? (
									<div className="py-8 text-sm text-destructive">
										{complianceError instanceof Error
											? complianceError.message
											: 'Failed to load compliance report'}
									</div>
								) : complianceRows.length === 0 ? (
									<div className="py-8 text-sm text-muted-foreground">
										No compliance trend points available.
									</div>
								) : (
									<>
										<div className="rounded border bg-muted/20 p-3">
											<svg
												viewBox={`0 0 ${COMPLIANCE_CHART_WIDTH} ${COMPLIANCE_CHART_HEIGHT}`}
												className="h-40 w-full"
												role="img"
												aria-label="Compliance trend chart"
											>
												<polyline
													points={complianceDuePoints}
													fill="none"
													stroke="hsl(var(--destructive))"
													strokeWidth="3"
													strokeLinecap="round"
												/>
												<polyline
													points={compliancePaidPoints}
													fill="none"
													stroke="hsl(var(--primary))"
													strokeWidth="3"
													strokeLinecap="round"
												/>
											</svg>
											<div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
												<div className="flex items-center gap-2">
													<span className="h-2 w-2 rounded-full bg-destructive" />
													Tax Due
												</div>
												<div className="flex items-center gap-2">
													<span className="h-2 w-2 rounded-full bg-primary" />
													Tax Paid
												</div>
												<div>Showing latest {complianceChartRows.length} points</div>
											</div>
										</div>

										<TaxReportDataGrid
											columns={complianceColumns}
											rows={complianceRows}
											loading={false}
											emptyMessage="No compliance trend points available."
										/>
									</>
								)}
							</div>
						) : null}

						{selectedReportView === 'missing_esi_keys' ? (
							<TaxReportDataGrid
								columns={missingEsiColumns}
								rows={missingEsiRows}
								loading={missingEsiLoading}
								error={missingEsiError}
								emptyMessage="No missing ESI key coverage found."
								sorting={toSorting(missingEsiSortBy, missingEsiSortDir)}
								onSortingChange={(sorting) =>
									applySorting(
										sorting,
										'lastVerified',
										'desc',
										setMissingEsiSortBy,
										setMissingEsiSortDir,
										() => setMissingEsiPage(0)
									)
								}
								page={missingEsiPage}
								onPreviousPage={() => setMissingEsiPage((page) => Math.max(page - 1, 0))}
								onNextPage={() => setMissingEsiPage((page) => page + 1)}
								hasNextPage={missingEsiRows.length >= REPORT_PAGE_SIZE}
							/>
						) : null}

						{selectedReportView === 'excluded_corporations' ? (
							<TaxReportDataGrid
								columns={excludedColumns}
								rows={excludedRows}
								loading={excludedRowsLoading}
								error={excludedRowsError}
								emptyMessage="No corporations are currently excluded."
								sorting={toSorting(excludedSortBy, excludedSortDir)}
								onSortingChange={(sorting) =>
									applySorting(
										sorting,
										'updatedAt',
										'desc',
										setExcludedSortBy,
										setExcludedSortDir,
										() => setExcludedPage(0)
									)
								}
								page={excludedPage}
								onPreviousPage={() => setExcludedPage((page) => Math.max(page - 1, 0))}
								onNextPage={() => setExcludedPage((page) => page + 1)}
								hasNextPage={excludedRows.length >= REPORT_PAGE_SIZE}
							/>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Recent Exports</CardTitle>
						<CardDescription>
							Review recent export runs and download their artifacts.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{requestExportMutation.error ? (
							<div className="text-sm text-destructive">
								{requestExportMutation.error instanceof Error
									? requestExportMutation.error.message
									: 'Failed to request export'}
							</div>
						) : null}

						<TaxReportDataGrid
							columns={exportHistoryColumns}
							rows={exportsList}
							loading={exportsLoading}
							error={exportsError}
							emptyMessage="No export runs found."
						/>

						{exportArtifactMutation.error ? (
							<div className="text-sm text-destructive">
								{exportArtifactMutation.error instanceof Error
									? exportArtifactMutation.error.message
									: 'Failed to download export artifact'}
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Recurring Export Schedules</CardTitle>
						<CardDescription>Review recurring export jobs for this scope.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{createScheduleMutation.error ? (
							<div className="text-sm text-destructive">
								{createScheduleMutation.error instanceof Error
									? createScheduleMutation.error.message
									: 'Failed to create schedule'}
							</div>
						) : null}

						<TaxReportDataGrid
							columns={scheduleColumns}
							rows={schedules}
							loading={schedulesLoading}
							error={schedulesError}
							emptyMessage="No export schedules found."
						/>
					</CardContent>
				</Card>

				<Dialog open={exportModalOpen} onOpenChange={setExportModalOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Export Active Report</DialogTitle>
							<DialogDescription>
								Create a one-off export for{' '}
								{selectedReportOption?.label?.toLowerCase() ?? 'the active report'} using the
								current scope and filters.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<div className="space-y-1 text-sm">
								<div className="font-medium text-foreground">Report</div>
								<div className="text-muted-foreground">{selectedReportOption?.label}</div>
							</div>
							<div className="space-y-1 text-sm">
								<div className="font-medium text-foreground">Applied Filters</div>
								<div className="flex flex-wrap gap-2">
									{exportFilterSummary.map((item) => (
										<Badge key={item} variant="secondary">
											{item}
										</Badge>
									))}
								</div>
							</div>
							<div className="space-y-2">
								<div className="text-sm font-medium text-foreground">Format</div>
								<Select
									value={selectedExportFormat}
									onValueChange={(value) => setSelectedExportFormat(value as TaxExportFormat)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Format" />
									</SelectTrigger>
									<SelectContent>
										{exportFormatOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setExportModalOpen(false)}>
								Cancel
							</Button>
							<Button
								onClick={() => {
									if (!activeExportReportType) return
									requestExportMutation.mutate(
										{
											corporationId: effectiveCorporationId,
											format: selectedExportFormat,
											reportType: activeExportReportType,
											filters: exportFilters,
											sourceEsiVersion: 'esi-v1',
										},
										{ onSuccess: () => setExportModalOpen(false) }
									)
								}}
								disabled={!canExport || !activeExportReportType || requestExportMutation.isPending}
							>
								{requestExportMutation.isPending ? 'Requesting Export...' : 'Request Export'}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog open={scheduleModalOpen} onOpenChange={setScheduleModalOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Schedule Export</DialogTitle>
							<DialogDescription>
								Create a recurring export for{' '}
								{selectedReportOption?.label?.toLowerCase() ?? 'the active report'} using the
								current scope and filters.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-4">
							<Input
								value={scheduleName}
								onChange={(event) => setScheduleName(event.target.value)}
								placeholder="Schedule name"
							/>
							<div className="grid gap-3 md:grid-cols-2">
								<Select
									value={selectedScheduleFormat}
									onValueChange={(value) => setSelectedScheduleFormat(value as TaxExportFormat)}
								>
									<SelectTrigger>
										<SelectValue placeholder="Format" />
									</SelectTrigger>
									<SelectContent>
										{exportFormatOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Select
									value={scheduleFrequency}
									onValueChange={(value) => setScheduleFrequency(value as 'weekly' | 'monthly')}
								>
									<SelectTrigger>
										<SelectValue placeholder="Frequency" />
									</SelectTrigger>
									<SelectContent>
										{scheduleFrequencyOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="space-y-1 text-sm">
								<div className="font-medium text-foreground">Applied Filters</div>
								<div className="flex flex-wrap gap-2">
									{exportFilterSummary.map((item) => (
										<Badge key={item} variant="secondary">
											{item}
										</Badge>
									))}
								</div>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" onClick={() => setScheduleModalOpen(false)}>
								Cancel
							</Button>
							<Button
								onClick={() => {
									if (!activeExportReportType) return
									createScheduleMutation.mutate(
										{
											name: scheduleName.trim() || 'Tax Export Schedule',
											corporationId: effectiveCorporationId,
											format: selectedScheduleFormat,
											frequency: scheduleFrequency,
											reportType: activeExportReportType,
											filters: exportFilters,
										},
										{ onSuccess: () => setScheduleModalOpen(false) }
									)
								}}
								disabled={
									!canCreateSchedule || !activeExportReportType || createScheduleMutation.isPending
								}
							>
								{createScheduleMutation.isPending ? 'Creating Schedule...' : 'Create Schedule'}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</Section>
		</Container>
	)
}
