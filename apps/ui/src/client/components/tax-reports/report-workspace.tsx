import { useState } from 'react'

import { TaxReportSelector } from '@/components/tax-reports/report-display'
import {
	TaxExportDialog,
	TaxPanelCard,
	TaxScheduleDialog,
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

import type { TaxExportFormat, TaxExportReportType } from '@repo/corporation-tax'
import type { TaxRollupReportQueryFilters } from '@/hooks/corporation-tax'
import type { SortDirection } from '@/lib/tax-report-utils'

export type TaxReportView = TaxExportReportType | 'missing_esi_keys'

export function TaxReportWorkspace({
	selectedReportView,
	onSelectReportView,
	reportSelectorQuery,
	onReportSelectorQueryChange,
	visibleReportOptions,
	selectedReportDescription,
	canView,
	canAdminScope,
	canExport,
	canCreateSchedule,
	activeReportIsExportable,
	activeExportReportType,
	reportWindowFilters,
	onTotalTaxesSortChange,
	onEssSortChange,
	onDiscrepancySortChange,
	selectedExportFormat,
	onSelectExportFormat,
	selectedScheduleFormat,
	onSelectScheduleFormat,
	scheduleName,
	onScheduleNameChange,
	scheduleFrequency,
	onSelectScheduleFrequency,
	exportFormatOptions,
	scheduleFrequencyOptions,
	exportFilterSummary,
	exportSubmitting,
	scheduleSubmitting,
	onSubmitExport,
	onSubmitSchedule,
}: {
	selectedReportView: TaxReportView
	onSelectReportView: (value: TaxReportView) => void
	reportSelectorQuery: string
	onReportSelectorQueryChange: (value: string) => void
	visibleReportOptions: Array<{ value: TaxReportView; label: string; description: string }>
	selectedReportDescription?: string
	canView: boolean
	canAdminScope: boolean
	canExport: boolean
	canCreateSchedule: boolean
	activeReportIsExportable: boolean
	activeExportReportType: TaxExportReportType | null
	reportWindowFilters: TaxRollupReportQueryFilters
	onTotalTaxesSortChange: (sortBy: string, sortDir: SortDirection) => void
	onEssSortChange: (sortBy: string, sortDir: SortDirection) => void
	onDiscrepancySortChange: (sortBy: string, sortDir: SortDirection) => void
	selectedExportFormat: TaxExportFormat
	onSelectExportFormat: (format: TaxExportFormat) => void
	selectedScheduleFormat: TaxExportFormat
	onSelectScheduleFormat: (format: TaxExportFormat) => void
	scheduleName: string
	onScheduleNameChange: (value: string) => void
	scheduleFrequency: 'weekly' | 'monthly'
	onSelectScheduleFrequency: (value: 'weekly' | 'monthly') => void
	exportFormatOptions: Array<{ value: TaxExportFormat; label: string }>
	scheduleFrequencyOptions: Array<{ value: 'weekly' | 'monthly'; label: string }>
	exportFilterSummary: string[]
	exportSubmitting: boolean
	scheduleSubmitting: boolean
	onSubmitExport: () => Promise<void> | void
	onSubmitSchedule: () => Promise<void> | void
}) {
	const [exportModalOpen, setExportModalOpen] = useState(false)
	const [scheduleModalOpen, setScheduleModalOpen] = useState(false)

	const selectedReportOption = visibleReportOptions.find(
		(option) => option.value === selectedReportView
	)

	return (
		<>
			<TaxPanelCard
				title="Report"
				description={selectedReportDescription}
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
					onSelectReportView={(value) => onSelectReportView(value as TaxReportView)}
					reportSelectorQuery={reportSelectorQuery}
					onReportSelectorQueryChange={onReportSelectorQueryChange}
					visibleReportOptions={visibleReportOptions}
				/>

				{selectedReportView === 'total_taxes_by_corporation' ? (
					<TotalTaxesReportSection
						filters={reportWindowFilters}
						enabled={canView}
						onSortChange={onTotalTaxesSortChange}
					/>
				) : null}

				{selectedReportView === 'top_income_sources' ? (
					<TopIncomeSourcesReportSection filters={reportWindowFilters} enabled={canView} />
				) : null}

				{selectedReportView === 'ess_payout' ? (
					<EssPayoutReportSection
						filters={reportWindowFilters}
						enabled={canView}
						onSortChange={onEssSortChange}
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
						onSortChange={onDiscrepancySortChange}
					/>
				) : null}

				{selectedReportView === 'bill_status' ? (
					<BillStatusReportSection filters={reportWindowFilters} enabled={canView} />
				) : null}

				{selectedReportView === 'compliance_over_time' ? (
					<ComplianceOverTimeReportSection filters={reportWindowFilters} enabled={canView} />
				) : null}

				{selectedReportView === 'missing_esi_keys' ? (
					<MissingEsiKeysReportSection enabled={canAdminScope} />
				) : null}
			</TaxPanelCard>

			<TaxExportDialog
				open={exportModalOpen}
				onOpenChange={setExportModalOpen}
				selectedReportLabel={selectedReportOption?.label}
				filterSummary={exportFilterSummary}
				selectedExportFormat={selectedExportFormat}
				onSelectExportFormat={onSelectExportFormat}
				exportFormatOptions={exportFormatOptions}
				canExport={canExport}
				canSubmit={Boolean(activeExportReportType)}
				submitting={exportSubmitting}
				onSubmit={() => {
					void Promise.resolve(onSubmitExport()).then(() => setExportModalOpen(false))
				}}
			/>

			<TaxScheduleDialog
				open={scheduleModalOpen}
				onOpenChange={setScheduleModalOpen}
				selectedReportLabel={selectedReportOption?.label}
				filterSummary={exportFilterSummary}
				scheduleName={scheduleName}
				onScheduleNameChange={onScheduleNameChange}
				selectedScheduleFormat={selectedScheduleFormat}
				onSelectScheduleFormat={onSelectScheduleFormat}
				scheduleFrequency={scheduleFrequency}
				onSelectScheduleFrequency={onSelectScheduleFrequency}
				exportFormatOptions={exportFormatOptions}
				scheduleFrequencyOptions={scheduleFrequencyOptions}
				canCreateSchedule={canCreateSchedule}
				canSubmit={Boolean(activeExportReportType)}
				submitting={scheduleSubmitting}
				onSubmit={() => {
					void Promise.resolve(onSubmitSchedule()).then(() => setScheduleModalOpen(false))
				}}
			/>
		</>
	)
}
