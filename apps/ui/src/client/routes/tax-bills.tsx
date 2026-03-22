import { useEffect, useMemo, useState } from 'react'

import {
	AssessmentSummaryCards,
	BillingConfigurationCard,
	BillingOperationsCard,
	BillStatusRollupCard,
	CorporationBillHistoryCard,
	RetractBillDialog,
	ScopedAssessmentSnapshotCard,
	UnbilledAssessmentsCard,
} from '@/components/tax-bills'
import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
const BILL_STATUS_PAGE_SIZE_DEFAULT = 25

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
	const [billStatusPage, setBillStatusPage] = useState(0)
	const [billStatusPageSize, setBillStatusPageSize] = useState(BILL_STATUS_PAGE_SIZE_DEFAULT)
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

	const {
		data: billStatusReportData,
		isLoading: billStatusLoading,
		error: billStatusError,
	} = useTaxBillStatusReport({
		corporationId: effectiveCorporationId,
		limit: billStatusPageSize,
		offset: billStatusPage * billStatusPageSize,
		sortBy: 'dueDate',
		sortDir: 'asc',
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
	const billStatusPageCount = Math.max(1, Math.ceil(billStatusTotalRows / billStatusPageSize))
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

	useEffect(() => {
		setBillStatusPage(0)
	}, [effectiveCorporationId])

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
				description="View tax assessment bill status rollups and bill timeline history by corporation."
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

				<BillStatusRollupCard
					billStatusLoading={billStatusLoading}
					billStatusError={billStatusError}
					billStatusReportRows={billStatusReportRows}
					entityNames={entityNames}
					billStatusPage={billStatusPage}
					billStatusPageCount={billStatusPageCount}
					billStatusTotalRows={billStatusTotalRows}
					billStatusPageSize={billStatusPageSize}
					onChangePageSize={(nextSize) => {
						setBillStatusPageSize(nextSize)
						setBillStatusPage(0)
					}}
					onPreviousPage={() => setBillStatusPage((value) => Math.max(0, value - 1))}
					onNextPage={() =>
						setBillStatusPage((value) => Math.min(Math.max(0, billStatusPageCount - 1), value + 1))
					}
				/>

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
