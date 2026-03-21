import { useEffect, useMemo, useState } from 'react'

import { TaxReportSelector } from '@/components/tax-reports/report-display'
import {
	TaxExportDialog,
	TaxExportHistoryPanel,
	TaxExportSchedulesPanel,
	TaxPanelCard,
	TaxReportFiltersCard,
	TaxScheduleDialog,
	TaxSummaryCards,
} from '@/components/tax-reports/report-panels'
import {
	BillStatusReportSection,
	ComplianceOverTimeReportSection,
	DiscrepancyReportSection,
	EssPayoutReportSection,
	MissingEsiKeysReportSection,
	TopIncomeSourcesReportSection,
	TotalTaxesReportSection,
} from '@/components/tax-reports/report-sections'
import { Button } from '@/components/ui/button'
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
	useTaxWalletDivisions,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { getCurrentMonthDateRange } from '@/lib/tax-date'
import {
	formatTaxDivisionLabel,
	formatTaxRefTypeLabel,
	TAX_REF_TYPE_OPTIONS,
} from '@/lib/tax-display'
import {
	downloadBase64File,
	toEndOfDayIso,
	toSearchOptions,
	toStartOfDayIso,
} from '@/lib/tax-report-utils'

import type { TaxExportFormat, TaxExportReportType } from '@repo/corporation-tax'
import type { SortDirection } from '@/lib/tax-report-utils'

type TaxReportView = TaxExportReportType | 'missing_esi_keys'

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
		if (refTypeValue) filters.refType = refTypeValue
		if (divisionValue !== undefined) filters.division = divisionValue
		if (minAmountValue) filters.minAmount = minAmountValue
		if (firstPartyIdValue) filters.firstPartyId = firstPartyIdValue
		if (secondPartyIdValue) filters.secondPartyId = secondPartyIdValue

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
		divisionValue,
		discrepancyExportSort,
		essExportSort,
		effectiveCorporationId,
		firstPartyIdValue,
		fromDateIso,
		minAmountValue,
		refTypeValue,
		secondPartyIdValue,
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
		for (const row of exportsList) if (row.corporationId) ids.add(row.corporationId)
		for (const row of schedules) if (row.corporationId) ids.add(row.corporationId)

		return [...ids]
	}, [exportsList, schedules])

	const { data: entityNames = {} } = useEntityNames(reportEntityIds, {
		enabled: canView,
	})

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
					canViewWithUrn={canViewWithUrn}
					onSelectCorporation={setSelectedCorporationId}
					incomeTypeQuery={incomeTypeQuery}
					onIncomeTypeQueryChange={setIncomeTypeQuery}
					incomeTypeOptions={incomeTypeOptions}
					refTypeFilter={refTypeFilter}
					onSelectRefType={(value) => {
						setIncomeTypeQuery('')
						setRefTypeFilter(value)
					}}
					divisionQuery={divisionQuery}
					onDivisionQueryChange={setDivisionQuery}
					divisionOptions={divisionOptions}
					divisionFilter={divisionFilter}
					onSelectDivision={(value) => {
						setDivisionFilter(value)
						setDivisionQuery('')
					}}
					effectiveScopeCorporationId={effectiveCorporationId}
					firstPartyIdFilter={firstPartyIdFilter}
					onFirstPartyIdFilterChange={setFirstPartyIdFilter}
					secondPartyIdFilter={secondPartyIdFilter}
					onSecondPartyIdFilterChange={setSecondPartyIdFilter}
					minAmountFilter={minAmountFilter}
					onMinAmountFilterChange={setMinAmountFilter}
				/>

				<TaxSummaryCards
					summaryReport={summaryReport}
					loading={summaryLoading}
					error={summaryError}
				/>

				<TaxPanelCard
					title="Report"
					description={selectedReportOption?.description}
					actions={
						<>
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
						</>
					}
					contentClassName="space-y-4"
				>
					<TaxReportSelector
						selectedReportView={selectedReportView}
						onSelectReportView={(value) => setSelectedReportView(value as TaxReportView)}
						reportSelectorQuery={reportSelectorQuery}
						onReportSelectorQueryChange={setReportSelectorQuery}
						visibleReportOptions={visibleReportOptions}
					/>

					{selectedReportView === 'total_taxes_by_corporation' ? (
						<TotalTaxesReportSection
							filters={reportWindowFilters}
							enabled={canView}
							onSortChange={(sortBy, sortDir) => setTotalTaxesExportSort({ sortBy, sortDir })}
						/>
					) : null}

					{selectedReportView === 'top_income_sources' ? (
						<TopIncomeSourcesReportSection filters={reportWindowFilters} enabled={canView} />
					) : null}

					{selectedReportView === 'ess_payout' ? (
						<EssPayoutReportSection
							filters={reportWindowFilters}
							enabled={canView}
							onSortChange={(sortBy, sortDir) => setEssExportSort({ sortBy, sortDir })}
						/>
					) : null}

					{selectedReportView === 'discrepancies' ? (
						<DiscrepancyReportSection
							filters={{
								corporationId: reportWindowFilters.corporationId,
								fromDate: reportWindowFilters.fromDate,
								toDate: reportWindowFilters.toDate,
							}}
							enabled={canView}
							onSortChange={(sortBy, sortDir) => setDiscrepancyExportSort({ sortBy, sortDir })}
						/>
					) : null}

					{selectedReportView === 'bill_status' ? (
						<BillStatusReportSection filters={reportWindowFilters} enabled={canView} />
					) : null}

					{selectedReportView === 'compliance_over_time' ? (
						<ComplianceOverTimeReportSection filters={reportWindowFilters} enabled={canView} />
					) : null}

					{selectedReportView === 'missing_esi_keys' ? (
						<MissingEsiKeysReportSection enabled={canViewWithUrn} />
					) : null}
				</TaxPanelCard>

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

				<TaxExportDialog
					open={exportModalOpen}
					onOpenChange={setExportModalOpen}
					selectedReportLabel={selectedReportOption?.label}
					filterSummary={exportFilterSummary}
					selectedExportFormat={selectedExportFormat}
					onSelectExportFormat={setSelectedExportFormat}
					exportFormatOptions={exportFormatOptions}
					canExport={canExport}
					canSubmit={Boolean(activeExportReportType)}
					submitting={requestExportMutation.isPending}
					onSubmit={() => {
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
				/>

				<TaxScheduleDialog
					open={scheduleModalOpen}
					onOpenChange={setScheduleModalOpen}
					selectedReportLabel={selectedReportOption?.label}
					filterSummary={exportFilterSummary}
					scheduleName={scheduleName}
					onScheduleNameChange={setScheduleName}
					selectedScheduleFormat={selectedScheduleFormat}
					onSelectScheduleFormat={setSelectedScheduleFormat}
					scheduleFrequency={scheduleFrequency}
					onSelectScheduleFrequency={setScheduleFrequency}
					exportFormatOptions={exportFormatOptions}
					scheduleFrequencyOptions={scheduleFrequencyOptions}
					canCreateSchedule={canCreateSchedule}
					canSubmit={Boolean(activeExportReportType)}
					submitting={createScheduleMutation.isPending}
					onSubmit={() => {
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
				/>
			</Section>
		</Container>
	)
}
