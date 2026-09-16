import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useAppTranslation } from '@/i18n'

type BillingOperationsCardProps = {
	effectiveCorporationId: string | null
	canIssue: boolean
	monthValue: string
	monthOptions: Array<{ value: string; label: string }>
	onMonthChange: (monthValue: string) => void
	onSyncCorporation: () => void
	syncCorporationPending: boolean
	syncCorporationResult:
		| {
				processedAssessmentIds: string[]
				updatedAssessmentIds: string[]
				skippedAssessmentIds: string[]
		  }
		| undefined
	syncCorporationError: unknown
	onIssuePeriod: () => void
	issuePeriodPending: boolean
	issuePeriodResult:
		| {
				issuedAssessmentIds: string[]
				skippedAssessmentIds: string[]
		  }
		| undefined
	issuePeriodError: unknown
	onRunAssessment: () => void
	runAssessmentPending: boolean
	runAssessmentResult:
		| {
				status: 'completed'
				assessmentId: string
				lineCount: number
				discrepancyCount: number
		  }
		| undefined
	runAssessmentStatus:
		| 'queued'
		| 'running'
		| 'paused'
		| 'waiting'
		| 'completed'
		| 'failed'
		| 'unknown'
		| undefined
	runAssessmentWorkflowError: { name: string; message: string } | null
	runAssessmentError: unknown
}

export function BillingOperationsCard({
	effectiveCorporationId,
	canIssue,
	monthValue,
	monthOptions,
	onMonthChange,
	onSyncCorporation,
	syncCorporationPending,
	syncCorporationResult,
	syncCorporationError,
	onIssuePeriod,
	issuePeriodPending,
	issuePeriodResult,
	issuePeriodError,
	onRunAssessment,
	runAssessmentPending,
	runAssessmentResult,
	runAssessmentStatus,
	runAssessmentWorkflowError,
	runAssessmentError,
}: BillingOperationsCardProps) {
	const { t } = useAppTranslation()

	const assessmentActive =
		runAssessmentPending ||
		runAssessmentStatus === 'queued' ||
		runAssessmentStatus === 'running' ||
		runAssessmentStatus === 'waiting'

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t('tax.assessmentAndBillingOperations')}</CardTitle>
				<CardDescription>
					{t('tax.runAnAssessmentForTheSelectedPeriodCreateMissingBills')}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{!effectiveCorporationId ? (
					<div className="text-sm text-muted-foreground">
						{t('tax.selectOneCorporationAboveToEnableAssessmentAndBillingActions')}
					</div>
				) : null}
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							disabled={!effectiveCorporationId || !canIssue || syncCorporationPending}
							onClick={onSyncCorporation}
						>
							{syncCorporationPending ? t('tax.syncing') : t('tax.syncCorporationBillStatuses')}
						</Button>
						<Button
							variant="primary"
							disabled={!effectiveCorporationId || !canIssue || issuePeriodPending}
							onClick={onIssuePeriod}
						>
							{issuePeriodPending ? t('tax.issuing') : t('tax.issueExistingBills')}
						</Button>
					</div>
					<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:justify-end">
						<Select
							value={monthValue}
							onValueChange={onMonthChange}
							options={monthOptions}
							placeholder={t('tax.assessmentPeriod')}
							searchable
							className="min-w-0 sm:w-64 md:w-80"
							disabled={!effectiveCorporationId || !canIssue}
						/>
						<Button
							variant="primary"
							disabled={!effectiveCorporationId || !canIssue || assessmentActive}
							onClick={onRunAssessment}
						>
							{runAssessmentPending || runAssessmentStatus === 'running'
								? t('tax.assessing')
								: runAssessmentStatus === 'queued' || runAssessmentStatus === 'waiting'
									? t('tax.queued')
									: t('tax.runAssessment')}
						</Button>
					</div>
				</div>
				{syncCorporationResult ? (
					<div className="text-sm text-muted-foreground">
						{t('tax.syncResult', {
							processed: syncCorporationResult.processedAssessmentIds.length,
							updated: syncCorporationResult.updatedAssessmentIds.length,
							skipped: syncCorporationResult.skippedAssessmentIds.length,
						})}
					</div>
				) : null}
				{runAssessmentResult ? (
					<div className="text-sm text-muted-foreground">
						{t('tax.assessmentResult', {
							lines: runAssessmentResult.lineCount,
							discrepancies: runAssessmentResult.discrepancyCount,
						})}
					</div>
				) : null}
				{runAssessmentError ? (
					<div className="text-sm text-destructive">
						{runAssessmentError instanceof Error
							? runAssessmentError.message
							: t('tax.failedToRunAssessmentForPeriod')}
					</div>
				) : null}
				{runAssessmentWorkflowError ? (
					<div className="text-sm text-destructive">
						{runAssessmentWorkflowError.message || t('tax.assessmentWorkflowFailed')}
					</div>
				) : null}
				{issuePeriodResult ? (
					<div className="text-sm text-muted-foreground">
						{t('tax.issueResult', {
							issued: issuePeriodResult.issuedAssessmentIds.length,
							skipped: issuePeriodResult.skippedAssessmentIds.length,
						})}
					</div>
				) : null}
				{issuePeriodError ? (
					<div className="text-sm text-destructive">
						{issuePeriodError instanceof Error
							? issuePeriodError.message
							: t('tax.failedToIssueBillsForPeriod')}
					</div>
				) : null}
				{syncCorporationError ? (
					<div className="text-sm text-destructive">
						{syncCorporationError instanceof Error
							? syncCorporationError.message
							: t('tax.failedToSyncCorporationBillStatuses')}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
