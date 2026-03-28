import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { ExportHistoryGrid, ExportSchedulesGrid } from '@/components/tax-reports/grids'
import { Badge } from '@/components/ui/badge'
import { CancelButton } from '@/components/ui/cancel-button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { PrimaryButton } from '@/components/ui/primary-button'
import { Select } from '@/components/ui/select'
import { formatTaxIskCompact } from '@/lib/tax-display'

import type { ReactNode } from 'react'
import type {
	TaxExportFormat,
	TaxExportRecord,
	TaxExportSchedule,
	TaxSummaryReport,
} from '@repo/corporation-tax'

interface TaxPanelCardProps {
	title: string
	description?: string
	actions?: ReactNode
	children: ReactNode
	contentClassName?: string
}

export function TaxPanelCard({
	title,
	description,
	actions,
	children,
	contentClassName,
}: TaxPanelCardProps) {
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
					<div>
						<CardTitle>{title}</CardTitle>
						{description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
					</div>
					{actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
				</div>
			</CardHeader>
			<CardContent className={contentClassName}>{children}</CardContent>
		</Card>
	)
}

interface TaxReportFiltersCardProps {
	fromDate: string
	toDate: string
	onDateRangeChange: (next: { fromDate: string; toDate: string }) => void
	accessibleCorporations: Array<{ corporationId: string; name: string }>
	effectiveCorporationId?: string
	selectedCorporationId?: string
	canAdminScope: boolean
	onSelectCorporation: (corporationId: string | undefined) => void
}

export function TaxReportFiltersCard(props: TaxReportFiltersCardProps) {
	return (
		<TaxPanelCard
			title="Filters"
			description="These filters apply to the active report and are persisted into export payloads."
			contentClassName="grid gap-3 md:grid-cols-4"
		>
			<FilterField label="Date range">
				<DateRangeInput
					value={{ fromDate: props.fromDate, toDate: props.toDate }}
					onChange={props.onDateRangeChange}
					placeholder="Date range"
				/>
			</FilterField>
			<FilterField label="Corporation">
				<TaxCorporationScopeSelector
					corporations={props.accessibleCorporations}
					effectiveCorporationId={props.effectiveCorporationId}
					selectedCorporationId={props.selectedCorporationId}
					canSelectAll={props.canAdminScope}
					onSelect={props.onSelectCorporation}
					showLabel={false}
					className="sm:max-w-none"
				/>
			</FilterField>
		</TaxPanelCard>
	)
}

export function TaxSummaryCards(props: {
	summaryReport: TaxSummaryReport | undefined
	loading: boolean
	error: unknown
}) {
	return (
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
						{formatTaxIskCompact(props.summaryReport?.taxDue ?? '0')}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">Tax Paid</CardTitle>
					</CardHeader>
					<CardContent className="text-xl font-semibold">
						{formatTaxIskCompact(props.summaryReport?.taxPaid ?? '0')}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">Tax Delta</CardTitle>
					</CardHeader>
					<CardContent className="text-xl font-semibold">
						{formatTaxIskCompact(props.summaryReport?.taxDelta ?? '0')}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="pb-2">
						<CardTitle className="text-sm">Assessments</CardTitle>
					</CardHeader>
					<CardContent className="text-xl font-semibold">
						{(props.summaryReport?.assessmentCount ?? 0).toLocaleString('en-US')}
					</CardContent>
				</Card>
			</div>
			{props.loading ? (
				<div className="text-sm text-muted-foreground">Loading summary...</div>
			) : props.error ? (
				<div className="text-sm text-destructive">
					{props.error instanceof Error ? props.error.message : 'Failed to load summary'}
				</div>
			) : !props.summaryReport ? (
				<div className="text-sm text-muted-foreground">
					No summary data is available for the current scope and date range.
				</div>
			) : null}
		</div>
	)
}

export function TaxExportHistoryPanel(props: {
	rows: TaxExportRecord[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	requestError: unknown
	downloadError: unknown
	downloading: boolean
	onDownload: (exportId: string) => void
}) {
	return (
		<TaxPanelCard
			title="Recent Exports"
			description="Review recent export runs and download their artifacts."
			contentClassName="space-y-4"
		>
			{props.requestError ? (
				<div className="text-sm text-destructive">
					{props.requestError instanceof Error
						? props.requestError.message
						: 'Failed to request export'}
				</div>
			) : null}
			<ExportHistoryGrid
				rows={props.rows}
				loading={props.loading}
				error={props.error}
				entityNames={props.entityNames}
				downloading={props.downloading}
				onDownload={props.onDownload}
			/>
			{props.downloadError ? (
				<div className="text-sm text-destructive">
					{props.downloadError instanceof Error
						? props.downloadError.message
						: 'Failed to download export artifact'}
				</div>
			) : null}
		</TaxPanelCard>
	)
}

export function TaxExportSchedulesPanel(props: {
	rows: TaxExportSchedule[]
	loading: boolean
	error: unknown
	entityNames: Record<string, string>
	createScheduleError: unknown
}) {
	return (
		<TaxPanelCard
			title="Recurring Export Schedules"
			description="Review recurring export jobs for this scope."
			contentClassName="space-y-4"
		>
			{props.createScheduleError ? (
				<div className="text-sm text-destructive">
					{props.createScheduleError instanceof Error
						? props.createScheduleError.message
						: 'Failed to create schedule'}
				</div>
			) : null}
			<ExportSchedulesGrid
				rows={props.rows}
				loading={props.loading}
				error={props.error}
				entityNames={props.entityNames}
			/>
		</TaxPanelCard>
	)
}

export function TaxExportDialog(props: {
	open: boolean
	onOpenChange: (open: boolean) => void
	selectedReportLabel?: string
	filterSummary: string[]
	selectedExportFormat: TaxExportFormat
	onSelectExportFormat: (value: TaxExportFormat) => void
	exportFormatOptions: Array<{ value: TaxExportFormat; label: string }>
	canExport: boolean
	canSubmit: boolean
	submitting: boolean
	onSubmit: () => void
}) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export Active Report</DialogTitle>
					<DialogDescription>
						Create a one-off export for{' '}
						{props.selectedReportLabel?.toLowerCase() ?? 'the active report'} using the current
						scope and filters.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<div className="space-y-1 text-sm">
						<div className="font-medium text-foreground">Report</div>
						<div className="text-muted-foreground">{props.selectedReportLabel}</div>
					</div>
					<div className="space-y-1 text-sm">
						<div className="font-medium text-foreground">Applied Filters</div>
						<div className="flex flex-wrap gap-2">
							{props.filterSummary.map((item) => (
								<Badge key={item} variant="secondary">
									{item}
								</Badge>
							))}
						</div>
					</div>
					<div className="space-y-2">
						<div className="text-sm font-medium text-foreground">Format</div>
						<Select
							value={props.selectedExportFormat}
							onValueChange={(value) => props.onSelectExportFormat(value as TaxExportFormat)}
							options={props.exportFormatOptions.map((option) => ({ value: option.value,
								label: option.label,
							}))}
							placeholder="Format"
						/>
					</div>
				</div>
				<DialogFooter>
					<CancelButton showIcon={false} onClick={() => props.onOpenChange(false)}>
						Cancel
					</CancelButton>
					<PrimaryButton
						onClick={props.onSubmit}
						disabled={!props.canExport || !props.canSubmit || props.submitting}
					>
						{props.submitting ? 'Requesting Export...' : 'Request Export'}
					</PrimaryButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

export function TaxScheduleDialog(props: {
	open: boolean
	onOpenChange: (open: boolean) => void
	selectedReportLabel?: string
	filterSummary: string[]
	scheduleName: string
	onScheduleNameChange: (value: string) => void
	selectedScheduleFormat: TaxExportFormat
	onSelectScheduleFormat: (value: TaxExportFormat) => void
	scheduleFrequency: 'weekly' | 'monthly'
	onSelectScheduleFrequency: (value: 'weekly' | 'monthly') => void
	exportFormatOptions: Array<{ value: TaxExportFormat; label: string }>
	scheduleFrequencyOptions: Array<{ value: 'weekly' | 'monthly'; label: string }>
	canCreateSchedule: boolean
	canSubmit: boolean
	submitting: boolean
	onSubmit: () => void
}) {
	return (
		<Dialog open={props.open} onOpenChange={props.onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Schedule Export</DialogTitle>
					<DialogDescription>
						Create a recurring export for{' '}
						{props.selectedReportLabel?.toLowerCase() ?? 'the active report'} using the current
						scope and filters.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<Input
						value={props.scheduleName}
						onChange={(event) => props.onScheduleNameChange(event.target.value)}
						placeholder="Schedule name"
					/>
					<div className="grid gap-3 md:grid-cols-2">
						<Select
							value={props.selectedScheduleFormat}
							onValueChange={(value) => props.onSelectScheduleFormat(value as TaxExportFormat)}
							options={props.exportFormatOptions.map((option) => ({ value: option.value,
								label: option.label,
							}))}
							placeholder="Format"
						/>
						<Select
							value={props.scheduleFrequency}
							onValueChange={(value) =>
								props.onSelectScheduleFrequency(value as 'weekly' | 'monthly')
							}
							options={props.scheduleFrequencyOptions.map((option) => ({ value: option.value,
								label: option.label,
							}))}
							placeholder="Frequency"
						/>
					</div>
					<div className="space-y-1 text-sm">
						<div className="font-medium text-foreground">Applied Filters</div>
						<div className="flex flex-wrap gap-2">
							{props.filterSummary.map((item) => (
								<Badge key={item} variant="secondary">
									{item}
								</Badge>
							))}
						</div>
					</div>
				</div>
				<DialogFooter>
					<CancelButton showIcon={false} onClick={() => props.onOpenChange(false)}>
						Cancel
					</CancelButton>
					<PrimaryButton
						onClick={props.onSubmit}
						disabled={!props.canCreateSchedule || !props.canSubmit || props.submitting}
					>
						{props.submitting ? 'Creating Schedule...' : 'Create Schedule'}
					</PrimaryButton>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
