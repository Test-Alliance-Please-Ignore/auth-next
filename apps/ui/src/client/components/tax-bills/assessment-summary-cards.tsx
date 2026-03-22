import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type AssessmentSummaryCardsProps = {
	totalAssessments: number
	unbilledAssessmentCount: number
	overdueAssessments: number
}

export function AssessmentSummaryCards({
	totalAssessments,
	unbilledAssessmentCount,
	overdueAssessments,
}: AssessmentSummaryCardsProps) {
	return (
		<div className="grid gap-4 md:grid-cols-3">
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">Assessments in View</CardTitle>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">{totalAssessments}</CardContent>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">Unbilled Assessments</CardTitle>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">{unbilledAssessmentCount}</CardContent>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">Overdue Assessments</CardTitle>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">{overdueAssessments}</CardContent>
			</Card>
		</div>
	)
}
