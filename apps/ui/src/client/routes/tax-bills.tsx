import { useMemo, useState } from 'react'

import {
	AssessmentSummaryCards,
	BillingConfigurationCard,
	BillingOperationsCard,
	BillStatusTab,
	CorporationBillHistoryCard,
	RetractBillDialog,
	ScopedAssessmentSnapshotCard,
	UnbilledAssessmentsCard,
} from '@/components/tax-bills'
import { TaxCorporationScopeSelector } from '@/components/tax-corporation-scope-selector'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Container } from '@/components/ui/container'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	useCreateTaxBillForAssessment,
	useIssueTaxBillsForPeriod,
	useRetractTaxAssessmentBill,
	useSyncTaxAssessmentBillStatus,
	useSyncTaxCorporationBillStatuses,
	useTaxAssessments,
	useTaxCapabilities,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { getCurrentMonthDateRange } from '@/lib/tax-date'

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
	const totalAssessments = corporationAssessments.length
	const unbilledAssessmentRows = corporationAssessments.filter(
		(assessment) =>
			!assessment.billId && assessment.status !== 'draft' && assessment.status !== 'excluded'
	)
	const unbilledAssessmentCount = unbilledAssessmentRows.length
	const overdueAssessments = corporationAssessments.filter(
		(assessment) => assessment.billStatus === 'overdue'
	).length

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const assessment of assessments) {
			ids.add(assessment.corporationId)
			if (assessment.assessmentScope === 'character') ids.add(assessment.scopeId)
		}
		return [...ids]
	}, [assessments])

	const { data: entityNames = {} } = useEntityNames(entityIds, { enabled: canView })
	const retractableAssessment = assessments.find((row) => row.id === retractingAssessmentId)

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

				<Tabs defaultValue="bill-status" className="space-y-2">
					<Card>
						<CardHeader>
							<CardTitle>Billing Data</CardTitle>
							<CardDescription>
								Bill lifecycle, scoped assessments, and event history for the selected corporation.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-2">
							<TabsList>
								<TabsTrigger value="bill-status">Bill Status</TabsTrigger>
								<TabsTrigger value="assessments">Assessments</TabsTrigger>
								<TabsTrigger value="billing-history">Billing History</TabsTrigger>
							</TabsList>

							<TabsContent value="bill-status" className="mt-2 space-y-3">
								<BillStatusTab
									effectiveCorporationId={effectiveCorporationId ?? null}
									canView={canView}
									canIssue={canIssue}
									entityNames={entityNames}
									syncBillPending={syncAssessmentMutation.isPending}
									retractBillPending={retractAssessmentMutation.isPending}
									onSyncBillStatus={(assessmentId) => {
										if (!effectiveCorporationId) return
										syncAssessmentMutation.mutate({
											corporationId: effectiveCorporationId,
											assessmentId,
										})
									}}
									onRetractBill={(assessmentId) => {
										setRetractingAssessmentId(assessmentId)
									}}
									syncBillError={syncAssessmentMutation.error}
									retractBillError={retractAssessmentMutation.error}
								/>
							</TabsContent>

							<TabsContent value="assessments" className="mt-2">
								<ScopedAssessmentSnapshotCard
									effectiveCorporationId={effectiveCorporationId ?? null}
									assessmentsLoading={assessmentsLoading}
									assessmentsError={assessmentsError}
									assessments={assessments}
									entityNames={entityNames}
								/>
							</TabsContent>

							<TabsContent value="billing-history" className="mt-2">
								<CorporationBillHistoryCard
									effectiveCorporationId={effectiveCorporationId ?? null}
									canView={canView}
								/>
							</TabsContent>
						</CardContent>
					</Card>
				</Tabs>
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
