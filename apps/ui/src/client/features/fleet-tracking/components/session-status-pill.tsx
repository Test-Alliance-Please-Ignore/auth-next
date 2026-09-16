import { CheckCircle2, CircleDot } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

interface SessionStatusPillProps {
	status: 'active' | 'ended'
}

export function SessionStatusPill({ status }: SessionStatusPillProps) {
	const { t } = useAppTranslation()

	if (status === 'active') {
		return (
			<Badge variant="success" icon={CircleDot}>
				{t('fleetTracking.live')}
			</Badge>
		)
	}
	return (
		<Badge variant="secondary" icon={CheckCircle2}>
			{t('fleetTracking.ended')}
		</Badge>
	)
}
