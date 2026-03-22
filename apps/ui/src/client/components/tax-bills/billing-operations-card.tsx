import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { DateRangeInput } from '@/components/ui/date-range-input'

type BillingOperationsCardProps = {
	effectiveCorporationId: string | null
	canIssue: boolean
	periodStartDate: string
	periodEndDate: string
	onPeriodChange: (range: { fromDate: string; toDate: string }) => void
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
}

export function BillingOperationsCard({
	effectiveCorporationId,
	canIssue,
	periodStartDate,
	periodEndDate,
	onPeriodChange,
	onSyncCorporation,
	syncCorporationPending,
	syncCorporationResult,
	syncCorporationError,
	onIssuePeriod,
	issuePeriodPending,
	issuePeriodResult,
	issuePeriodError,
}: BillingOperationsCardProps) {
	return (
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
								disabled={!canIssue || syncCorporationPending}
								onClick={onSyncCorporation}
							>
								{syncCorporationPending ? 'Syncing...' : 'Sync Corporation Bill Statuses'}
							</Button>
						</div>
						{syncCorporationResult ? (
							<div className="text-sm text-muted-foreground">
								Processed {syncCorporationResult.processedAssessmentIds.length}, updated{' '}
								{syncCorporationResult.updatedAssessmentIds.length}, skipped{' '}
								{syncCorporationResult.skippedAssessmentIds.length}.
							</div>
						) : null}

						<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
							<DateRangeInput
								value={{ fromDate: periodStartDate, toDate: periodEndDate }}
								onChange={onPeriodChange}
								placeholder="Billing period"
								disabled={!canIssue}
							/>
							<Button disabled={!canIssue || issuePeriodPending} onClick={onIssuePeriod}>
								{issuePeriodPending ? 'Issuing...' : 'Issue Bills For Period'}
							</Button>
						</div>
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
					</>
				)}
			</CardContent>
		</Card>
	)
}
