import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'

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
	const assessmentActive =
		runAssessmentPending ||
		runAssessmentStatus === 'queued' ||
		runAssessmentStatus === 'running' ||
		runAssessmentStatus === 'waiting'

	return (
		<Card>
			<CardHeader>
				<CardTitle>Assessment and Billing Operations</CardTitle>
				<CardDescription>
					Run an assessment for the selected period, create missing bills, then issue existing draft
					bills. Assessment and billing are separate operations.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{!effectiveCorporationId ? (
					<div className="text-sm text-muted-foreground">
						Select one corporation above to enable assessment and billing actions. These operations
						cannot be run against the all-corporations scope.
					</div>
				) : null}
				<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
					<div className="flex flex-wrap gap-2">
						<Button
							variant="ghost"
							disabled={!effectiveCorporationId || !canIssue || syncCorporationPending}
							onClick={onSyncCorporation}
						>
							{syncCorporationPending ? 'Syncing...' : 'Sync Corporation Bill Statuses'}
						</Button>
						<Button
							variant="primary"
							disabled={!effectiveCorporationId || !canIssue || issuePeriodPending}
							onClick={onIssuePeriod}
						>
							{issuePeriodPending ? 'Issuing...' : 'Issue Existing Bills'}
						</Button>
					</div>
					<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:justify-end">
						<Select
							value={monthValue}
							onValueChange={onMonthChange}
							options={monthOptions}
							placeholder="Assessment period"
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
								? 'Assessing...'
								: runAssessmentStatus === 'queued' || runAssessmentStatus === 'waiting'
									? 'Queued...'
									: 'Run Assessment'}
						</Button>
					</div>
				</div>
				{syncCorporationResult ? (
					<div className="text-sm text-muted-foreground">
						Processed {syncCorporationResult.processedAssessmentIds.length}, updated{' '}
						{syncCorporationResult.updatedAssessmentIds.length}, skipped{' '}
						{syncCorporationResult.skippedAssessmentIds.length}.
					</div>
				) : null}
				{runAssessmentResult ? (
					<div className="text-sm text-muted-foreground">
						Assessment completed with {runAssessmentResult.lineCount.toLocaleString('en-US')}{' '}
						line(s) and {runAssessmentResult.discrepancyCount.toLocaleString('en-US')}{' '}
						discrepancy(ies).
					</div>
				) : null}
				{runAssessmentError ? (
					<div className="text-sm text-destructive">
						{runAssessmentError instanceof Error
							? runAssessmentError.message
							: 'Failed to run assessment for period'}
					</div>
				) : null}
				{runAssessmentWorkflowError ? (
					<div className="text-sm text-destructive">
						{runAssessmentWorkflowError.message || 'Assessment workflow failed'}
					</div>
				) : null}
				{issuePeriodResult ? (
					<div className="text-sm text-muted-foreground">
						Issued {issuePeriodResult.issuedAssessmentIds.length}, skipped{' '}
						{issuePeriodResult.skippedAssessmentIds.length}.
					</div>
				) : null}
				{issuePeriodError ? (
					<div className="text-sm text-destructive">
						{issuePeriodError instanceof Error
							? issuePeriodError.message
							: 'Failed to issue bills for period'}
					</div>
				) : null}
				{syncCorporationError ? (
					<div className="text-sm text-destructive">
						{syncCorporationError instanceof Error
							? syncCorporationError.message
							: 'Failed to sync corporation bill statuses'}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
