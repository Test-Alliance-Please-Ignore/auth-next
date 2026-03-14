import { useMemo, useState } from 'react'

import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { DateRangeInput } from '@/components/ui/date-range-input'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import {
	useCreateTaxBillForAssessment,
	useIssueTaxBillsForPeriod,
	useSyncTaxAssessmentBillStatus,
	useSyncTaxCorporationBillStatuses,
	useTaxAssessments,
	useTaxBillStatusReport,
	useTaxCapabilities,
	useTaxCorporationBillHistory,
} from '@/hooks/useCorporationTax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { formatTaxDateTime, getCurrentMonthDateRange } from '@/lib/tax-date'
import { TaxEntityDisplay } from '@/lib/tax-display'

import type { TaxAssessmentScope, TaxBillStatus } from '@repo/corporation-tax'

function getLastTimelineDate(events: Array<{ createdAt: string | Date }>): string {
	if (events.length === 0) {
		return '-'
	}

	const latest = events.reduce((acc, current) => {
		return new Date(current.createdAt) > new Date(acc.createdAt) ? current : acc
	}, events[0]!)
	return formatTaxDateTime(latest.createdAt)
}

function billStatusBadgeVariant(
	status: TaxBillStatus | 'unbilled'
): 'default' | 'secondary' | 'outline' {
	if (status === 'overdue') {
		return 'secondary'
	}
	if (status === 'paid') {
		return 'default'
	}
	return 'outline'
}

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()

export default function TaxBillsPage() {
	usePageTitle('Tax Billing')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canViewWithUrn = globalCapabilities?.global.canAudit ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canViewWithUrn)
	const [periodStartDate, setPeriodStartDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [periodEndDate, setPeriodEndDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [selectedAssessmentScope, setSelectedAssessmentScope] = useState<
		'all' | TaxAssessmentScope
	>('all')

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canAudit ?? false
	const canView = canViewWithUrn || canViewScoped
	const canIssue =
		(globalCapabilities?.global.canManage ?? false) ||
		(scopedCapabilities?.scoped.canManage ?? false)

	const {
		data: billStatusReport = [],
		isLoading: billStatusLoading,
		error: billStatusError,
	} = useTaxBillStatusReport({
		corporationId: effectiveCorporationId,
		limit: 100,
		enabled: canView,
	})

	const {
		data: billHistory = [],
		isLoading: billHistoryLoading,
		error: billHistoryError,
	} = useTaxCorporationBillHistory(effectiveCorporationId, {
		limit: 50,
		enabled: canView,
	})

	const {
		data: assessments = [],
		isLoading: assessmentsLoading,
		error: assessmentsError,
	} = useTaxAssessments(effectiveCorporationId, {
		limit: 500,
		enabled: canView,
	})

	const createBillMutation = useCreateTaxBillForAssessment()
	const syncAssessmentMutation = useSyncTaxAssessmentBillStatus()
	const issuePeriodMutation = useIssueTaxBillsForPeriod()
	const syncCorporationMutation = useSyncTaxCorporationBillStatuses()

	if (!corporationAccessLoading && !scopedCapabilitiesLoading && !canView) {
		return (
			<Container>
				<Card>
					<CardHeader>
						<CardTitle>Tax Billing</CardTitle>
						<CardDescription>You do not have permission to view tax billing data.</CardDescription>
					</CardHeader>
				</Card>
			</Container>
		)
	}

	const totalAssessments = billStatusReport.reduce((sum, row) => sum + row.assessmentCount, 0)
	const unbilledAssessmentCount = billStatusReport
		.filter((row) => row.billStatus === 'unbilled')
		.reduce((sum, row) => sum + row.assessmentCount, 0)
	const overdueAssessments = billStatusReport
		.filter((row) => row.billStatus === 'overdue')
		.reduce((sum, row) => sum + row.assessmentCount, 0)
	const corporationAssessments = assessments.filter(
		(assessment) => assessment.assessmentScope === 'corporation'
	)
	const unbilledAssessmentRows = corporationAssessments.filter(
		(assessment) =>
			!assessment.billId && assessment.status !== 'draft' && assessment.status !== 'excluded'
	)
	const scopeCounts = {
		corporation: assessments.filter((assessment) => assessment.assessmentScope === 'corporation')
			.length,
		division: assessments.filter((assessment) => assessment.assessmentScope === 'division').length,
		character: assessments.filter((assessment) => assessment.assessmentScope === 'character')
			.length,
	}
	const scopedAssessmentRows =
		selectedAssessmentScope === 'all'
			? assessments
			: assessments.filter((assessment) => assessment.assessmentScope === selectedAssessmentScope)

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const row of billStatusReport) ids.add(row.corporationId)
		for (const row of billHistory) ids.add(row.assessment.corporationId)
		for (const assessment of assessments) {
			ids.add(assessment.corporationId)
			if (assessment.assessmentScope === 'character') ids.add(assessment.scopeId)
		}
		return [...ids]
	}, [assessments, billHistory, billStatusReport])

	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: canView })

	return (
		<Container>
			<PageHeader
				title="Tax Billing"
				description="View tax assessment bill status rollups and bill timeline history by corporation."
			/>

			<Section>
				<TaxCorporationScopeSelector
					corporations={accessibleCorporations}
					effectiveCorporationId={effectiveCorporationId}
					selectedCorporationId={selectedCorporationId}
					canSelectAll={canViewWithUrn}
					onSelect={setSelectedCorporationId}
				/>

				<div className="grid gap-4 md:grid-cols-3">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Assessments in View</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{totalAssessments}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Unbilled Assessments</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{unbilledAssessmentCount}</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm">Overdue Assessments</CardTitle>
						</CardHeader>
						<CardContent className="text-2xl font-semibold">{overdueAssessments}</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Billing Operations</CardTitle>
						<CardDescription>
							Create missing bills, sync statuses from bills, and issue draft bills by period.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!effectiveCorporationId ? (
							<div className="text-sm text-muted-foreground">
								Select a corporation to run billing operations.
							</div>
						) : (
							<>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										disabled={!canIssue || syncCorporationMutation.isPending}
										onClick={() =>
											syncCorporationMutation.mutate({
												corporationId: effectiveCorporationId,
												limit: 100,
											})
										}
									>
										{syncCorporationMutation.isPending
											? 'Syncing...'
											: 'Sync Corporation Bill Statuses'}
									</Button>
								</div>
								{syncCorporationMutation.data ? (
									<div className="text-sm text-muted-foreground">
										Processed {syncCorporationMutation.data.processedAssessmentIds.length}, updated{' '}
										{syncCorporationMutation.data.updatedAssessmentIds.length}, skipped{' '}
										{syncCorporationMutation.data.skippedAssessmentIds.length}.
									</div>
								) : null}

								<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
									<DateRangeInput
										value={{ fromDate: periodStartDate, toDate: periodEndDate }}
										onChange={({ fromDate, toDate }) => {
											setPeriodStartDate(fromDate)
											setPeriodEndDate(toDate)
										}}
										placeholder="Billing period"
										disabled={!canIssue}
									/>
									<Button
										disabled={!canIssue || issuePeriodMutation.isPending}
										onClick={() => {
											if (!effectiveCorporationId || !periodStartDate || !periodEndDate) {
												return
											}
											issuePeriodMutation.mutate({
												corporationId: effectiveCorporationId,
												periodStart: new Date(`${periodStartDate}T00:00:00.000Z`).toISOString(),
												periodEnd: new Date(`${periodEndDate}T23:59:59.999Z`).toISOString(),
											})
										}}
									>
										{issuePeriodMutation.isPending ? 'Issuing...' : 'Issue Bills For Period'}
									</Button>
								</div>
								{issuePeriodMutation.data ? (
									<div className="text-sm text-muted-foreground">
										Issued {issuePeriodMutation.data.issuedAssessmentIds.length}, skipped{' '}
										{issuePeriodMutation.data.skippedAssessmentIds.length}.
									</div>
								) : null}
								{issuePeriodMutation.error ? (
									<div className="text-sm text-destructive">
										{issuePeriodMutation.error instanceof Error
											? issuePeriodMutation.error.message
											: 'Failed to issue bills for period'}
									</div>
								) : null}
								{syncCorporationMutation.error ? (
									<div className="text-sm text-destructive">
										{syncCorporationMutation.error instanceof Error
											? syncCorporationMutation.error.message
											: 'Failed to sync corporation bill statuses'}
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Unbilled Assessments</CardTitle>
						<CardDescription>
							Finalized corporation-scope assessments without a linked bill. Create bills manually
							as needed.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to view unbilled assessments.
							</div>
						) : assessmentsLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading assessments...</div>
						) : assessmentsError ? (
							<div className="py-8 text-sm text-destructive">
								{assessmentsError instanceof Error
									? assessmentsError.message
									: 'Failed to load assessments'}
							</div>
						) : unbilledAssessmentRows.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No unbilled finalized assessments found.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Assessment</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Tax Due</TableHead>
										<TableHead>Period End</TableHead>
										<TableHead>Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{unbilledAssessmentRows.map((assessment) => (
										<TableRow key={assessment.id}>
											<TableCell className="font-mono text-xs">{assessment.id}</TableCell>
											<TableCell>{assessment.status}</TableCell>
											<TableCell>{assessment.taxDue}</TableCell>
											<TableCell>{formatTaxDateTime(assessment.taxPeriodEnd)}</TableCell>
											<TableCell>
												<Button
													size="sm"
													disabled={!canIssue || createBillMutation.isPending}
													onClick={() => {
														if (!effectiveCorporationId) {
															return
														}
														createBillMutation.mutate({
															corporationId: effectiveCorporationId,
															assessmentId: assessment.id,
														})
													}}
												>
													{createBillMutation.isPending ? 'Creating...' : 'Create Bill'}
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
						{createBillMutation.error ? (
							<div className="mt-3 text-sm text-destructive">
								{createBillMutation.error instanceof Error
									? createBillMutation.error.message
									: 'Failed to create bill'}
							</div>
						) : null}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Scoped Assessment Snapshot</CardTitle>
						<CardDescription>
							View corporation, division, and character assessment rows for the selected
							corporation.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to view scoped assessments.
							</div>
						) : assessmentsLoading ? (
							<div className="py-8 text-sm text-muted-foreground">
								Loading scoped assessments...
							</div>
						) : assessmentsError ? (
							<div className="py-8 text-sm text-destructive">
								{assessmentsError instanceof Error
									? assessmentsError.message
									: 'Failed to load scoped assessments'}
							</div>
						) : (
							<>
								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'all' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('all')}
									>
										All ({assessments.length})
									</Button>
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'corporation' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('corporation')}
									>
										Corporation ({scopeCounts.corporation})
									</Button>
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'division' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('division')}
									>
										Division ({scopeCounts.division})
									</Button>
									<Button
										size="sm"
										variant={selectedAssessmentScope === 'character' ? 'default' : 'outline'}
										onClick={() => setSelectedAssessmentScope('character')}
									>
										Character ({scopeCounts.character})
									</Button>
								</div>
								{scopedAssessmentRows.length === 0 ? (
									<div className="py-8 text-sm text-muted-foreground">
										No assessments found for the selected scope.
									</div>
								) : (
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Assessment</TableHead>
												<TableHead>Scope</TableHead>
												<TableHead>Scope ID</TableHead>
												<TableHead>Status</TableHead>
												<TableHead>Tax Due</TableHead>
												<TableHead>Tax Paid</TableHead>
												<TableHead>Delta</TableHead>
												<TableHead>Period End</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{scopedAssessmentRows.map((assessment) => (
												<TableRow key={assessment.id}>
													<TableCell className="font-mono text-xs">{assessment.id}</TableCell>
													<TableCell>{assessment.assessmentScope}</TableCell>
													<TableCell>
														{assessment.assessmentScope === 'character' ? (
															<TaxEntityDisplay
																entityId={assessment.scopeId}
																entityNames={entityNames}
															/>
														) : (
															assessment.scopeId
														)}
													</TableCell>
													<TableCell>{assessment.status}</TableCell>
													<TableCell>{assessment.taxDue}</TableCell>
													<TableCell>{assessment.taxPaid}</TableCell>
													<TableCell>{assessment.taxDelta}</TableCell>
													<TableCell>{formatTaxDateTime(assessment.taxPeriodEnd)}</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								)}
							</>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Bill Status Rollup</CardTitle>
						<CardDescription>
							Corporation-scope assessment counts and tax totals grouped by bill lifecycle status.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{billStatusLoading ? (
							<div className="py-8 text-sm text-muted-foreground">
								Loading bill status report...
							</div>
						) : billStatusError ? (
							<div className="py-8 text-sm text-destructive">
								{billStatusError instanceof Error
									? billStatusError.message
									: 'Failed to load bill status report'}
							</div>
						) : billStatusReport.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No bill status data matched the current scope.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Corporation</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Assessments</TableHead>
										<TableHead>Tax Due</TableHead>
										<TableHead>Tax Paid</TableHead>
										<TableHead>Delta</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{billStatusReport.map((row) => (
										<TableRow key={`${row.corporationId}-${row.billStatus}`}>
											<TableCell className="font-medium">
												<TaxEntityDisplay entityId={row.corporationId} entityNames={entityNames} />
											</TableCell>
											<TableCell>
												<Badge variant={billStatusBadgeVariant(row.billStatus)}>
													{row.billStatus}
												</Badge>
											</TableCell>
											<TableCell>{row.assessmentCount}</TableCell>
											<TableCell>{row.taxDue}</TableCell>
											<TableCell>{row.taxPaid}</TableCell>
											<TableCell>{row.taxDelta}</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Corporation Bill History</CardTitle>
						<CardDescription>
							Timeline view of bill events linked to corporation-scope tax assessments.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{!effectiveCorporationId ? (
							<div className="py-8 text-sm text-muted-foreground">
								Select a corporation to view assessment bill history.
							</div>
						) : billHistoryLoading ? (
							<div className="py-8 text-sm text-muted-foreground">Loading bill history...</div>
						) : billHistoryError ? (
							<div className="py-8 text-sm text-destructive">
								{billHistoryError instanceof Error
									? billHistoryError.message
									: 'Failed to load bill history'}
							</div>
						) : billHistory.length === 0 ? (
							<div className="py-8 text-sm text-muted-foreground">
								No bill history entries were found for this corporation.
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Assessment</TableHead>
										<TableHead>Bill</TableHead>
										<TableHead>Status</TableHead>
										<TableHead>Tax Due</TableHead>
										<TableHead>Tax Paid</TableHead>
										<TableHead>Period End</TableHead>
										<TableHead>Timeline Events</TableHead>
										<TableHead>Last Event</TableHead>
										<TableHead>Action</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{billHistory.map((row) => (
										<TableRow key={row.assessment.id}>
											<TableCell className="font-mono text-xs">{row.assessment.id}</TableCell>
											<TableCell className="font-mono text-xs">
												{row.assessment.billId ?? '-'}
											</TableCell>
											<TableCell>
												<Badge
													variant={billStatusBadgeVariant(
														(row.assessment.billStatus ?? 'unbilled') as TaxBillStatus | 'unbilled'
													)}
												>
													{row.assessment.billStatus ?? 'unbilled'}
												</Badge>
											</TableCell>
											<TableCell>{row.assessment.taxDue}</TableCell>
											<TableCell>{row.assessment.taxPaid}</TableCell>
											<TableCell>{formatTaxDateTime(row.assessment.taxPeriodEnd)}</TableCell>
											<TableCell>{row.timeline.length}</TableCell>
											<TableCell>{getLastTimelineDate(row.timeline)}</TableCell>
											<TableCell>
												<Button
													size="sm"
													variant="outline"
													disabled={
														!canIssue || !row.assessment.billId || syncAssessmentMutation.isPending
													}
													onClick={() => {
														if (!effectiveCorporationId) {
															return
														}
														syncAssessmentMutation.mutate({
															corporationId: effectiveCorporationId,
															assessmentId: row.assessment.id,
														})
													}}
												>
													{syncAssessmentMutation.isPending ? 'Syncing...' : 'Sync'}
												</Button>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						)}
						{syncAssessmentMutation.error ? (
							<div className="mt-3 text-sm text-destructive">
								{syncAssessmentMutation.error instanceof Error
									? syncAssessmentMutation.error.message
									: 'Failed to sync assessment bill status'}
							</div>
						) : null}
					</CardContent>
				</Card>
			</Section>
		</Container>
	)
}
