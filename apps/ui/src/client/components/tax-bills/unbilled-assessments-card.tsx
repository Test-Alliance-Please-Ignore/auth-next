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
import { formatTaxIskFull } from '@/lib/tax-display'

import type { TaxAssessment } from '@repo/corporation-tax'

type UnbilledAssessmentsCardProps = {
	effectiveCorporationId: string | null
	assessmentsLoading: boolean
	assessmentsError: unknown
	unbilledAssessmentRows: TaxAssessment[]
	canIssue: boolean
	createBillPending: boolean
	createBillError: unknown
	onCreateBill: (assessmentId: string) => void
}

export function UnbilledAssessmentsCard({
	effectiveCorporationId,
	assessmentsLoading,
	assessmentsError,
	unbilledAssessmentRows,
	canIssue,
	createBillPending,
	createBillError,
	onCreateBill,
}: UnbilledAssessmentsCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Unbilled Assessments</CardTitle>
				<CardDescription>
					Finalized corporation-scope assessments without a linked bill. Create bills manually as
					needed.
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
									<TableCell>{formatTaxIskFull(assessment.taxDue)}</TableCell>
									<TableCell>{formatTaxDateTime(assessment.taxPeriodEnd)}</TableCell>
									<TableCell>
										<Button
											size="sm"
											disabled={!canIssue || createBillPending}
											onClick={() => onCreateBill(assessment.id)}
										>
											{createBillPending ? 'Creating...' : 'Create Bill'}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
				{createBillError ? (
					<div className="mt-3 text-sm text-destructive">
						{createBillError instanceof Error ? createBillError.message : 'Failed to create bill'}
					</div>
				) : null}
			</CardContent>
		</Card>
	)
}
