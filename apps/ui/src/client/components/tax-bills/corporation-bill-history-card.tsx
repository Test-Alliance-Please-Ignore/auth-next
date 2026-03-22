import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { formatTaxDateTime } from '@/lib/tax-date'
import { formatTaxIskFull, formatTaxNumber } from '@/lib/tax-display'

import { billStatusBadgeVariant, getLastTimelineDate } from './helpers'

import type { TaxAssessmentWithBillHistory, TaxBillStatus } from '@repo/corporation-tax'

type CorporationBillHistoryCardProps = {
	effectiveCorporationId: string | null
	billHistoryLoading: boolean
	billHistoryError: unknown
	billHistory: TaxAssessmentWithBillHistory[]
	canIssue: boolean
	syncAssessmentPending: boolean
	syncAssessmentError: unknown
	retractAssessmentPending: boolean
	retractAssessmentError: unknown
	onSyncAssessment: (assessmentId: string) => void
	onRequestRetract: (assessmentId: string) => void
}

export function CorporationBillHistoryCard({
	effectiveCorporationId,
	billHistoryLoading,
	billHistoryError,
	billHistory,
	canIssue,
	syncAssessmentPending,
	syncAssessmentError,
	retractAssessmentPending,
	retractAssessmentError,
	onSyncAssessment,
	onRequestRetract,
}: CorporationBillHistoryCardProps) {
	return (
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
									<TableCell className="font-mono text-xs">{row.assessment.billId ?? '-'}</TableCell>
									<TableCell>
										<Badge
											variant={billStatusBadgeVariant(
												(row.assessment.billStatus ?? 'unbilled') as TaxBillStatus | 'unbilled'
											)}
										>
											{row.assessment.billStatus ?? 'unbilled'}
										</Badge>
									</TableCell>
									<TableCell>{formatTaxIskFull(row.assessment.taxDue)}</TableCell>
									<TableCell>{formatTaxIskFull(row.assessment.taxPaid)}</TableCell>
									<TableCell>{formatTaxDateTime(row.assessment.taxPeriodEnd)}</TableCell>
									<TableCell>{formatTaxNumber(row.timeline.length)}</TableCell>
									<TableCell>{getLastTimelineDate(row.timeline)}</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Button
												size="sm"
												variant="outline"
												disabled={!canIssue || !row.assessment.billId || syncAssessmentPending}
												onClick={() => onSyncAssessment(row.assessment.id)}
											>
												{syncAssessmentPending ? 'Syncing...' : 'Sync'}
											</Button>
											<Button
												size="sm"
												variant="outline"
												disabled={
													!canIssue ||
													!row.assessment.billId ||
													row.assessment.billStatus === 'paid' ||
													row.assessment.billStatus === 'cancelled' ||
													retractAssessmentPending
												}
												onClick={() => onRequestRetract(row.assessment.id)}
											>
												Retract
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
				{syncAssessmentError ? (
					<div className="mt-3 text-sm text-destructive">
						{syncAssessmentError instanceof Error
							? syncAssessmentError.message
							: 'Failed to sync assessment bill status'}
					</div>
				) : null}
				{retractAssessmentError ? (
					<div className="mt-3 text-sm text-destructive">
						{retractAssessmentError instanceof Error
							? retractAssessmentError.message
							: 'Failed to retract assessment bill'}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
