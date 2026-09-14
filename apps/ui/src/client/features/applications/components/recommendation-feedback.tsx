import { useAppTranslation } from '@/i18n'

/** Keep success notifications translated after the originating dialog closes. */
export function RecommendationFeedback({ action }: { action: 'added' | 'updated' | 'deleted' }) {
	const { t } = useAppTranslation()
	return t(`applications.recommendations.feedback.${action}`)
}
