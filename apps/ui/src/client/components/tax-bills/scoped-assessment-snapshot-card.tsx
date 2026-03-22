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
import { formatTaxIskFull, TaxEntityDisplay } from '@/lib/tax-display'

import type { TaxAssessment, TaxAssessmentScope } from '@repo/corporation-tax'

type ScopedAssessmentSnapshotCardProps = {
	effectiveCorporationId: string | null
	assessmentsLoading: boolean
	assessmentsError: unknown
	assessments: TaxAssessment[]
	scopeCounts: {
		corporation: number
		division: number
		character: number
	}
	selectedAssessmentScope: 'all' | TaxAssessmentScope
	onSelectAssessmentScope: (scope: 'all' | TaxAssessmentScope) => void
	scopedAssessmentRows: TaxAssessment[]
	entityNames: Record<string, string>
}

export function ScopedAssessmentSnapshotCard({
	effectiveCorporationId,
	assessmentsLoading,
	assessmentsError,
	assessments,
	scopeCounts,
	selectedAssessmentScope,
	onSelectAssessmentScope,
	scopedAssessmentRows,
	entityNames,
}: ScopedAssessmentSnapshotCardProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Scoped Assessment Snapshot</CardTitle>
				<CardDescription>
					View corporation, division, and character assessment rows for the selected corporation.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{!effectiveCorporationId ? (
					<div className="py-8 text-sm text-muted-foreground">
						Select a corporation to view scoped assessments.
					</div>
				) : assessmentsLoading ? (
					<div className="py-8 text-sm text-muted-foreground">Loading scoped assessments...</div>
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
								onClick={() => onSelectAssessmentScope('all')}
							>
								All ({assessments.length})
							</Button>
							<Button
								size="sm"
								variant={selectedAssessmentScope === 'corporation' ? 'default' : 'outline'}
								onClick={() => onSelectAssessmentScope('corporation')}
							>
								Corporation ({scopeCounts.corporation})
							</Button>
							<Button
								size="sm"
								variant={selectedAssessmentScope === 'division' ? 'default' : 'outline'}
								onClick={() => onSelectAssessmentScope('division')}
							>
								Division ({scopeCounts.division})
							</Button>
							<Button
								size="sm"
								variant={selectedAssessmentScope === 'character' ? 'default' : 'outline'}
								onClick={() => onSelectAssessmentScope('character')}
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
													<TaxEntityDisplay entityId={assessment.scopeId} entityNames={entityNames} />
												) : (
													assessment.scopeId
												)}
											</TableCell>
											<TableCell>{assessment.status}</TableCell>
											<TableCell>{formatTaxIskFull(assessment.taxDue)}</TableCell>
											<TableCell>{formatTaxIskFull(assessment.taxPaid)}</TableCell>
											<TableCell>{formatTaxIskFull(assessment.taxDelta)}</TableCell>
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
	)
}
