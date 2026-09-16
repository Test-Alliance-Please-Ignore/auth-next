import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAppTranslation } from '@/i18n'

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
	const { t } = useAppTranslation()

	return (
		<div className="grid gap-4 md:grid-cols-3">
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">{t('tax.assessmentsInView')}</CardTitle>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">{totalAssessments}</CardContent>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">{t('tax.unbilledAssessments')}</CardTitle>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">{unbilledAssessmentCount}</CardContent>
			</Card>
			<Card>
				<CardHeader className="pb-2">
					<CardTitle className="text-sm">{t('tax.overdueAssessments')}</CardTitle>
				</CardHeader>
				<CardContent className="text-2xl font-semibold">{overdueAssessments}</CardContent>
			</Card>
		</div>
	)
}
