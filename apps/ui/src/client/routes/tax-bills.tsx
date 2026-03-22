import { useMemo, useState } from 'react'

import {
	AssessmentSummaryCards,
	BillingConfigurationCard,
	BillingOperationsCard,
	CorporationBillHistoryCard,
	RetractBillDialog,
	ScopedAssessmentSnapshotCard,
	UnbilledAssessmentsCard,
} from '@/components/tax-bills'
import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { BillStatusReportGrid } from '@/components/tax-reports/grids'
import { useReportGridState } from '@/components/tax-reports/use-report-grid-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import {
	useCreateTaxBillForAssessment,
	useIssueTaxBillsForPeriod,
	useRetractTaxAssessmentBill,
	useSyncTaxAssessmentBillStatus,
	useSyncTaxCorporationBillStatuses,
	useTaxAssessments,
	useTaxBillStatusReport,
	useTaxCapabilities,
	useTaxCorporationBillHistory,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { getCurrentMonthDateRange } from '@/lib/tax-date'

import type { TaxAssessmentScope } from '@repo/corporation-tax'

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()

export default function TaxBillsPage() {
	usePageTitle('Tax Billing')

	const { data: globalCapabilities } = useTaxCapabilities()
	const canAdminScope = globalCapabilities?.global.canAudit ?? false
	const {
		corporationAccessLoading,
		accessibleCorporations,
		selectedCorporationId,
		setSelectedCorporationId,
		effectiveCorporationId,
	} = useTaxCorporationAccessScope(canAdminScope)
	const [periodStartDate, setPeriodStartDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [periodEndDate, setPeriodEndDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [selectedAssessmentScope, setSelectedAssessmentScope] = useState<
		'all' | TaxAssessmentScope
	>('all')
	const [retractingAssessmentId, setRetractingAssessmentId] = useState<string | null>(null)

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canAudit ?? false
	const canView = canAdminScope || canViewScoped
	const canIssue =
		(globalCapabilities?.global.canManage ?? false) ||
		(scopedCapabilities?.scoped.canManage ?? false)
	const billStatusGrid = useReportGridState({
		defaultSortBy: 'dueDate',
		defaultSortDir: 'asc',
		defaultPageSize: 25,
		resetOn: { effectiveCorporationId },
	})

	const {
		data: billStatusReportData,
		isLoading: billStatusLoading,
		error: billStatusError,
	} = useTaxBillStatusReport({
		corporationId: effectiveCorporationId,
		limit: billStatusGrid.limit,
		offset: billStatusGrid.offset,
		sortBy: billStatusGrid.sortBy,
		sortDir: billStatusGrid.sortDir,
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
	const retractAssessmentMutation = useRetractTaxAssessmentBill()
	const issuePeriodMutation = useIssueTaxBillsForPeriod()
	const syncCorporationMutation = useSyncTaxCorporationBillStatuses()

	const corporationAssessments = assessments.filter(
		(assessment) => assessment.assessmentScope === 'corporation'
	)
	const billStatusReportRows = billStatusReportData?.rows ?? []
	const billStatusTotalRows = billStatusReportData?.totalRows ?? 0
	const billStatusPageCount = billStatusGrid.pageCountFor(billStatusTotalRows)
	const totalAssessments = corporationAssessments.length
	const unbilledAssessmentRows = corporationAssessments.filter(
		(assessment) =>
			!assessment.billId && assessment.status !== 'draft' && assessment.status !== 'excluded'
	)
	const unbilledAssessmentCount = unbilledAssessmentRows.length
	const overdueAssessments = corporationAssessments.filter(
		(assessment) => assessment.billStatus === 'overdue'
	).length
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
		for (const row of billStatusReportRows) ids.add(row.corporationId)
		for (const row of billHistory) ids.add(row.assessment.corporationId)
		for (const assessment of assessments) {
			ids.add(assessment.corporationId)
			if (assessment.assessmentScope === 'character') ids.add(assessment.scopeId)
		}
		return [...ids]
	}, [assessments, billHistory, billStatusReportRows])

	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: canView })
	const retractableAssessment = billHistory.find(
		(row) => row.assessment.id === retractingAssessmentId
	)?.assessment

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

	return (
		<Container>
			<PageHeader
				title="Tax Billing"
				description="View assessment-level bill status, period windows, and bill timeline history by corporation."
			/>

			<Section>
				<TaxCorporationScopeSelector
					corporations={accessibleCorporations}
					effectiveCorporationId={effectiveCorporationId}
					selectedCorporationId={selectedCorporationId}
					canSelectAll={canAdminScope}
					onSelect={setSelectedCorporationId}
				/>

				<AssessmentSummaryCards
					totalAssessments={totalAssessments}
					unbilledAssessmentCount={unbilledAssessmentCount}
					overdueAssessments={overdueAssessments}
				/>

				<BillingConfigurationCard
					effectiveCorporationId={effectiveCorporationId}
					canIssue={canIssue}
					canView={canView}
				/>

				<BillingOperationsCard
					effectiveCorporationId={effectiveCorporationId ?? null}
					canIssue={canIssue}
					periodStartDate={periodStartDate}
					periodEndDate={periodEndDate}
					onPeriodChange={({ fromDate, toDate }) => {
						setPeriodStartDate(fromDate)
						setPeriodEndDate(toDate)
					}}
					onSyncCorporation={() => {
						if (!effectiveCorporationId) return
						syncCorporationMutation.mutate({
							corporationId: effectiveCorporationId,
							limit: 100,
						})
					}}
					syncCorporationPending={syncCorporationMutation.isPending}
					syncCorporationResult={syncCorporationMutation.data}
					syncCorporationError={syncCorporationMutation.error}
					onIssuePeriod={() => {
						if (!effectiveCorporationId || !periodStartDate || !periodEndDate) return
						issuePeriodMutation.mutate({
							corporationId: effectiveCorporationId,
							periodStart: new Date(`${periodStartDate}T00:00:00.000Z`).toISOString(),
							periodEnd: new Date(`${periodEndDate}T23:59:59.999Z`).toISOString(),
						})
					}}
					issuePeriodPending={issuePeriodMutation.isPending}
					issuePeriodResult={issuePeriodMutation.data}
					issuePeriodError={issuePeriodMutation.error}
				/>

				<UnbilledAssessmentsCard
					effectiveCorporationId={effectiveCorporationId ?? null}
					assessmentsLoading={assessmentsLoading}
					assessmentsError={assessmentsError}
					unbilledAssessmentRows={unbilledAssessmentRows}
					canIssue={canIssue}
					createBillPending={createBillMutation.isPending}
					createBillError={createBillMutation.error}
					onCreateBill={(assessmentId) => {
						if (!effectiveCorporationId) return
						createBillMutation.mutate({
							corporationId: effectiveCorporationId,
							assessmentId,
						})
					}}
				/>

				<ScopedAssessmentSnapshotCard
					effectiveCorporationId={effectiveCorporationId ?? null}
					assessmentsLoading={assessmentsLoading}
					assessmentsError={assessmentsError}
					assessments={assessments}
					scopeCounts={scopeCounts}
					selectedAssessmentScope={selectedAssessmentScope}
					onSelectAssessmentScope={setSelectedAssessmentScope}
					scopedAssessmentRows={scopedAssessmentRows}
					entityNames={entityNames}
				/>

				<Card>
					<CardHeader>
						<CardTitle>Bill Status</CardTitle>
						<CardDescription>
							Assessment-level bill lifecycle, period window, and payment totals.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<BillStatusReportGrid
							rows={billStatusReportRows}
							loading={billStatusLoading}
							error={billStatusError}
							entityNames={entityNames}
							sorting={billStatusGrid.sorting}
							onSortingChange={billStatusGrid.onSortingChange}
							pagination={billStatusGrid.pagination}
							onPaginationChange={billStatusGrid.onPaginationChange}
							pageCount={billStatusPageCount}
							rowCount={billStatusTotalRows}
						/>
					</CardContent>
				</Card>

				<CorporationBillHistoryCard
					effectiveCorporationId={effectiveCorporationId ?? null}
					billHistoryLoading={billHistoryLoading}
					billHistoryError={billHistoryError}
					billHistory={billHistory}
					canIssue={canIssue}
					syncAssessmentPending={syncAssessmentMutation.isPending}
					syncAssessmentError={syncAssessmentMutation.error}
					retractAssessmentPending={retractAssessmentMutation.isPending}
					retractAssessmentError={retractAssessmentMutation.error}
					onSyncAssessment={(assessmentId) => {
						if (!effectiveCorporationId) return
						syncAssessmentMutation.mutate({
							corporationId: effectiveCorporationId,
							assessmentId,
						})
					}}
					onRequestRetract={setRetractingAssessmentId}
				/>
			</Section>

			<RetractBillDialog
				open={Boolean(retractingAssessmentId)}
				assessmentId={retractingAssessmentId}
				canIssue={canIssue}
				effectiveCorporationId={effectiveCorporationId ?? null}
				canRetract={Boolean(retractableAssessment?.billId)}
				isPending={retractAssessmentMutation.isPending}
				onClose={() => setRetractingAssessmentId(null)}
				onConfirm={() => {
					if (!effectiveCorporationId || !retractingAssessmentId) return
					retractAssessmentMutation.mutate(
						{
							corporationId: effectiveCorporationId,
							assessmentId: retractingAssessmentId,
						},
						{
							onSuccess: () => {
								setRetractingAssessmentId(null)
							},
						}
					)
				}}
			/>
		</Container>
	)
}
