import { useEffect, useMemo, useState } from 'react'

import {
	TaxExportHistoryPanel,
	TaxExportSchedulesPanel,
	TaxReportFiltersCard,
	TaxSummaryCards,
} from '@/components/tax-reports/report-panels'
import { TaxReportWorkspace } from '@/components/tax-reports/report-workspace'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	useCreateTaxExportSchedule,
	useRequestTaxExport,
	useTaxCapabilities,
	useTaxExportArtifact,
	useTaxExports,
	useTaxExportSchedules,
	useTaxSummaryReport,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { getCurrentMonthDateRange } from '@/lib/tax-date'
import { downloadBase64File, toEndOfDayIso, toStartOfDayIso } from '@/lib/tax-report-utils'

import type { TaxExportFormat, TaxExportReportType } from '@repo/corporation-tax'
import type { SortDirection } from '@/lib/tax-report-utils'

type TaxReportView = TaxExportReportType | 'missing_esi_keys'

const reportViewOptions: Array<{
	value: TaxReportView
	label: string
	description: string
	exportable: boolean
	requiresAdminScope?: boolean
}> = [
	{
		value: 'total_taxes_by_corporation',
		label: 'Total Taxes',
		description: 'Corporation-level due, paid, and delta for the selected filter period.',
		exportable: true,
	},
	{
		value: 'top_income_sources',
		label: 'Income Sources',
		description: 'Taxable inflow grouped by income type.',
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
		description: 'Period-level tax due, paid, and delta over time.',
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
		description: 'Assessment-level bill lifecycle, period window, and payment totals.',
		exportable: true,
	},
	{
		value: 'missing_esi_keys',
		label: 'Missing ESI Keys',
		description: 'Corporations with incomplete ESI key or scope coverage.',
		exportable: false,
		requiresAdminScope: true,
	},
]

const exportFormatOptions: Array<{ value: TaxExportFormat; label: string }> = [
	{ value: 'csv', label: 'CSV' },
	{ value: 'xlsx', label: 'XLSX' },
]

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()

const scheduleFrequencyOptions: Array<{ value: 'weekly' | 'monthly'; label: string }> = [
	{ value: 'weekly', label: 'Weekly' },
	{ value: 'monthly', label: 'Monthly' },
]

export default function TaxReportsPage() {
	usePageTitle('Tax Reports')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canAdminScope = globalCapabilities?.global.canAudit ?? false
	const canAdminExport = globalCapabilities?.global.canAudit ?? false
	const canAdminManageSchedules = globalCapabilities?.global.canAudit ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canAdminScope)

	const [selectedReportView, setSelectedReportView] = useState<TaxReportView>(
		'total_taxes_by_corporation'
	)
	const [reportSelectorQuery, setReportSelectorQuery] = useState('Total Taxes')
	const [selectedExportFormat, setSelectedExportFormat] = useState<TaxExportFormat>('csv')
	const [selectedScheduleFormat, setSelectedScheduleFormat] = useState<TaxExportFormat>('csv')
	const [scheduleName, setScheduleName] = useState('Weekly Tax Summary')
	const [scheduleFrequency, setScheduleFrequency] = useState<'weekly' | 'monthly'>('weekly')
	const [fromDate, setFromDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [toDate, setToDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [totalTaxesExportSort, setTotalTaxesExportSort] = useState<{
		sortBy: string
		sortDir: SortDirection
	}>({
		sortBy: 'taxDue',
		sortDir: 'desc',
	})
	const [essExportSort, setEssExportSort] = useState<{
		sortBy: string
		sortDir: SortDirection
	}>({
		sortBy: 'entryDate',
		sortDir: 'desc',
	})
	const [discrepancyExportSort, setDiscrepancyExportSort] = useState<{
		sortBy: string
		sortDir: SortDirection
	}>({
		sortBy: 'createdAt',
		sortDir: 'desc',
	})

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canAuditScoped = scopedCapabilities?.scoped.canAudit ?? false
	const canManageScoped = canAuditScoped
	const canView = canAdminScope || canAuditScoped
	const canExport = canAdminExport || canAuditScoped
	const canCreateSchedule = canAdminManageSchedules || canManageScoped

	const visibleReportOptions = useMemo(
		() => reportViewOptions.filter((option) => !option.requiresAdminScope || canAdminScope),
		[canAdminScope]
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

	const fromDateIso = fromDate ? toStartOfDayIso(fromDate) : undefined
	const toDateIso = toDate ? toEndOfDayIso(toDate) : undefined

	const reportWindowFilters = useMemo(
		() => ({
			corporationId: effectiveCorporationId,
			fromDate: fromDateIso,
			toDate: toDateIso,
		}),
		[effectiveCorporationId, fromDateIso, toDateIso]
	)

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

	const exportFilters = useMemo(() => {
		const filters: Record<string, unknown> = {}
		if (effectiveCorporationId) filters.corporationId = effectiveCorporationId
		if (fromDateIso) filters.fromDate = fromDateIso
		if (toDateIso) filters.toDate = toDateIso

		switch (activeExportReportType) {
			case 'total_taxes_by_corporation':
				filters.sortBy = totalTaxesExportSort.sortBy
				filters.sortDirection = totalTaxesExportSort.sortDir
				break
			case 'ess_payout':
				filters.sortBy = essExportSort.sortBy
				filters.sortDirection = essExportSort.sortDir
				break
			case 'discrepancies':
				filters.sortBy = discrepancyExportSort.sortBy
				filters.sortDirection = discrepancyExportSort.sortDir
				break
			default:
				break
		}

		return Object.keys(filters).length > 0 ? filters : null
	}, [
		activeExportReportType,
		discrepancyExportSort,
		essExportSort,
		effectiveCorporationId,
		fromDateIso,
		toDateIso,
		totalTaxesExportSort,
	])

	const exportFilterSummary = useMemo(() => {
		const items: string[] = []
		items.push(
			effectiveCorporationId ? `Corporation ${effectiveCorporationId}` : 'All corporations in scope'
		)
		if (fromDate) items.push(`From ${fromDate}`)
		if (toDate) items.push(`To ${toDate}`)
		return items
	}, [effectiveCorporationId, fromDate, toDate])

	const reportEntityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of exportsList) if (row.corporationId) ids.add(row.corporationId)
		for (const row of schedules) if (row.corporationId) ids.add(row.corporationId)

		return [...ids]
	}, [exportsList, schedules])

	const { data: entityNames = {} } = useEntityNames(reportEntityIds, {
		enabled: canView,
	})

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container size="wide">
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
		<Container size="wide">
			<PageHeader
				title="Tax Reports"
				description="Review tax reports through a single active report view, then export or schedule the output."
			/>

			<Section>
				<TaxReportFiltersCard
					fromDate={fromDate}
					toDate={toDate}
					onDateRangeChange={({ fromDate: nextFromDate, toDate: nextToDate }) => {
						setFromDate(nextFromDate)
						setToDate(nextToDate)
					}}
					accessibleCorporations={accessibleCorporations}
					effectiveCorporationId={effectiveCorporationId}
					selectedCorporationId={selectedCorporationId}
					canAdminScope={canAdminScope}
					onSelectCorporation={setSelectedCorporationId}
				/>

				<TaxSummaryCards
					summaryReport={summaryReport}
					loading={summaryLoading}
					error={summaryError}
				/>

				<TaxReportWorkspace
					selectedReportView={selectedReportView}
					onSelectReportView={setSelectedReportView}
					reportSelectorQuery={reportSelectorQuery}
					onReportSelectorQueryChange={setReportSelectorQuery}
					visibleReportOptions={visibleReportOptions}
					selectedReportDescription={selectedReportOption?.description}
					canView={canView}
					canAdminScope={canAdminScope}
					canExport={canExport}
					canCreateSchedule={canCreateSchedule}
					activeReportIsExportable={activeReportIsExportable}
					activeExportReportType={activeExportReportType}
					reportWindowFilters={reportWindowFilters}
					onTotalTaxesSortChange={(sortBy, sortDir) => setTotalTaxesExportSort({ sortBy, sortDir })}
					onEssSortChange={(sortBy, sortDir) => setEssExportSort({ sortBy, sortDir })}
					onDiscrepancySortChange={(sortBy, sortDir) =>
						setDiscrepancyExportSort({ sortBy, sortDir })
					}
					selectedExportFormat={selectedExportFormat}
					onSelectExportFormat={setSelectedExportFormat}
					selectedScheduleFormat={selectedScheduleFormat}
					onSelectScheduleFormat={setSelectedScheduleFormat}
					scheduleName={scheduleName}
					onScheduleNameChange={setScheduleName}
					scheduleFrequency={scheduleFrequency}
					onSelectScheduleFrequency={setScheduleFrequency}
					exportFormatOptions={exportFormatOptions}
					scheduleFrequencyOptions={scheduleFrequencyOptions}
					exportFilterSummary={exportFilterSummary}
					exportSubmitting={requestExportMutation.isPending}
					scheduleSubmitting={createScheduleMutation.isPending}
					onSubmitExport={async () => {
						if (!activeExportReportType) return
						await requestExportMutation.mutateAsync({
							corporationId: effectiveCorporationId,
							format: selectedExportFormat,
							reportType: activeExportReportType,
							filters: exportFilters,
							sourceEsiVersion: 'esi-v1',
						})
					}}
					onSubmitSchedule={async () => {
						if (!activeExportReportType) return
						await createScheduleMutation.mutateAsync({
							name: scheduleName.trim() || 'Tax Export Schedule',
							corporationId: effectiveCorporationId,
							format: selectedScheduleFormat,
							frequency: scheduleFrequency,
							reportType: activeExportReportType,
							filters: exportFilters,
						})
					}}
				/>

				<TaxExportHistoryPanel
					rows={exportsList}
					loading={exportsLoading}
					error={exportsError}
					entityNames={entityNames}
					requestError={requestExportMutation.error}
					downloadError={exportArtifactMutation.error}
					downloading={exportArtifactMutation.isPending}
					onDownload={(exportId) =>
						exportArtifactMutation.mutate(exportId, {
							onSuccess: (artifact) => {
								downloadBase64File(artifact.fileName, artifact.contentType, artifact.contentBase64)
							},
						})
					}
				/>

				<TaxExportSchedulesPanel
					rows={schedules}
					loading={schedulesLoading}
					error={schedulesError}
					entityNames={entityNames}
					createScheduleError={createScheduleMutation.error}
				/>
			</Section>
		</Container>
	)
}
