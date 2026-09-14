import { AlertCircle, CheckCircle, Clock } from 'lucide-react'
import { memo } from 'react'

import { Badge } from '@/components/ui/badge'
import { useAppTranslation } from '@/i18n'

import type { DirectorHealth } from '@/lib/api'

interface DirectorStatusBadgeProps {
	director: DirectorHealth
	showFailureCount?: boolean
}

export const DirectorStatusBadge = memo(function DirectorStatusBadge({
	director,
	showFailureCount = true,
}: DirectorStatusBadgeProps) {
	const { t } = useAppTranslation()
	const { isHealthy, failureCount, lastHealthCheck } = director

	// Never checked - needs verification
	if (!lastHealthCheck) {
		return (
			<Badge variant="ghost" className="gap-1">
				<Clock className="h-3 w-3" />
				<span>{t('admin.organizations.directors.needsVerification')}</span>
			</Badge>
		)
	}

	// Healthy director
	if (isHealthy) {
		return (
			<Badge variant="success" className="gap-1">
				<CheckCircle className="h-3 w-3" />
				<span>{t('admin.organizations.directors.healthy')}</span>
			</Badge>
		)
	}

	// Unhealthy director
	return (
		<Badge variant="destructive" className="gap-1">
			<AlertCircle className="h-3 w-3" />
			<span>{t('admin.organizations.directors.unhealthy')}</span>
			{showFailureCount && failureCount > 0 && (
				<span className="ml-1">
					{t('admin.organizations.directors.failures', { count: failureCount })}
				</span>
			)}
		</Badge>
	)
})
