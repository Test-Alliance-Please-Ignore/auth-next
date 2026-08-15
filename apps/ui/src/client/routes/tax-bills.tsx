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
	useRunTaxAssessmentForPeriod,
	useSyncTaxAssessmentBillStatus,
	useSyncTaxCorporationBillStatuses,
	useTaxAssessments,
	useTaxAssessmentWorkflowStatus,
	useTaxCapabilities,
} from '@/hooks/corporation-tax'
import { useEntityNames } from '@/hooks/useEntityNames'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useTaxCorporationAccessScope } from '@/hooks/useTaxCorporationAccessScope'
import { getCurrentMonthDateRange, getMonthDateRange, getMonthPeriodOptions } from '@/lib/tax-date'

const DEFAULT_MONTH_RANGE = getCurrentMonthDateRange()
const DEFAULT_MONTH_VALUE = DEFAULT_MONTH_RANGE.fromDate.slice(0, 7)
const TAX_ASSESSMENT_MONTH_OPTIONS = getMonthPeriodOptions(24)

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
	const [monthValue, setMonthValue] = useState(DEFAULT_MONTH_VALUE)
	const [periodStartDate, setPeriodStartDate] = useState(DEFAULT_MONTH_RANGE.fromDate)
	const [periodEndDate, setPeriodEndDate] = useState(DEFAULT_MONTH_RANGE.toDate)
	const [retractingAssessmentId, setRetractingAssessmentId] = useState<string | null>(null)

	const { data: scopedCapabilities, isLoading: scopedCapabilitiesLoading } = useTaxCapabilities(
		effectiveCorporationId,
		Boolean(effectiveCorporationId)
	)
	const canViewScoped = scopedCapabilities?.scoped.canRead ?? false
	const canView = canAdminScope || canViewScoped
	const canIssue =
		(globalCapabilities?.global.canManage ?? false) ||
		(scopedCapabilities?.scoped.canManage ?? false)

	const { data: assessmentsPage } = useTaxAssessments(effectiveCorporationId, {
		limit: 25,
		enabled: canView,
	})

	const createBillMutation = useCreateTaxBillForAssessment()
	const syncAssessmentMutation = useSyncTaxAssessmentBillStatus()
	const retractAssessmentMutation = useRetractTaxAssessmentBill()
	const issuePeriodMutation = useIssueTaxBillsForPeriod()
	const runAssessmentMutation = useRunTaxAssessmentForPeriod()
	const assessmentWorkflowStatusQuery = useTaxAssessmentWorkflowStatus(
		effectiveCorporationId,
		runAssessmentMutation.data?.workflowInstanceId
	)
	const syncCorporationMutation = useSyncTaxCorporationBillStatuses()

	const assessments = assessmentsPage?.rows ?? []
	const totalAssessments = assessmentsPage?.corporationAssessmentCount ?? 0
	const unbilledAssessmentCount = assessmentsPage?.unbilledAssessmentCount ?? 0
	const overdueAssessments = assessmentsPage?.overdueAssessmentCount ?? 0

	const entityIds = useMemo(() => {
		const ids = new Set<string>()
		for (const assessment of assessments) {
			ids.add(assessment.corporationId)
			if (assessment.assessmentScope === 'character') ids.add(assessment.scopeId)
		}
		return [...ids]
	}, [assessments])

	const { data: resolvedEntityNames = {} } = useEntityNames(entityIds, { enabled: canView })
	const entityNames = useMemo(() => {
		const names = { ...resolvedEntityNames }
		for (const corporation of accessibleCorporations) {
			if (corporation.name) names[corporation.corporationId] = corporation.name
		}
		return names
	}, [accessibleCorporations, resolvedEntityNames])
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

				{canAdminScope && (
					<BillingConfigurationCard
						effectiveCorporationId={effectiveCorporationId}
						canIssue={canIssue}
						canView={canAdminScope}
					/>
				)}

				<BillingOperationsCard
					effectiveCorporationId={effectiveCorporationId ?? null}
					canIssue={canIssue}
					monthValue={monthValue}
					monthOptions={TAX_ASSESSMENT_MONTH_OPTIONS}
					onMonthChange={(nextMonthValue) => {
						const range = getMonthDateRange(nextMonthValue)
						setMonthValue(nextMonthValue)
						setPeriodStartDate(range.fromDate)
						setPeriodEndDate(range.toDate)
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
					onRunAssessment={() => {
						if (!effectiveCorporationId || !periodStartDate || !periodEndDate) return
						runAssessmentMutation.mutate({
							corporationId: effectiveCorporationId,
							periodStart: new Date(`${periodStartDate}T00:00:00.000Z`).toISOString(),
							periodEnd: new Date(`${periodEndDate}T23:59:59.999Z`).toISOString(),
						})
					}}
					runAssessmentPending={runAssessmentMutation.isPending}
					runAssessmentResult={assessmentWorkflowStatusQuery.data?.output ?? undefined}
					runAssessmentStatus={assessmentWorkflowStatusQuery.data?.status}
					runAssessmentWorkflowError={assessmentWorkflowStatusQuery.data?.error ?? null}
					runAssessmentError={runAssessmentMutation.error}
				/>

				<UnbilledAssessmentsCard
					effectiveCorporationId={effectiveCorporationId ?? null}
					canView={canView}
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
									entityNames={entityNames}
									canView={canView}
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
